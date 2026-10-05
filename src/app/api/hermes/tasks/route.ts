import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activeTasks, mergeTaskEvents, projectExecutionFeed, telemetryHealth } from "@/lib/live-work";

export const dynamic = "force-dynamic";

export async function GET() {
  const [tasks, mirror] = await Promise.all([
    prisma.hermesTask.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }], take: 200 }),
    prisma.dataStore.findUnique({ where: { key: "hermes-kanban-mirror" } }),
  ]);
  // Event windows are split so heartbeats can't starve comments/status/block
  // events (previously one global take:150 by id was mostly heartbeats), plus
  // a per-task window for every non-terminal task so each live card has its
  // own recent history regardless of global volume.
  const activeIds = activeTasks(tasks).map((t) => t.id);
  const [lifecycle, heartbeats, perTask] = await Promise.all([
    prisma.hermesTaskEvent.findMany({ where: { kind: { not: "heartbeat" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 300 }),
    prisma.hermesTaskEvent.findMany({ where: { kind: "heartbeat" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 60 }),
    activeIds.length
      ? prisma.hermesTaskEvent.findMany({ where: { taskId: { in: activeIds } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(2000, activeIds.length * 60) })
      : Promise.resolve([]),
  ]);
  const events = mergeTaskEvents([...lifecycle, ...heartbeats], perTask, 2500);
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const lastSync = tasks[0]?.syncedAt ?? null;
  const mirrorData = (mirror?.data ?? {}) as Record<string, unknown>;
  const confirmedEmpty = tasks.length === 0 && mirrorData?.confirmedEmpty === true;
  const telemetry = telemetryHealth(mirrorData);
  const feed = projectExecutionFeed(events, tasks);
  return NextResponse.json({ tasks, events, feed, telemetry, counts, total: tasks.length, lastSync, confirmedEmpty });
}
