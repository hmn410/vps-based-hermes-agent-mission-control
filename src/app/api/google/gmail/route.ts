import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGoogleAuth, gmailClient } from "@/lib/google-client";
import { classifyGoogleAction } from "@/lib/google-actions";

export const dynamic = "force-dynamic";

function decodeBase64Url(s: string) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractPlainText(payload: unknown): string {
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] } | undefined;
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return decodeBase64Url(p.body.data);
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (p.body?.data) return decodeBase64Url(p.body.data);
  return "";
}

function headerValue(headers: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// GET ?q=is:unread&max=10 → list recent messages (read-only, runs immediately)
// GET ?overview=1 → unread counts by category
export async function GET(req: Request) {
  const auth = await getGoogleAuth();
  if (!auth) return NextResponse.json({ connected: false, messages: [] });

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "is:unread newer_than:3d";
  const max = Math.min(Number(url.searchParams.get("max") || 15), 50);
  const overview = url.searchParams.get("overview") === "1";

  try {
    const gmail = gmailClient(auth);

    if (overview) {
      const [inbox, primary, updates, promotions, social] = await Promise.all([
        gmail.users.threads.list({ userId: "me", q: "in:inbox is:unread", maxResults: 1 }),
        gmail.users.threads.list({ userId: "me", q: "in:inbox is:unread category:primary", maxResults: 1 }),
        gmail.users.threads.list({ userId: "me", q: "in:inbox is:unread category:updates", maxResults: 1 }),
        gmail.users.threads.list({ userId: "me", q: "in:inbox is:unread category:promotions", maxResults: 1 }),
        gmail.users.threads.list({ userId: "me", q: "in:inbox is:unread category:social", maxResults: 1 }),
      ]);
      return NextResponse.json({
        connected: true,
        overview: {
          inbox: inbox.data.resultSizeEstimate ?? 0,
          primary: primary.data.resultSizeEstimate ?? 0,
          updates: updates.data.resultSizeEstimate ?? 0,
          promotions: promotions.data.resultSizeEstimate ?? 0,
          social: social.data.resultSizeEstimate ?? 0,
        },
      });
    }

    const list = await gmail.users.messages.list({ userId: "me", q, maxResults: max });
    const ids = list.data.messages ?? [];
    const messages = await Promise.all(
      ids.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" });
        const headers = msg.data.payload?.headers;
        return {
          id: msg.data.id,
          threadId: msg.data.threadId,
          from: headerValue(headers, "From"),
          subject: headerValue(headers, "Subject"),
          date: headerValue(headers, "Date"),
          snippet: msg.data.snippet ?? "",
          unread: (msg.data.labelIds ?? []).includes("UNREAD"),
        };
      })
    );
    return NextResponse.json({ connected: true, messages });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, messages: [] }, { status: 200 });
  }
}

// POST { kind: "gmail.draft"|"gmail.send"|"gmail.reply", to?, subject?, body, threadId?, messageId? }
// Drafts run immediately (nothing leaves the account). Send/reply always queue
// for human approval in the Approval Inbox — classifyGoogleAction fails closed
// for anything it doesn't explicitly recognize as read-only.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const kind = (b.kind || "gmail.draft").toString();
  const { requiresApproval } = classifyGoogleAction(kind);

  const title = kind === "gmail.send" || kind === "gmail.reply"
    ? `Send email: ${(b.subject || "(no subject)").toString().slice(0, 120)} → ${b.to || "?"}`
    : `Draft email: ${(b.subject || "(no subject)").toString().slice(0, 120)}`;

  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title,
      prompt: JSON.stringify(b),
      sideEffecting: requiresApproval,
      status: requiresApproval ? "awaiting_approval" : "queued",
    },
  });
  return NextResponse.json({ request: row });
}
