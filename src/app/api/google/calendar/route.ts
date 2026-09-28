import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGoogleAuth, calendarClient } from "@/lib/google-client";
import { classifyGoogleAction } from "@/lib/google-actions";

// GET ?start=&end= → list events in range (read-only, runs immediately)
export async function GET(req: Request) {
  const auth = await getGoogleAuth();
  if (!auth) return NextResponse.json({ connected: false, events: [] });

  const url = new URL(req.url);
  const now = new Date();
  const start = url.searchParams.get("start") || now.toISOString();
  const end = url.searchParams.get("end") || new Date(now.getTime() + 7 * 86400_000).toISOString();

  try {
    const calendar = calendarClient(auth);
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 25,
    });
    const events = (res.data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location || null,
      htmlLink: e.htmlLink || null,
      status: e.status || null,
    }));
    return NextResponse.json({ connected: true, events });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, events: [] }, { status: 200 });
  }
}

// POST { kind: "calendar.create"|"calendar.update"|"calendar.delete", summary?, start?, end?, eventId? }
// Every mutation queues for human approval — a calendar write is a real-world
// change (invites, reminders, other people's time), never auto-run.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const kind = (b.kind || "calendar.create").toString();
  const { requiresApproval } = classifyGoogleAction(kind);

  const title = kind === "calendar.delete"
    ? `Delete calendar event: ${b.eventId || "?"}`
    : `${kind === "calendar.update" ? "Update" : "Create"} calendar event: ${(b.summary || "(no title)").toString().slice(0, 120)}`;

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
