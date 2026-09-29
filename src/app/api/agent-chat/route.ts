import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requiresApproval } from '@/lib/dispatch-policy';

interface AgentChatRequest {
  agentId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// Each Agents-tab persona maps to a REAL Hermes profile (kanban assignee).
// This routes chat through the SAME pipeline as the main /hermes dispatch
// bar (real kanban task, real orchestrator, real tools/data) — not a toy
// chatbot — and each persona's task is actually picked up and run by its
// own dedicated Hermes profile, not all funneled through `default`.
const AGENT_PROFILES: Record<string, { assignee: string; prompt: string }> = {
  max: {
    assignee: 'default',
    prompt:
      "You are Max, Josh's Chief of Staff / orchestrator persona (Hermes 'default' profile). Josh is a Systems Engineer at Integris (MSP, ~19 clients, Microsoft/Entra/Azure) who also runs JoshBuilds.Tech (building/hosting client websites). Be sharp, concise, strategic. " +
      "You can delegate: when the request clearly belongs to a specialist, create a child kanban task via kanban_create assigned to the right profile — 'ops' for Integris/MSP systems work, 'builder' for JoshBuilds.Tech site builds/hosting, 'personal' for Josh's personal/home-base tasks, 'seocontent' for blog/SEO content. Only delegate when it's clearly that specialist's lane; otherwise just answer directly. If you delegate, say so briefly in your reply (e.g. 'Handed this to Builder, task <id> — I'll have the summary shortly') — do not wait for the child task before replying.",
  },
  sage: {
    assignee: 'ops',
    prompt:
      "You are Sage, Josh's Ticket Ops assistant (Hermes 'ops' profile — Integris/MSP systems specialist). You help triage his Integris client support queue: summarizing open tickets, flagging stale/overdue items, drafting ticket notes, and tracking which of his ~19 MSP clients need attention. Be concise and operational.",
  },
  knox: {
    assignee: 'builder',
    prompt:
      "You are Knox, Josh's Build Ops assistant (Hermes 'builder' profile). You track status on active JoshBuilds.Tech client site builds and hosting, draft plans for in-progress work (e.g. redesigns), and flag what's queued vs. shipped vs. blocked. Be concise and concrete.",
  },
  nova: {
    assignee: 'personal',
    prompt:
      "You are Nova, Josh's personal Home Base assistant (Hermes 'personal' profile). You help with daily planning, weekly resets, and personal task tracking — kept separate from client/business work. Be warm but efficient.",
  },
  pixel: {
    assignee: 'seocontent',
    prompt:
      "You are Pixel, Josh's Content assistant (Hermes 'seocontent' profile). You draft blog posts, case studies, SEO copy, and social content about his JoshBuilds.Tech web builds and hosting work. Be sharp and specific, no generic fluff.",
  },
};

// POST { agentId, message, history? } → queues a real kanban task via the
// AgentRequest table, same mechanism as /api/hermes/dispatch, assigned to
// the persona's real Hermes profile. Returns the request id for the client
// to poll with GET ?id=.
export async function POST(request: NextRequest) {
  try {
    const body: AgentChatRequest = await request.json();
    const { agentId, message, history = [] } = body;

    if (!agentId || !message) {
      return NextResponse.json({ error: 'Missing agentId or message' }, { status: 400 });
    }
    const persona = AGENT_PROFILES[agentId];
    if (!persona) {
      return NextResponse.json({ error: `Unknown agent: ${agentId}` }, { status: 400 });
    }

    const historyText = history.length
      ? '\n\nConversation so far:\n' +
        history.map((m) => `${m.role === 'user' ? 'Josh' : 'You'}: ${m.content}`).join('\n')
      : '';

    const prompt = [
      persona.prompt,
      historyText,
      '\n\nJosh just said: ' + message,
      '\n---\nThis is a live chat from the Hermy HQ Agents tab (not an internal handoff task). Reply in-character as this persona. When you finish, call kanban_complete with the FULL reply text in the `summary` field — write out the complete response Josh should read, not a short handoff.',
    ].join('');

    const title = `[${agentId}] ${message}`.slice(0, 200);
    // Only the user's raw message is checked against the external-action
    // guard — the wrapped prompt includes our own instructional boilerplate
    // ("...call kanban_complete with the FULL reply text...") which contains
    // trigger words like "reply" and would otherwise force every chat into
    // approval regardless of what the user actually asked.
    const sideEffecting = requiresApproval('chat', message);

    const row = await prisma.agentRequest.create({
      data: {
        origin: 'web',
        kind: 'chat',
        title,
        prompt,
        assignee: persona.assignee,
        sideEffecting,
        status: sideEffecting ? 'awaiting_approval' : 'queued',
      },
    });

    // Reflect "working" on the Agents tab immediately.
    await prisma.agentState.upsert({
      where: { id: agentId },
      update: { status: 'working', currentTask: row.title, lastActive: new Date() },
      create: { id: agentId, name: agentId, status: 'working', currentTask: row.title, lastActive: new Date() },
    });

    return NextResponse.json({ requestId: row.id, status: row.status });
  } catch (error) {
    console.error('Agent chat dispatch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET ?id=<requestId> → poll status/result for the client chat modal.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const row = await prisma.agentRequest.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({
    status: row.status,
    result: row.result,
    error: row.error,
  });
}
