import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Bridge-written Hermes API probe ("hermes-health") plus kanban mirror
// freshness ("hermes-kanban-mirror"), so the sidebar status can tell
// "Hermes offline" apart from "task mirror stale".
export async function GET() {
  const [health, mirror] = await Promise.all([
    prisma.dataStore.findUnique({ where: { key: "hermes-health" } }),
    prisma.dataStore.findUnique({ where: { key: "hermes-kanban-mirror" } }),
  ]);
  const base = (health?.data as Record<string, unknown> | null) ?? { online: false, gateway: "unknown", lastSeen: null };
  const m = (mirror?.data as Record<string, unknown> | null) ?? null;
  return NextResponse.json(
    {
      ...base,
      mirror: m
        ? {
            lastSuccessfulEventReadAt: typeof m.lastSuccessfulEventReadAt === "string" ? m.lastSuccessfulEventReadAt : null,
            available: m.eventAvailability === "available",
            error: typeof m.eventError === "string" ? m.eventError : null,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
