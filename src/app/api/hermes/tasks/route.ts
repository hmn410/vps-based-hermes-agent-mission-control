import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const [tasks, events] = await Promise.all([
    prisma.hermesTask.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }], take: 200 }),
    // Recent play-by-play (claimed/spawned/heartbeat/commented/completed/blocked/...)
    // — enough to reconstruct "what's it doing right now" per task.
    prisma.hermesTaskEvent.findMany({ orderBy: { id: "desc" }, take: 150 }),
  ]);
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  const lastSync = tasks[0]?.syncedAt ?? null;
  return NextResponse.json({ tasks, events, counts, total: tasks.length, lastSync });
}
