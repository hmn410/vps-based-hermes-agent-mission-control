import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveRequestLifecycle } from "@/lib/kanban-request-lifecycle";
import { ATTENTION_CANDIDATE_STATUSES, deriveTaskAttention } from "@/lib/task-attention";

export const dynamic = "force-dynamic";

// Kanban tasks that genuinely need a human are decided by the shared
// deriveTaskAttention() model: `blocked` cards, AND Hermes' repeat-block case
// (2nd same-kind block → `triage` + block_loop_detected), which the old
// `status: "blocked"` query silently dropped. Dependency waits are excluded.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // e.g. "awaiting_approval"
  const take = Math.min(Number(url.searchParams.get("take") || 50), 200);
  const where = status ? { status: { in: status.split(",") } } : {};

  const [requests, approvalPending, candidateTasks] = await Promise.all([
    prisma.agentRequest.findMany({ where, orderBy: { createdAt: "desc" }, take }),
    prisma.agentRequest.count({ where: { status: "awaiting_approval" } }),
    prisma.hermesTask.findMany({
      where: { status: { in: ATTENTION_CANDIDATE_STATUSES } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  const blockedTasks = candidateTasks
    .map((task) => ({ task, attention: deriveTaskAttention(task) }))
    .filter(({ attention }) => attention.needsYou)
    .sort((a, b) => (b.task.blockedAt?.getTime() ?? 0) - (a.task.blockedAt?.getTime() ?? 0))
    .slice(0, 50);

  const taskIds = requests.flatMap((request) => request.hermesTaskId ? [request.hermesTaskId] : []);
  const [linkedTasks, linkedEvents] = taskIds.length
    ? await Promise.all([
        prisma.hermesTask.findMany({ where: { id: { in: taskIds } } }),
        prisma.hermesTaskEvent.findMany({ where: { taskId: { in: taskIds } }, orderBy: { createdAt: "desc" }, take: 200 }),
      ])
    : [[], []];
  const taskById = new Map(linkedTasks.map((task) => [task.id, task]));
  const eventsByTask = new Map<string, typeof linkedEvents>();
  for (const event of linkedEvents) {
    const current = eventsByTask.get(event.taskId) ?? [];
    current.push(event);
    eventsByTask.set(event.taskId, current);
  }
  const projectedRequests = requests.map((request) => {
    const lifecycle = deriveRequestLifecycle(
      request,
      request.hermesTaskId ? taskById.get(request.hermesTaskId) : null,
      request.hermesTaskId ? eventsByTask.get(request.hermesTaskId) : [],
    );
    return { ...request, status: lifecycle.status, lifecycle };
  });

  // Total "needs you" count spans both surfaces — pre-flight approvals AND
  // tasks that already started and then genuinely stalled on a human.
  const pending = approvalPending + blockedTasks.length;

  return NextResponse.json({
    requests: projectedRequests,
    pending,
    approvalPending,
    blockedTasks: blockedTasks.map(({ task: t, attention }) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      blockKind: t.blockKind,
      attentionKind: attention.kind,
      label: attention.label,
      reason: attention.reason,
      recurrences: attention.recurrences,
      blockedAt: t.blockedAt,
      updatedAt: t.updatedAt,
    })),
  });
}
