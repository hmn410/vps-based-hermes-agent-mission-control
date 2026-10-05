import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Default agent roster. The "integgy" id is a legacy internal key (bridge
// ASSIGNEE_TO_AGENT + AgentState rows) for the Hermes `ops` profile; only the
// neutral "Ops" wording is ever shown. HQ never surfaces employer work.
const DEFAULT_AGENTS = [
  {
    id: "hermes",
    name: "Hermes",
    emoji: "\uD83E\uDEBD",
    role: "Chief of Staff \u00B7 Orchestrator",
    status: "online",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "integgy",
    name: "Ops",
    emoji: "\uD83D\uDEE0\uFE0F",
    role: "Ops \u00B7 Systems & Automation",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "jbt",
    name: "JBT",
    emoji: "\uD83D\uDC77",
    role: "Build Ops \u00B7 JoshBuilds.Tech Status",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "josh",
    name: "Josh",
    emoji: "\uD83C\uDFE1",
    role: "Home Base \u00B7 Personal Assistant",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
  {
    id: "pixel",
    name: "Pixel",
    emoji: "\u270D\uFE0F",
    role: "Content \u00B7 JoshBuilds.Tech Marketing",
    status: "idle",
    tasksCompleted: 0,
    totalCost: 0,
    recentActivity: [],
  },
];

export async function GET() {
  try {
    const states = await prisma.agentState.findMany();
    const stateMap: Record<string, (typeof states)[number]> = {};
    for (const s of states) {
      stateMap[s.id] = s;
    }

    const agents = DEFAULT_AGENTS.map((agent) => {
      const s = stateMap[agent.id];
      return {
        ...agent,
        status: s?.status || agent.status,
        currentTask: s?.currentTask || undefined,
        lastActive: s?.lastActive || undefined,
        tasksCompleted: s?.tasksCompleted || agent.tasksCompleted,
        totalCost: s?.totalCost || agent.totalCost,
        recentActivity: s?.recentActivity || agent.recentActivity,
      };
    });

    return NextResponse.json(agents, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    console.error("Agents API error:", error);
    return NextResponse.json(DEFAULT_AGENTS, { status: 200 });
  }
}

// POST to update agent state (called by cron jobs)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { agentId, action, status, currentTask } = body;

    if (!agentId) {
      return NextResponse.json({ error: "agentId required" }, { status: 400 });
    }

    // Find the default agent info for name/emoji/role
    const defaultAgent = DEFAULT_AGENTS.find((a) => a.id === agentId);

    // Get existing state or create defaults
    const existing = await prisma.agentState.findUnique({ where: { id: agentId } });

    const recentActivity = (existing?.recentActivity as Prisma.InputJsonValue[] | null) || [];
    const newRecentActivity = action
      ? [
          { timestamp: new Date().toISOString(), action },
          ...recentActivity.slice(0, 19),
        ]
      : recentActivity;

    const updatedState = await prisma.agentState.upsert({
      where: { id: agentId },
      update: {
        ...(status ? { status } : {}),
        ...(currentTask !== undefined ? { currentTask } : {}),
        lastActive: new Date(),
        ...(action
          ? {
              recentActivity: newRecentActivity,
              tasksCompleted: (existing?.tasksCompleted || 0) + 1,
            }
          : {}),
      },
      create: {
        id: agentId,
        name: defaultAgent?.name || agentId,
        emoji: defaultAgent?.emoji,
        role: defaultAgent?.role,
        status: status || "idle",
        currentTask: currentTask || null,
        lastActive: new Date(),
        tasksCompleted: action ? 1 : 0,
        totalCost: 0,
        recentActivity: newRecentActivity,
      },
    });

    return NextResponse.json({ ok: true, agent: updatedState });
  } catch (error) {
    console.error("Agent update error:", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
