"use client";

/* Read-only agent roster: one row per Hermes profile with its live status,
   current task (linked to Tasks), and last run — all derived by
   hermes-bridge from real kanban state (syncAgentStates). Dispatching to a
   profile happens from the Dispatch composer ("Dispatch to"), so every
   conversation shares one history. */

import { useCallback, useEffect, useState } from "react";
import { Bot, Send } from "lucide-react";
import { Panel, Pill, Eyebrow, EmptyState, rise } from "@/components/ui/kit";
import { navLabel } from "@/components/nav-config";
import { profileForAgent } from "@/lib/agent-roster";
import { isAgentActivelyWorking } from "@/lib/agent-activity";

interface AgentActivity {
  timestamp: string;
  action: string;
  result?: string;
}

interface Agent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  status: string;
  currentTask?: string;
  lastActive?: string;
  tasksCompleted: number;
  recentActivity: AgentActivity[];
}

interface MirrorTask {
  id: string;
  title: string;
  assignee: string | null;
  status: string;
}

type Tone = "neutral" | "up" | "down" | "warn" | "accent";
const STATUS: Record<string, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "accent" },
  idle: { label: "Idle", tone: "neutral" },
  error: { label: "Error", tone: "down" },
  offline: { label: "Offline", tone: "neutral" },
  online: { label: "Idle", tone: "neutral" },
};

const ACTIVE = new Set(["triage", "todo", "ready", "running", "review", "blocked"]);

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(diff)) return "—";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function AgentRow({ agent, task, active }: { agent: Agent; task: MirrorTask | null; active: boolean }) {
  const status = STATUS[agent.status] ?? { label: agent.status, tone: "neutral" as Tone };
  const profile = profileForAgent(agent.id) ?? agent.id;
  const lastRun = agent.recentActivity?.[0];
  const currentTitle = task?.title ?? (agent.status === "working" ? agent.currentTask : undefined);
  return (
    <Panel className={`p-4${active ? " agent-active" : ""}`}>
      <div className="flex items-start gap-3.5">
        <div
          className="w-10 h-10 rounded-[var(--r-md)] flex items-center justify-center text-xl shrink-0"
          style={{ background: "var(--surface-2)", border: "1px solid var(--line)" }}
          aria-hidden
        >
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--text)]">{agent.name}</h3>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: "var(--surface-2)", border: "1px solid var(--line)", color: "var(--text-3)" }}
              title="Hermes profile"
            >
              {profile}
            </span>
            <Pill tone={status.tone}>{status.label}</Pill>
            {active && (
              <span className="agent-active-tag font-mono text-[10.5px] uppercase tracking-wide" title="A task for this profile is running now">
                Running now<span className="agent-active-cursor" aria-hidden />
              </span>
            )}
          </div>
          <p className="text-[12px] text-[var(--text-3)] mt-1">{agent.role}</p>

          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="eyebrow !text-[10px] pt-0.5">Current task</dt>
            <dd className="min-w-0 text-[var(--text-2)]">
              {currentTitle ? (
                task ? (
                  <a href={`/tasks?task=${encodeURIComponent(task.id)}`} className="text-[var(--accent)] hover:text-[var(--text)] truncate inline-block max-w-full align-bottom">
                    {currentTitle} <span className="num text-[10.5px] text-[var(--text-4)]">{task.id}</span>
                  </a>
                ) : (
                  <span className="truncate inline-block max-w-full align-bottom">{currentTitle}</span>
                )
              ) : (
                <span className="text-[var(--text-4)]">None</span>
              )}
            </dd>
            <dt className="eyebrow !text-[10px] pt-0.5">Last run</dt>
            <dd className="min-w-0 text-[var(--text-2)]">
              {lastRun ? (
                <span className="truncate inline-block max-w-full align-bottom">
                  <span className="num text-[var(--text-4)] mr-2">{timeAgo(lastRun.timestamp)}</span>
                  {lastRun.action}
                </span>
              ) : agent.lastActive ? (
                <span className="num">{timeAgo(agent.lastActive)}</span>
              ) : (
                <span className="text-[var(--text-4)]">No runs recorded</span>
              )}
            </dd>
          </dl>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-[20px] font-semibold text-[var(--text)] leading-none">{agent.tasksCompleted}</div>
          <div className="eyebrow mt-1.5">done</div>
        </div>
      </div>
    </Panel>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<MirrorTask[]>([]);
  // False when the latest task poll failed: the glow then follows the
  // bridge's live AgentState instead of a stale earlier task list.
  const [tasksLive, setTasksLive] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/hermes/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (Array.isArray(a)) setAgents(a);
    if (t && Array.isArray(t.tasks)) setTasks(t.tasks);
    setTasksLive(Boolean(t && Array.isArray(t.tasks)));
    setLoading(false);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const interval = setInterval(load, 10000);
    return () => { clearTimeout(first); clearInterval(interval); };
  }, [load]);

  // Link each agent's current task: first active kanban task for its profile.
  const taskFor = (agent: Agent): MirrorTask | null => {
    const profile = profileForAgent(agent.id);
    if (!profile) return null;
    const mine = tasks.filter((t) => t.assignee === profile && ACTIVE.has(t.status));
    return mine.find((t) => t.title === agent.currentTask) ?? mine.find((t) => t.status === "running") ?? mine[0] ?? null;
  };

  const working = agents.filter((a) => a.status === "working").length;

  return (
    <div className="relative z-10 w-full mx-auto pt-4 pb-16">
      <header className="hq-rise flex flex-wrap items-end justify-between gap-4 mb-8" style={rise(0)}>
        <div>
          <Eyebrow>Hermes profiles · roster</Eyebrow>
          <h1 className="mt-2.5 text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
            {navLabel("/agents")}
          </h1>
          <p className="text-[13px] text-[var(--text-3)] mt-3 max-w-2xl">
            Status comes from the kanban board. To send work to a profile, use <span className="text-[var(--text-2)]">Dispatch to</span> on the Dispatch page.
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="num text-[20px] font-semibold leading-none" style={{ color: "var(--accent)" }}>
              {working}<span className="text-[var(--text-4)]">/{agents.length}</span>
            </div>
            <div className="eyebrow mt-1.5">Working</div>
          </div>
          <a href="/hermes" className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]">
            <Send className="w-3.5 h-3.5" /> Dispatch
          </a>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="sk h-32 rounded-[var(--r-lg)]" />)}
        </div>
      ) : agents.length === 0 ? (
        <Panel className="p-2">
          <EmptyState icon={<Bot className="w-6 h-6" />} title="No agents" hint="The agent roster could not be loaded." />
        </Panel>
      ) : (
        <div className="hq-rise grid grid-cols-1 lg:grid-cols-2 gap-4" style={rise(1)}>
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              task={taskFor(agent)}
              active={isAgentActivelyWorking(agent.status, profileForAgent(agent.id), tasksLive ? tasks : null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
