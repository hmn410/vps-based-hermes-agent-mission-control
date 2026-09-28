import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.dataStore.findUnique({ where: { key: "hermes-health" } });
  return NextResponse.json(row?.data ?? { online: false, gateway: "unknown", lastSeen: null });
}
