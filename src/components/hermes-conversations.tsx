"use client";

/* Dispatch page conversations: one poll of /api/hermes/requests feeds the
   thread list (original request + follow-ups grouped by conversationId) with
   status filter, search, and pagination. Replaces the old separate "Latest answers" list and the
   /follow-ups page (which now redirects here; ?thread=<id> opens a thread). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Copy, MessageSquare, Search, Send } from "lucide-react";
import { EmptyState, Panel, Pill, SectionHeader } from "@/components/ui/kit";
import {
  countByState,
  filterThreads,
  groupThreads,
  pageOfThread,
  paginate,
  threadState,
  type Thread,
  type ThreadFilter,
  type ThreadMessage,
} from "@/lib/threads";
import { DEFAULT_DISPATCH_PROFILE } from "@/lib/dispatch-targets";

type Req = ThreadMessage & {
  origin: string;
  kind: string;
  assignee?: string | null;
  sideEffecting: boolean;
  hermesTaskId?: string | null;
};

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

function ago(d: string | null): string {
  if (!d) return "";
  const seconds = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const TONE: Record<string, Tone> = {
  queued: "neutral",
  waiting_for_dispatch: "neutral",
  awaiting_approval: "warn",
  approved: "accent",
  running: "accent",
  review: "accent",
  blocked: "down",
  done: "up",
  failed: "down",
  rejected: "neutral",
};
const LABEL: Record<string, string> = {
  queued: "Queued",
  waiting_for_dispatch: "Queued for dispatcher",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  running: "Running",
  review: "In review",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
};

function ProfileTag({ assignee }: { assignee?: string | null }) {
  if (!assignee || assignee === DEFAULT_DISPATCH_PROFILE) return null;
  return (
    <span className="num text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--line)] text-[var(--text-3)]" title="Hermes profile this ran on">
      → {assignee}
    </span>
  );
}

function TaskLink({ id }: { id?: string | null }) {
  if (!id) return null;
  return (
    <a href={`/tasks?task=${encodeURIComponent(id)}`} className="num text-[10.5px] text-[var(--accent)] hover:text-[var(--text)]">
      {id} →
    </a>
  );
}

// ── Threads ───────────────────────────────────────────────
function ReplyBox({ request, onQueued }: { request: Req; onQueued: () => void }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    if (!feedback.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`/api/hermes/requests/${request.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback: feedback.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not queue the follow-up.");
      setFeedback("");
      setOpen(false);
      setNote(data.request?.status === "awaiting_approval" ? "Sent to approval inbox." : "Follow-up queued for Hermes.");
      onQueued();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not queue the follow-up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      {open ? (
        <div className="rounded-[9px] border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={3}
            placeholder="Tell Hermes what is missing, incorrect, or what to do next…"
            className="w-full resize-y bg-transparent text-[12.5px] leading-relaxed text-[var(--text-2)] placeholder:text-[var(--text-4)] outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={submit} disabled={busy || !feedback.trim()} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] disabled:opacity-50">
              <Send className="h-3.5 w-3.5" /> {busy ? "Queueing…" : "Send follow-up"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-2.5 py-1.5 text-[11.5px]">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px]">
          <MessageSquare className="h-3.5 w-3.5" /> Reply / request correction
        </button>
      )}
      {note && <p className="mt-2 text-[11.5px] text-[var(--text-3)]">{note}</p>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)]"
    >
      <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ThreadCard({ thread, initiallyOpen, onQueued }: { thread: Thread<Req>; initiallyOpen: boolean; onQueued: () => void }) {
  // Done threads start collapsed; the latest answer of an open thread is
  // previewed inline so Josh can see what needs a reply without expanding.
  const [expanded, setExpanded] = useState(initiallyOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initiallyOpen) ref.current?.scrollIntoView({ block: "center" });
  }, [initiallyOpen]);
  const root = thread.messages[0];
  const latest = thread.messages[thread.messages.length - 1];
  const state = threadState(thread);
  const preview = state !== "done" ? latest.error || latest.result : null;
  const replies = thread.messages.length - 1;
  const req = root as Req;
  return (
    <div ref={ref} id={`thread-${thread.id}`}>
      <Panel className={`p-4 ${state === "done" && !expanded ? "opacity-80" : ""}`}>
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex w-full items-start gap-3 text-left">
          <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]">
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13.5px] leading-snug text-[var(--text)]">{root.title.replace(/^Follow-up: /, "")}</p>
              <Pill tone={TONE[latest.status] || "neutral"}>{LABEL[latest.status] || latest.status.replaceAll("_", " ")}</Pill>
              <ProfileTag assignee={req.assignee} />
              <span className="ml-auto shrink-0 num text-[10.5px] text-[var(--text-3)]">{ago(latest.finishedAt || latest.createdAt)}</span>
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--text-3)]">
              {replies > 0 ? `${replies} follow-up${replies === 1 ? "" : "s"}` : "No follow-ups yet"}
            </p>
            {!expanded && preview && (
              <p className={`mt-1.5 text-[12px] leading-snug line-clamp-2 ${latest.error ? "text-[var(--down)]" : "text-[var(--text-2)]"}`}>{preview}</p>
            )}
          </div>
          <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-[var(--text-3)] transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {expanded && (
          <div className="ml-8 mt-4 space-y-4 border-l border-[var(--line)] pl-4">
            {thread.messages.map((message, index) => {
              const body = message.error || message.result;
              const userText = index === 0 ? message.prompt : message.replyText;
              const m = message as Req;
              return (
                <div key={message.id} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={index === 0 ? "neutral" : "accent"}>{index === 0 ? "Original request" : "Your follow-up"}</Pill>
                    <span className="num text-[10.5px] text-[var(--text-3)]">{ago(message.createdAt)}</span>
                    <TaskLink id={m.hermesTaskId} />
                  </div>
                  {userText && <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--text-2)]">{userText}</p>}
                  <div className="rounded-[9px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Hermes</p>
                      {body && <CopyButton text={body} />}
                    </div>
                    <p className={`whitespace-pre-wrap break-words text-[12.5px] leading-relaxed ${message.error ? "text-[var(--down)]" : "text-[var(--text-2)]"}`}>
                      {body || (message.status === "done" ? "Completed without a written result." : "Working on it…")}
                    </p>
                  </div>
                  <ReplyBox request={m} onQueued={onQueued} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

const FILTERS: { key: ThreadFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "needs_reply", label: "Needs reply" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
];

export function HermesConversations({ refreshKey = 0 }: { refreshKey?: number }) {
  const searchParams = useSearchParams();
  const focusThread = searchParams.get("thread");
  const [requests, setRequests] = useState<Req[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<ThreadFilter>(focusThread ? "all" : "active");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [focusApplied, setFocusApplied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/requests?take=200", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.requests)) setRequests(data.requests);
    } catch {
      // Keep the last successful list visible during a transient refresh failure.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(load, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load, refreshKey]);

  const threads = useMemo(() => groupThreads(requests), [requests]);
  const counts = useMemo(() => countByState(threads), [threads]);
  const filtered = useMemo(() => filterThreads(threads, filter, query), [threads, filter, query]);

  // ?thread=<id> (old /follow-ups links): jump to the page holding it, once.
  useEffect(() => {
    if (!focusThread || focusApplied || !loaded) return;
    const target = pageOfThread(filtered, focusThread);
    const timer = window.setTimeout(() => {
      if (target >= 0) setPage(target);
      setFocusApplied(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusThread, focusApplied, loaded, filtered]);

  const paged = paginate(filtered, page);

  if (!loaded) return <Panel><div className="sk m-1 h-24 rounded-[10px]" /></Panel>;

  return (
    <div className="flex flex-col">
      <section id="threads">
        <SectionHeader
          label="Conversations"
          title="Requests and replies"
          action={<span className="num text-[11px] text-[var(--text-3)]">{threads.length} threads</span>}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => { setFilter(f.key); setPage(0); }}
              aria-pressed={filter === f.key}
              className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 border ${
                filter === f.key
                  ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)]"
                  : "text-[var(--text-3)] hover:text-[var(--text)] border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
            >
              {f.label}
              <span className="num text-[10px] text-[var(--text-4)]">{counts[f.key]}</span>
            </button>
          ))}
          <label className="ml-auto flex min-w-[220px] items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 focus-within:border-[var(--line-strong)]">
            <Search className="h-3.5 w-3.5 text-[var(--text-3)]" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Search threads…"
              aria-label="Search threads"
              className="w-full bg-transparent text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-4)] outline-none"
            />
          </label>
        </div>

        {threads.length === 0 ? (
          <Panel><EmptyState icon={<Send className="h-5 w-5" />} title="No Hermes conversations yet" hint="Ask Hermes from the composer above; answers and your follow-ups appear here." /></Panel>
        ) : filtered.length === 0 ? (
          <Panel><EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No threads match" hint="Try another filter or clear the search." /></Panel>
        ) : (
          <div className="space-y-3">
            {paged.items.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                initiallyOpen={Boolean(focusThread) && (thread.id === focusThread || thread.messages.some((m) => m.id === focusThread))}
                onQueued={load}
              />
            ))}
          </div>
        )}

        {paged.pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, paged.page - 1))}
              disabled={paged.page === 0}
              className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="num text-[11px] text-[var(--text-3)]">Page {paged.page + 1} of {paged.pageCount} · {filtered.length} threads</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(paged.pageCount - 1, paged.page + 1))}
              disabled={paged.page >= paged.pageCount - 1}
              className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
