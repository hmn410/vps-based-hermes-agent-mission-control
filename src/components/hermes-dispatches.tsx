"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { EmptyState, Panel, Pill, SectionHeader } from "@/components/ui/kit";

type Req = {
  id: string;
  origin: string;
  kind: string;
  title: string;
  prompt: string | null;
  sideEffecting: boolean;
  status: string;
  result: string | null;
  error: string | null;
  hermesTaskId?: string | null;
  createdAt: string;
  finishedAt: string | null;
  lifecycle?: {
    label: string;
    queueAgeMs: number | null;
    dispatcherAttention: boolean;
    latestEvent: { kind: string; createdAt: string; message: string | null } | null;
    blockerReason: string | null;
    mirrorFreshnessMs: number | null;
  };
};

function ago(d: string | null): string {
  if (!d) return "";
  const seconds = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

const TONE: Record<string, "neutral" | "up" | "down" | "warn" | "accent"> = {
  queued: "neutral",
  waiting_for_dispatch: "neutral",
  awaiting_approval: "warn",
  approved: "accent",
  running: "accent",
  review: "accent",
  blocked: "warn",
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
const TERMINAL = new Set(["done", "failed", "rejected"]);

function DeliveryMeta({ request }: { request: Req }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 num text-[10.5px] text-[var(--text-3)]">
      <span>Source: Mission Control</span>
      <span aria-hidden>→</span>
      <span>{request.hermesTaskId ? "Hermes Kanban" : "Hermes"}</span>
      <span aria-hidden>→</span>
      <span>Delivery: Dashboard</span>
      {request.hermesTaskId && <span className="text-[var(--text-4)]">· {request.hermesTaskId}</span>}
    </div>
  );
}

function AnswerCard({ request }: { request: Req }) {
  const [copied, setCopied] = useState(false);
  const body = request.error || request.result;
  const copy = async () => {
    if (!body || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--up)_12%,transparent)] text-[var(--up)]">
          <Check className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] leading-snug text-[var(--text)]">{request.title}</p>
            <Pill tone={request.error ? "down" : TONE[request.status] || "up"}>{LABEL[request.status] || request.status}</Pill>
            <span className="ml-auto shrink-0 num text-[10.5px] text-[var(--text-3)]">{ago(request.finishedAt || request.createdAt)}</span>
          </div>
          <DeliveryMeta request={request} />
          {body ? (
            <div className="mt-3 rounded-[9px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
              <p className={`whitespace-pre-wrap break-words text-[12.5px] leading-relaxed ${request.error ? "text-[var(--down)]" : "text-[var(--text-2)]"}`}>
                {body}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-[var(--text-3)]">Hermes completed this work without a written result.</p>
          )}
          {body && (
            <button type="button" onClick={copy} className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--text-3)] hover:text-[var(--text-2)]">
              <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy result"}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ActiveCard({ request }: { request: Req }) {
  const tone = TONE[request.status] || "neutral";
  const lifecycle = request.lifecycle;
  const queueAge = duration(lifecycle?.queueAgeMs ?? null);
  const mirrorAge = duration(lifecycle?.mirrorFreshnessMs ?? null);
  return (
    <Panel className="p-4">
      <div className="flex items-start gap-3">
        <span className="relative mt-1 flex h-2 w-2 shrink-0">
          {request.status === "running" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-[var(--text)]">{request.title}</p>
          <DeliveryMeta request={request} />
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 num text-[10.5px] text-[var(--text-3)]">
            {queueAge && <span>Queue age: {queueAge}</span>}
            {lifecycle?.latestEvent && <span>Latest: {lifecycle.latestEvent.kind} {ago(lifecycle.latestEvent.createdAt)}</span>}
            {mirrorAge && <span>Mirror: {mirrorAge} ago</span>}
          </div>
          {request.status === "waiting_for_dispatch" && (
            <p className="mt-2 text-[12px] text-[var(--text-3)]">Waiting for a dispatcher to claim this task.</p>
          )}
          {lifecycle?.dispatcherAttention && (
            <p className="mt-2 text-[12px] text-[var(--warn)]">Dispatcher attention: this task has waited over 2 minutes without a claim.</p>
          )}
          {request.status === "blocked" && (
            <p className="mt-2 text-[12px] text-[var(--warn)]">Blocked: {lifecycle?.blockerReason || request.error || "Waiting for input"}</p>
          )}
        </div>
        <Pill tone={tone}>{lifecycle?.label || LABEL[request.status] || request.status}</Pill>
      </div>
    </Panel>
  );
}

export function HermesDispatches() {
  const [requests, setRequests] = useState<Req[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/hermes/requests?take=15");
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
    load();
    const interval = window.setInterval(load, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  if (!loaded) return <Panel><div className="sk m-1 h-24 rounded-[10px]" /></Panel>;
  if (requests.length === 0) {
    return <Panel><EmptyState icon={<Send className="h-5 w-5" />} title="No dashboard requests yet" hint="Ask Hermes from the composer above; answers return here." /></Panel>;
  }

  const active = requests.filter((request) => !TERMINAL.has(request.status));
  const answers = requests.filter((request) => TERMINAL.has(request.status)).slice(0, 8);

  return (
    <div className="flex flex-col gap-9">
      <section>
        <SectionHeader label="Current work" title="In flight" action={<span className="num text-[11px] text-[var(--text-3)]">{active.length} active</span>} />
        {active.length ? (
          <div className="flex flex-col gap-2.5">{active.map((request) => <ActiveCard key={request.id} request={request} />)}</div>
        ) : (
          <p className="px-1 text-[12.5px] text-[var(--text-3)]">No dashboard-originated work is in flight.</p>
        )}
      </section>
      <section>
        <SectionHeader label="Latest answers" title="Returned to this dashboard" action={<span className="num text-[11px] text-[var(--text-3)]">{answers.length} recent</span>} />
        <div className="flex flex-col gap-2.5">{answers.map((request) => <AnswerCard key={request.id} request={request} />)}</div>
      </section>
    </div>
  );
}
