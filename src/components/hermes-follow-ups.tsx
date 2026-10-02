"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, MessageSquare, RefreshCw, Send } from "lucide-react";
import { EmptyState, Panel, Pill, SectionHeader } from "@/components/ui/kit";

type RequestMessage = {
  id: string;
  title: string;
  prompt: string | null;
  replyText: string | null;
  conversationId: string | null;
  replyToId: string | null;
  status: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Conversation = { id: string; messages: RequestMessage[] };

const STATUS_TONE: Record<string, "neutral" | "up" | "down" | "warn" | "accent"> = {
  done: "up", failed: "down", rejected: "neutral", awaiting_approval: "warn", queued: "neutral", running: "accent", approved: "accent",
};

function ago(date: string) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function ReplyBox({ request, onQueued }: { request: RequestMessage; onQueued: () => void }) {
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

function ConversationCard({ conversation, onQueued }: { conversation: Conversation; onQueued: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const root = conversation.messages[0];
  const latest = conversation.messages[conversation.messages.length - 1];
  const hasReplies = conversation.messages.length > 1;
  return (
    <Panel className="p-4">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-start gap-3 text-left">
        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[var(--accent)]"><MessageSquare className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] leading-snug text-[var(--text)]">{root.title.replace(/^Follow-up: /, "")}</p>
            <Pill tone={STATUS_TONE[latest.status] || "neutral"}>{latest.status.replaceAll("_", " ")}</Pill>
            <span className="ml-auto shrink-0 num text-[10.5px] text-[var(--text-3)]">{ago(latest.finishedAt || latest.createdAt)}</span>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--text-3)]">{hasReplies ? `${conversation.messages.length - 1} follow-up${conversation.messages.length === 2 ? "" : "s"}` : "No follow-ups yet"}</p>
        </div>
      </button>
      {expanded && (
        <div className="ml-8 mt-4 space-y-4 border-l border-[var(--line)] pl-4">
          {conversation.messages.map((message, index) => {
            const body = message.error || message.result;
            const userText = index === 0 ? message.prompt : message.replyText;
            return (
              <div key={message.id} className="space-y-2">
                <div className="flex items-center gap-2"><Pill tone={index === 0 ? "neutral" : "accent"}>{index === 0 ? "Original request" : "Your follow-up"}</Pill><span className="num text-[10.5px] text-[var(--text-3)]">{ago(message.createdAt)}</span></div>
                {userText && <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--text-2)]">{userText}</p>}
                <div className="rounded-[9px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="mb-1 text-[10.5px] uppercase tracking-wide text-[var(--text-4)]">Hermes</p>
                  <p className={`whitespace-pre-wrap break-words text-[12.5px] leading-relaxed ${message.error ? "text-[var(--down)]" : "text-[var(--text-2)]"}`}>{body || (message.status === "done" ? "Completed without a written result." : "Working on it…")}</p>
                </div>
                <ReplyBox request={message} onQueued={onQueued} />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function HermesFollowUps() {
  const [requests, setRequests] = useState<RequestMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/requests?take=200", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.requests)) setRequests(data.requests);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); const interval = window.setInterval(load, 5000); return () => window.clearInterval(interval); }, [load]);

  const conversations = useMemo(() => {
    const grouped = new Map<string, RequestMessage[]>();
    for (const request of requests) {
      const key = request.conversationId || request.id;
      grouped.set(key, [...(grouped.get(key) || []), request]);
    }
    return Array.from(grouped, ([id, messages]) => ({ id, messages: messages.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) }))
      .sort((a, b) => +new Date(b.messages[b.messages.length - 1].createdAt) - +new Date(a.messages[a.messages.length - 1].createdAt));
  }, [requests]);

  return (
    <div className="w-full mx-auto p-6 pb-16">
      <div className="flex items-end justify-between gap-4 pb-8">
        <div><div className="eyebrow mb-2.5 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Follow-ups</div><h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Hermes conversations</h1><p className="mt-3 text-[12.5px] text-[var(--text-3)]">Reply to a result to correct it, continue the work, or ask for the missing deliverable.</p></div>
        <button type="button" onClick={() => { setRefreshing(true); void load(); }} className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]" disabled={refreshing}><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      {!loaded ? <Panel><div className="sk m-1 h-28 rounded-[10px]" /></Panel> : conversations.length === 0 ? <Panel><EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No Hermes conversations yet" hint="Dashboard requests and their follow-ups will appear here." /></Panel> : <div className="space-y-3"><SectionHeader label="Conversation history" title="Requests and replies" action={<span className="num text-[11px] text-[var(--text-3)]">{conversations.length} threads</span>} />{conversations.map((conversation) => <ConversationCard key={conversation.id} conversation={conversation} onQueued={load} />)}</div>}
    </div>
  );
}
