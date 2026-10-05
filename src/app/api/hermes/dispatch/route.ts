import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requiresApproval } from "@/lib/dispatch-policy";
import { normalizeDispatchProfile } from "@/lib/dispatch-targets";

// POST { kind?, title, prompt?, sideEffecting?, assignee? } → queue work for Hermes.
// The UI can request approval, but cannot bypass the server-side external-action guard.
// `assignee` is the Hermes profile (kanban assignee) chosen in the /hermes
// composer; hermes-bridge's runRequest passes AgentRequest.assignee straight
// to the kanban create call. Unknown values fall back to "default".
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const title = (b.title || b.prompt || "").toString().trim();
  if (!title) return NextResponse.json({ error: "title or prompt required" }, { status: 400 });
  const kind = (b.kind || "oneshot").toString();
  const prompt = (b.prompt ?? b.title ?? "").toString();
  const sideEffecting = Boolean(b.sideEffecting) || requiresApproval(kind, prompt);
  const assignee = normalizeDispatchProfile(b.assignee ?? b.profile);
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind,
      title: title.slice(0, 200),
      prompt: prompt || null,
      assignee,
      sideEffecting,
      status: sideEffecting ? "awaiting_approval" : "queued",
    },
  });
  return NextResponse.json({ request: row });
}
