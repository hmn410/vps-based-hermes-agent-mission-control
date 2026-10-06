"use client";

/* Hermes activity events (/api/hermes/activity): run starts/finishes, brief
   generation, status changes. Shown on Tasks → History next to the kanban
   execution feed. */

import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon } from "lucide-react";
import { Panel, SectionHeader, EmptyState, Skeleton, Pill } from "@/components/ui/kit";

type EvLevel = "info" | "up" | "warn" | "down";
interface Ev {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  agent: string | null;
  level: EvLevel;
  createdAt: string;
  /** Current lifecycle of the linked request/task, recomputed on every poll by
   *  /api/hermes/activity. The event row itself is append-only and never changes. */
  current?: { status: string; label: string; tone: "neutral" | "accent" | "warn" | "up" | "down"; taskId: string | null } | null;
}

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

function levelColor(l: EvLevel): string {
  if (l === "up") return "var(--up)";
  if (l === "down") return "var(--down)";
  if (l === "warn") return "var(--warn)";
  return "var(--text-3)";
}

// ── Activity feed ─────────────────────────────────────────
const ACTIVITY_PAGE_SIZE = 10;
function ActivityFeed({ events }: { events: Ev[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / ACTIVITY_PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageEvents = events.slice(clampedPage * ACTIVITY_PAGE_SIZE, clampedPage * ACTIVITY_PAGE_SIZE + ACTIVITY_PAGE_SIZE);
  return (
    <>
      <SectionHeader
        label="Activity"
        title="Recent events"
        action={
          events.length > 0 ? (
            <span className="num text-[11px] text-[var(--text-3)]">{events.length} total</span>
          ) : undefined
        }
      />
      {events.length === 0 ? (
        <Panel className="p-2">
          <EmptyState
            icon={<ActivityIcon className="w-6 h-6" />}
            title="No recent activity"
            hint="Events from Hermes and its agents will stream in here."
          />
        </Panel>
      ) : (
        <>
          <Panel className="p-2">
            <div className="divide-y divide-[var(--line)]">
              {pageEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-3.5 py-3">
                  <span
                    className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: levelColor(e.level) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-[var(--text)] leading-snug truncate">
                        {e.title}
                      </p>
                      {e.current && <Pill tone={e.current.tone}>{`Now: ${e.current.label}`}</Pill>}
                      <span className="num text-[10.5px] text-[var(--text-3)] shrink-0 ml-auto">
                        {timeAgo(e.createdAt)}
                      </span>
                    </div>
                    {e.detail && (
                      <p className="mt-0.5 text-[12.5px] text-[var(--text-2)] leading-snug line-clamp-2">
                        {e.detail}
                      </p>
                    )}
                    {e.agent && (
                      <span className="num text-[10.5px] text-[var(--text-3)] mt-1 inline-block">
                        {e.agent}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-3 px-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <span className="num text-[11px] text-[var(--text-3)]">
                Page {clampedPage + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={clampedPage >= pageCount - 1}
                className="btn-ghost inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function ActivityEvents() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hermes/activity?take=30", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { events?: Ev[] };
        setEvents(d.events ?? []);
      }
    } catch {
      /* keep last known events */
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const iv = window.setInterval(load, 8000);
    return () => { window.clearTimeout(first); window.clearInterval(iv); };
  }, [load]);
  if (!loaded) {
    return (
      <>
        <SectionHeader label="Activity" title="Recent events" />
        <Skeleton className="h-64" />
      </>
    );
  }
  return <ActivityFeed events={events} />;
}
