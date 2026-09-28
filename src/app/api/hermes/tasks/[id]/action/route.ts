import { NextResponse } from "next/server";
import { kanbanTaskAction, type KanbanTaskAction } from "@/lib/kanban-dashboard-client";

const VALID_ACTIONS: KanbanTaskAction[] = ["unblock", "archive", "complete", "ready"];

// POST /api/hermes/tasks/[id]/action  { action: "unblock" | "archive" | "complete" | "ready" }
// Lets the /tasks page clear up blocked/stuck cards directly, without
// leaving the dashboard to open the full kanban board.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let action: KanbanTaskAction;
  try {
    const body = await req.json();
    action = body.action;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
  try {
    const result = await kanbanTaskAction(id, action);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
