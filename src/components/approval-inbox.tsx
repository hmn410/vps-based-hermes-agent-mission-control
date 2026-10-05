"use client";

/* ───────────────────────────────────────────────────────────
   Hermy HQ · Approval inbox
   "Everything that needs your tap" queue.
   Self-contained: polls /api/hermes/requests, one-tap
   approve / reject / edit via PATCH. Calm Luxury.
   ─────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import { Check, X, Pencil, Inbox, Unlock, AlertTriangle } from "lucide-react";
import {
  Panel,
  Pill,
  EmptyState,
  Eyebrow,
} from "@/components/ui/kit";

// ── Types ─────────────────────────────────────────────────
interface Req {
  id: string;
  origin: string;
  kind: string;
  title: string;
  prompt: string | null;
  sideEffecting: boolean;
  status: string;
  result: string | null;
  error: string | null;
  createdAt: string;
}

export interface FollowUpTask {
  id: string;
  title: string;
  label?: string;
  followUps: string[];
  completedAt?: string | null;
  updatedAt: string;
}

// Completed task whose kanban_complete metadata explicitly asked Josh to do
// something (follow-up.mjs). Informational: no Unblock — the work is done; the
// card links to the originating task.
export function FollowUpCard({ task, compact }: { task: FollowUpTask; compact: boolean }) {
  return (
    <Panel
      className={compact ? "p-4" : "p-5"}
      style={{ borderColor: "color-mix(in srgb, var(--warn) 28%, transparent)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="warn">Follow-up</Pill>
          {task.label && <Pill tone="neutral">{task.label}</Pill>}
        </div>
        <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 mt-1">
          {timeAgo(task.completedAt || task.updatedAt)}
        </span>
      </div>
      <h3 className="text-[15px] font-medium text-[var(--text)] leading-snug">{task.title}</h3>
      <ul className="mt-1.5 list-disc pl-4 text-[13px] text-[var(--text-2)] leading-snug">
        {task.followUps.slice(0, compact ? 2 : 6).map((item, i) => (
          <li key={i} className="line-clamp-2">{item}</li>
        ))}
      </ul>
      <a
        href={`/tasks?task=${encodeURIComponent(task.id)}`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--text)]"
        style={{ border: "1px solid var(--line)" }}
      >
        Open task {task.id}
      </a>
    </Panel>
  );
}

interface BlockedTask {
  id: string;
  title: string;
  status?: string;
  blockKind: string | null;
  attentionKind?: string;
  label?: string;
  reason: string | null;
  recurrences?: number;
  blockedAt?: string | null;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────
function timeAgo(d: string | null): string {
  if (!d) return "—";
  const diff = Date.now() - new Date(d).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ── Card ──────────────────────────────────────────────────
function InboxCard({
  req,
  compact,
  onAction,
}: {
  req: Req;
  compact: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(req.title);
  const [draftPrompt, setDraftPrompt] = useState(req.prompt ?? "");

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/hermes/requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // optimistic: card fades, parent refetches
      onAction();
    } catch {
      setBusy(false);
      setEditing(false);
    }
  };

  const pad = compact ? "p-4" : "p-5";

  return (
    <Panel className={`${pad} ${busy ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="neutral">{req.kind}</Pill>
          {req.sideEffecting && <Pill tone="warn">side-effecting</Pill>}
        </div>
        <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 mt-1">
          {timeAgo(req.createdAt)}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2.5">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full bg-transparent text-[14px] font-medium text-[var(--text)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
          />
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            rows={3}
            className="w-full bg-transparent text-[13px] text-[var(--text-2)] px-3 py-2 rounded-[8px] border border-[var(--line)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] resize-y"
          />
        </div>
      ) : (
        <>
          <h3 className="text-[15px] font-medium text-[var(--text)] leading-snug">
            {req.title}
          </h3>
          {req.prompt && (
            <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug line-clamp-2">
              {req.prompt}
            </p>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-4">
        {editing ? (
          <>
            <button
              type="button"
              onClick={() =>
                patch({
                  action: "edit",
                  title: draftTitle.trim(),
                  prompt: draftPrompt,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                color: "var(--accent)",
                border:
                  "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
                background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftTitle(req.title);
                setDraftPrompt(req.prompt ?? "");
              }}
              className="btn-ghost inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => patch({ action: "approve" })}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
              style={{
                color: "var(--up)",
                border: "1px solid color-mix(in srgb, var(--up) 30%, transparent)",
                background: "color-mix(in srgb, var(--up) 10%, transparent)",
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => patch({ action: "reject" })}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--down)]"
              style={{ border: "1px solid var(--line)" }}
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--text)]"
              style={{ border: "1px solid var(--line)" }}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

// ── Blocked kanban task card ─────────────────────────────
const BLOCK_KIND_LABEL: Record<string, string> = {
  needs_input: "needs a decision",
  capability: "hit a hard wall",
  transient: "flaky failure",
};

function BlockedCard({
  task,
  compact,
  onAction,
}: {
  task: BlockedTask;
  compact: boolean;
  onAction: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const unblock = async () => {
    setBusy(true);
    try {
      await fetch(`/api/hermes/tasks/${task.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unblock" }),
      });
      onAction();
    } catch {
      setBusy(false);
    }
  };

  const pad = compact ? "p-4" : "p-5";

  return (
    <Panel
      className={`${pad} ${busy ? "opacity-50 pointer-events-none" : ""}`}
      style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone="down">
            <AlertTriangle className="w-3 h-3" />
            {task.attentionKind === "repeat_block" ? "Blocked again" : "Blocked task"}
          </Pill>
          {(task.label || task.blockKind) && (
            <Pill tone="neutral">{task.label || BLOCK_KIND_LABEL[task.blockKind ?? ""] || task.blockKind}</Pill>
          )}
          {(task.recurrences ?? 0) >= 2 && task.attentionKind !== "repeat_block" && (
            <Pill tone="neutral">{task.recurrences}× blocked</Pill>
          )}
        </div>
        <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 mt-1">
          {timeAgo(task.blockedAt || task.updatedAt)}
        </span>
      </div>

      <h3 className="text-[15px] font-medium text-[var(--text)] leading-snug">{task.title}</h3>
      {task.reason && (
        <p className="mt-1.5 text-[13px] text-[var(--text-2)] leading-snug line-clamp-3">
          {task.reason}
        </p>
      )}

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={unblock}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
          style={{
            color: "var(--accent)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          }}
        >
          <Unlock className="w-3.5 h-3.5" />
          {busy ? "Unblocking…" : "Unblock"}
        </button>
        <a
          href={`/tasks?task=${encodeURIComponent(task.id)}`}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors text-[var(--text-2)] hover:text-[var(--text)]"
          style={{ border: "1px solid var(--line)" }}
        >
          View on board
        </a>
      </div>
    </Panel>
  );
}

// ── Main ──────────────────────────────────────────────────
export function ApprovalInbox({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const [requests, setRequests] = useState<Req[]>([]);
  const [blockedTasks, setBlockedTasks] = useState<BlockedTask[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<FollowUpTask[]>([]);
  const [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const data = await getJSON<{ requests: Req[]; pending: number; blockedTasks?: BlockedTask[]; followUpTasks?: FollowUpTask[] }>(
      "/api/hermes/requests?status=awaiting_approval&take=50"
    );
    if (data) {
      setRequests(data.requests ?? []);
      setBlockedTasks(data.blockedTasks ?? []);
      setFollowUpTasks(data.followUpTasks ?? []);
      setPending(data.pending ?? (data.requests?.length ?? 0) + (data.blockedTasks?.length ?? 0) + (data.followUpTasks?.length ?? 0));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    // First fetch is scheduled (not called synchronously in the effect body)
    // to satisfy react-hooks/set-state-in-effect.
    const first = setTimeout(load, 0);
    const iv = setInterval(load, 6000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [load]);

  // optimistic removal, then refetch to reconcile
  const handleAction = useCallback(
    (id: string) => {
      setRequests((prev) => prev.filter((r) => r.id !== id));
      setBlockedTasks((prev) => prev.filter((t) => t.id !== id));
      setPending((p) => Math.max(0, p - 1));
      load();
    },
    [load]
  );

  const totalCount = pending || requests.length + blockedTasks.length + followUpTasks.length;
  const visibleRequests = compact ? requests.slice(0, 3) : requests;
  const remainingSlots = compact ? Math.max(0, 3 - visibleRequests.length) : blockedTasks.length;
  const visibleBlocked = compact ? blockedTasks.slice(0, remainingSlots) : blockedTasks;
  const followSlots = compact ? Math.max(0, 3 - visibleRequests.length - visibleBlocked.length) : followUpTasks.length;
  const visibleFollowUps = followUpTasks.slice(0, followSlots);
  const isEmpty = requests.length === 0 && blockedTasks.length === 0 && followUpTasks.length === 0;

  return (
    <div className={`flex h-full flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <Eyebrow>Approval inbox</Eyebrow>
        <div className="flex items-center gap-1.5">
          {requests.length > 0 && <Pill tone="warn">{requests.length} to approve</Pill>}
          {blockedTasks.length > 0 && <Pill tone="down">{blockedTasks.length} blocked on you</Pill>}
          {followUpTasks.length > 0 && <Pill tone="warn">{followUpTasks.length} follow-up{followUpTasks.length === 1 ? "" : "s"}</Pill>}
          {totalCount === 0 && <Pill tone="neutral">0 pending</Pill>}
        </div>
      </div>

      {loaded && isEmpty ? (
        <Panel className="flex-1 p-2">
          <EmptyState
            icon={<Check className="w-6 h-6" style={{ color: "var(--up)" }} />}
            title="Nothing needs you right now — you're clear."
            hint="Side-effecting work, blocked tasks waiting on your call, and explicit follow-ups from completed tasks land here."
          />
        </Panel>
      ) : isEmpty ? (
        // pre-load: keep it calm, mirror empty framing
        <Panel className="flex-1 p-2">
          <EmptyState
            icon={<Inbox className="w-6 h-6" />}
            title="Checking the queue…"
          />
        </Panel>
      ) : (
        <div className={`min-h-0 flex-1 overflow-y-auto pr-1 flex flex-col ${compact ? "gap-2.5" : "gap-4"}`}>
          {visibleRequests.map((req) => (
            <InboxCard
              key={req.id}
              req={req}
              compact={compact}
              onAction={() => handleAction(req.id)}
            />
          ))}
          {visibleBlocked.map((task) => (
            <BlockedCard
              key={task.id}
              task={task}
              compact={compact}
              onAction={() => handleAction(task.id)}
            />
          ))}
          {visibleFollowUps.map((task) => (
            <FollowUpCard key={task.id} task={task} compact={compact} />
          ))}
          {compact && totalCount > visibleRequests.length + visibleBlocked.length + visibleFollowUps.length && (
            <a
              href="/hermes"
              className="inline-flex items-center gap-1 self-start text-[12.5px] font-medium transition-colors"
              style={{ color: "var(--accent)" }}
            >
              View all in Hermes →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
