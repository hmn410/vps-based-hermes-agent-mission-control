import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UPCOMING_WORKDAY_KEY, sanitizeUpcomingWorkday } from "@/lib/upcoming-workday";

export const dynamic = "force-dynamic";

// Personal-only manual input. This endpoint never reads or connects to an
// employer calendar, email, Teams, or any other external work service.
export async function GET() {
  const row = await prisma.dataStore.findUnique({ where: { key: UPCOMING_WORKDAY_KEY } });
  return NextResponse.json(row?.data ?? {});
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const clean = sanitizeUpcomingWorkday(body);
  if (typeof clean === "string") {
    return NextResponse.json({ error: clean }, { status: 400 });
  }
  const data = { ...clean, updatedAt: new Date().toISOString(), source: "manual-personal-input" } as unknown as Prisma.InputJsonObject;
  await prisma.dataStore.upsert({
    where: { key: UPCOMING_WORKDAY_KEY },
    create: { key: UPCOMING_WORKDAY_KEY, data },
    update: { data },
  });
  return NextResponse.json(data);
}
