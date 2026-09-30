import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { projectExecutionFeed, telemetryHealth } from "@/lib/live-work";

export const dynamic = "force-dynamic";

export async function GET() {
  const [tasks, events, mirror] = await Promise.all([
    prisma.hermesTask.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }], take: 200 }),
    // Recent play-by-play (claimed/spawned/heartbeat/commented/completed/blocked/...)
    // — enough to reconstruct "what's it doing right now" per task.
    prisma.hermesTaskEvent.findMany({ orderBy: { id: "desc" }, take: 150 }),
    prisma.dataStore.findUnique({ where: { key: "hermes-kanban-mirror" } }),
  ]);
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const lastSync = tasks[0]?.syncedAt ?? null;
  const mirrorData = (mirror?.data ?? {}) as Record<string, unknown>;
  const confirmedEmpty = tasks.length === 0 && mirrorData?.confirmedEmpty === true;
  const telemetry = telemetryHealth(mirrorData);
  const feed = projectExecutionFeed(events, tasks);
  return NextResponse.json({ tasks, events, feed, telemetry, counts, total: tasks.length, lastSync, confirmedEmpty });
}
