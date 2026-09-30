import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deriveRequestLifecycle } from "@/lib/kanban-request-lifecycle";

export const dynamic = "force-dynamic";

// Blocked kanban tasks that genuinely need a human — excludes "dependency"
// (auto-resumes on its own once the parent task finishes, no action needed).
const BLOCKED_KINDS_NEEDING_YOU = ["needs_input", "capability", "transient"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // e.g. "awaiting_approval"
  const take = Math.min(Number(url.searchParams.get("take") || 50), 200);
  const where = status ? { status: { in: status.split(",") } } : {};

  const [requests, approvalPending, blockedTasks] = await Promise.all([
    prisma.agentRequest.findMany({ where, orderBy: { createdAt: "desc" }, take }),
    prisma.agentRequest.count({ where: { status: "awaiting_approval" } }),
    prisma.hermesTask.findMany({
      where: { status: "blocked", blockKind: { in: BLOCKED_KINDS_NEEDING_YOU } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
  ]);

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
    blockedTasks: blockedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      blockKind: t.blockKind,
      reason: t.lastFailureError || null,
      updatedAt: t.updatedAt,
    })),
  });
}
