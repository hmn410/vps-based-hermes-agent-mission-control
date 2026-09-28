import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isGoogleKind, executeGoogleAction } from "@/lib/google-executor";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const action = (b.action || "").toString(); // approve | reject | edit
  const existing = await prisma.agentRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["awaiting_approval", "queued"].includes(existing.status))
    return NextResponse.json({ error: `cannot decide a ${existing.status} request` }, { status: 409 });

  const data: Record<string, unknown> = { decidedAt: new Date() };
  if (action === "approve") data.status = "approved";
  else if (action === "reject") data.status = "rejected";
  else if (action === "edit") { data.status = "approved"; if (b.prompt) data.prompt = b.prompt.toString(); if (b.title) data.title = b.title.toString().slice(0, 200); }
  else return NextResponse.json({ error: "action must be approve|reject|edit" }, { status: 400 });

  const row = await prisma.agentRequest.update({ where: { id }, data });

  // Google actions (gmail.send/reply/modify/trash, calendar.create/update/delete)
  // run in-process using the approving operator's own OAuth session, rather
  // than waiting for the Hermes bridge poller (which has no Google credentials).
  if (action === "approve" && isGoogleKind(row.kind)) {
    try {
      const result = await executeGoogleAction(row.kind, row.prompt);
      const done = await prisma.agentRequest.update({
        where: { id },
        data: { status: "done", result: result.slice(0, 8000), finishedAt: new Date() },
      });
      return NextResponse.json({ request: done });
    } catch (e) {
      const failed = await prisma.agentRequest.update({
        where: { id },
        data: { status: "failed", error: (e as Error).message.slice(0, 600), finishedAt: new Date() },
      });
      return NextResponse.json({ request: failed });
    }
  }

  return NextResponse.json({ request: row });
}
