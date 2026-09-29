export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kanbanCreateTask, kanbanTaskAction, kanbanDashboardConfigured } from "@/lib/kanban-dashboard-client";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");

  const ideas = await prisma.idea.findMany({
    where: type ? { type } : undefined,
    orderBy: { timestamp: "desc" },
  });

  return NextResponse.json(ideas);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const idea = await prisma.idea.create({
    data: {
      title: body.title,
      description: body.description || null,
      category: body.category || null,
      type: body.type || null,
      model: body.model || null,
      status: body.status || null,
    },
  });

  return NextResponse.json(idea);
}

// Statuses that push (or update) a linked kanban task so active ideas surface
// on the board — and in the chief-of-staff brief, which reads straight off
// the board. Statuses not listed here don't touch kanban.
//
// "approved" intentionally does NOT create a kanban task — approving just
// puts the idea on Josh's list; nothing runs yet. The kanban task (and any
// actual agent work) is created only when he clicks "Start" ("in-progress"),
// a deliberate action to send it off to run.
const KANBAN_SYNC_STATUS: Record<string, "create" | "complete" | "archive" | "ready"> = {
  "in-progress": "create",
  done: "complete",
  rejected: "archive",
};

export async function PUT(req: NextRequest) {
  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const existing = await prisma.idea.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    // Sync to kanban on a real status change. Connectivity failures are
    // best-effort (an idea update must never fail just because the kanban
    // bridge is briefly unreachable) but a VALIDATION failure — e.g. approving
    // an idea with no real description — hard-rejects the transition instead
    // of silently flipping the idea to "approved" with nothing behind it.
    // A vague/empty description produces a kanban task no worker can ever
    // act on, which then gets endlessly re-specified/re-promoted by the
    // auto-decomposer (a real runaway-loop incident this closed).
    if (
      typeof updates.status === "string" &&
      updates.status !== existing.status &&
      kanbanDashboardConfigured()
    ) {
      const action = KANBAN_SYNC_STATUS[updates.status];
      if (action === "create" && !existing.kanbanTaskId) {
        const description = (existing.description || "").trim();
        if (description.length < 20) {
          return NextResponse.json(
            {
              error: `Add a real description before approving "${existing.title}" — what exactly should happen, and where (site/product/system). Vague ideas create kanban tasks no worker can act on.`,
            },
            { status: 422 }
          );
        }
      }
      try {
        if (action === "create" && !existing.kanbanTaskId) {
          const created = await kanbanCreateTask({
            title: existing.title,
            body: [
              existing.description!.trim(),
              "",
              "---",
              "Approved idea from the Hermy HQ Ideas board.",
            ].join("\n"),
          });
          if (created?.task?.id) updates.kanbanTaskId = created.task.id;
        } else if (action && action !== "create" && existing.kanbanTaskId) {
          await kanbanTaskAction(existing.kanbanTaskId, action);
        }
      } catch (err) {
        console.error("kanban sync failed for idea", id, err);
      }
    }

    const idea = await prisma.idea.update({
      where: { id },
      data: updates,
    });
    return NextResponse.json(idea);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.idea.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
