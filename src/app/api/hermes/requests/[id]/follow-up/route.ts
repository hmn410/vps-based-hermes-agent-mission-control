import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requiresApproval } from "@/lib/dispatch-policy";
import { buildFollowUpPrompt, conversationRootId } from "@/lib/follow-ups";

const MAX_FEEDBACK_LENGTH = 12_000;

// POST { feedback } → queue a new, linked Hermes task with enough context to
// correct or continue a previous response. It never mutates the old task.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const feedback = (body.feedback || "").toString().trim();
  if (!feedback) return NextResponse.json({ error: "feedback is required" }, { status: 400 });
  if (feedback.length > MAX_FEEDBACK_LENGTH) {
    return NextResponse.json({ error: `feedback must be at most ${MAX_FEEDBACK_LENGTH} characters` }, { status: 400 });
  }

  const repliedTo = await prisma.agentRequest.findUnique({ where: { id } });
  if (!repliedTo) return NextResponse.json({ error: "request not found" }, { status: 404 });

  const rootId = conversationRootId(repliedTo);
  const root = rootId === repliedTo.id
    ? repliedTo
    : await prisma.agentRequest.findUnique({ where: { id: rootId } });
  if (!root) return NextResponse.json({ error: "conversation root not found" }, { status: 409 });

  const prompt = buildFollowUpPrompt({
    originalTitle: root.title,
    originalPrompt: root.prompt,
    priorResponse: repliedTo.result || repliedTo.error,
    feedback,
  });
  const sideEffecting = requiresApproval("chat", prompt);
  const followUp = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: "chat",
      title: `Follow-up: ${root.title}`.slice(0, 200),
      prompt,
      assignee: repliedTo.assignee,
      sideEffecting,
      status: sideEffecting ? "awaiting_approval" : "queued",
      conversationId: rootId,
      replyToId: repliedTo.id,
      replyText: feedback,
    },
  });

  return NextResponse.json({ request: followUp }, { status: 201 });
}
