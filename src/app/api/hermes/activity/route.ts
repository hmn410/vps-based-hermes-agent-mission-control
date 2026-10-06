import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activityLinks, currentActivityState } from "@/lib/activity-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const take = Math.min(Number(new URL(req.url).searchParams.get("take") || 30), 30);
  const events = await prisma.agentEvent.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take });
  // AgentEvent rows are append-only ("Started"/"Queued as kanban task" are
  // never rewritten), so attach each linked request/task's CURRENT state.
  const requestIds = new Set<string>();
  const taskIds = new Set<string>();
  for (const e of events) {
    const { requestId, taskId } = activityLinks(e.meta);
    if (requestId) requestIds.add(requestId);
    if (taskId) taskIds.add(taskId);
  }
  const requests = requestIds.size
    ? await prisma.agentRequest.findMany({
        where: { id: { in: [...requestIds] } },
        select: { id: true, status: true, createdAt: true, hermesTaskId: true },
      })
    : [];
  for (const r of requests) if (r.hermesTaskId) taskIds.add(r.hermesTaskId);
  const tasks = taskIds.size ? await prisma.hermesTask.findMany({ where: { id: { in: [...taskIds] } } }) : [];
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const now = new Date();
  return NextResponse.json(
    { events: events.map((e) => ({ ...e, current: currentActivityState(e, requestsById, tasksById, now) })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
