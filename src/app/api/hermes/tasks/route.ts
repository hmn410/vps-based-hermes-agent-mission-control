import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  const mirrorData = mirror?.data as { confirmedEmpty?: unknown } | undefined;
  const confirmedEmpty = tasks.length === 0 && mirrorData?.confirmedEmpty === true;
  return NextResponse.json({ tasks, events, counts, total: tasks.length, lastSync, confirmedEmpty });
}
