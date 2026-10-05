export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isBacklogStatus } from "@/lib/idea-status";

// Ideas are a backlog only (New / Considering / Rejected). Work starts with
// POST /api/ideas/[id]/send, which creates the kanban task and stores its id
// on Idea.kanbanTaskId; from then on the task owns the lifecycle. Legacy
// approved / in-progress / done rows are left untouched and mapped for
// display by src/lib/idea-status.ts.

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");

  const ideas = await prisma.idea.findMany({
    where: type ? { type } : undefined,
    orderBy: { timestamp: "desc" },
  });

  return NextResponse.json(ideas);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const idea = await prisma.idea.create({
    data: {
      title: body.title,
      description: body.description || null,
      category: body.category || null,
      type: body.type || null,
      model: body.model || null,
      status: isBacklogStatus(body.status) ? body.status : "new",
    },
  });

  return NextResponse.json(idea);
}

// Editable fields only — kanbanTaskId is written exclusively by the send route.
const EDITABLE = ["title", "description", "category", "status", "rejectionReason"] as const;

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if ("status" in updates && !isBacklogStatus(updates.status)) {
    return NextResponse.json(
      { error: "Ideas only move between New, Considering, and Rejected. Use Send to Hermes to start work." },
      { status: 422 },
    );
  }

  const data: Record<string, unknown> = {};
  for (const key of EDITABLE) if (key in updates) data[key] = updates[key];
  if (data.status && data.status !== "rejected") data.rejectionReason = null;

  try {
    const idea = await prisma.idea.update({ where: { id }, data });
    return NextResponse.json(idea);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.idea.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
