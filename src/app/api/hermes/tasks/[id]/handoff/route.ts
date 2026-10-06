import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kanbanDashboardConfigured, kanbanGetTaskDetail } from "@/lib/kanban-dashboard-client";
import { deriveTaskAttention } from "@/lib/task-attention";
import { deriveTaskHandoff, type TaskDetailPayload } from "@/lib/task-handoff";

export const dynamic = "force-dynamic";

// GET /api/hermes/tasks/[id]/handoff
// Read-only. Builds the human-action handoff from the FULL canonical kanban
// task detail (all comments, block events, run summaries/metadata) rather
// than the mirror's truncated previews. Never executes anything. When the
// detail cannot be read, says so (`available: false`) instead of guessing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    return NextResponse.json({ available: false, error: "Invalid task id" }, { status: 400 });
  }
  const mirrored = await prisma.hermesTask.findUnique({ where: { id } }).catch(() => null);
  const attentionKind = mirrored ? deriveTaskAttention(mirrored).kind : null;
  if (!kanbanDashboardConfigured()) {
    return NextResponse.json({
      available: false, taskId: id, attentionKind,
      error: "HQ cannot read full kanban task detail (HERMES_DASHBOARD_URL/USERNAME/PASSWORD not set).",
    });
  }
  try {
    const detail = await kanbanGetTaskDetail<TaskDetailPayload>(id);
    const handoff = deriveTaskHandoff(detail, attentionKind);
    return NextResponse.json({ available: true, taskId: id, attentionKind, handoff });
  } catch (e) {
    return NextResponse.json({
      available: false, taskId: id, attentionKind,
      error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
    });
  }
}
