export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kanbanCreateTask, kanbanDashboardConfigured } from "@/lib/kanban-dashboard-client";
import { sendBlocker } from "@/lib/idea-status";

// POST → "Send to Hermes": create a kanban task for this idea through the
// same Hermes dashboard kanban API the Ideas board has always used
// (kanbanCreateTask, landing in triage so the routing profile fleshes it out
// before any worker runs) and store the task id on Idea.kanbanTaskId.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idea = await prisma.idea.findUnique({ where: { id } });
  if (!idea) return NextResponse.json({ error: "not found" }, { status: 404 });

  const blocker = sendBlocker(idea);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 422 });

  if (!kanbanDashboardConfigured()) {
    return NextResponse.json({ error: "The Hermes kanban connection is not configured on this server." }, { status: 503 });
  }

  let taskId: string | undefined;
  try {
    const created = await kanbanCreateTask({
      title: idea.title,
      body: [
        idea.description!.trim(),
        "",
        "---",
        "Sent from the Hermy HQ Ideas backlog.",
      ].join("\n"),
    });
    taskId = created?.task?.id;
  } catch (err) {
    console.error("idea send failed", id, err);
    return NextResponse.json({ error: "Hermes did not accept the task. Try again in a moment." }, { status: 502 });
  }
  if (!taskId) return NextResponse.json({ error: "Hermes created no task id." }, { status: 502 });

  const updated = await prisma.idea.update({
    where: { id },
    data: { kanbanTaskId: taskId, status: "sent", rejectionReason: null },
  });
  return NextResponse.json(updated);
}
