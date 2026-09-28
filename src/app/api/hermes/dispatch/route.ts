import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requiresApproval } from "@/lib/dispatch-policy";

// POST { kind?, title, prompt?, sideEffecting? } → queue work for Hermes.
// The UI can request approval, but cannot bypass the server-side external-action guard.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || b.prompt || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });
  const kind = (b.kind || "oneshot").toString();
  const prompt = (b.prompt ?? b.title ?? "").toString();
  const sideEffecting = Boolean(b.sideEffecting) || requiresApproval(kind, prompt);
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title: title.slice(0, 200),
      prompt: prompt || null,
      sideEffecting,
      status: sideEffecting ? "awaiting_approval" : "queued",
    },
  });
  return NextResponse.json({ request: row });
}
