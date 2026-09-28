"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, RefreshCw, ExternalLink } from "lucide-react";
import { Panel, Eyebrow, EmptyState } from "@/components/ui/kit";

interface Ev {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  htmlLink: string | null;
}

const eventColors = ["#4285f4", "#34a853", "#fbbc04", "#ea4335", "#a142f4", "#24c1e0"];

function eventDate(iso: string | null) {
  if (!iso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtTime(iso: string | null) {
  if (!iso) return "All day";
  const d = eventDate(iso);
  if (!d) return iso;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function CalendarPanel({ className = "" }: { className?: string }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/google/calendar");
      if (r.ok) {
        const d = await r.json();
        setConnected(Boolean(d.connected));
        setEvents(d.events ?? []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Panel className={`flex flex-col overflow-hidden p-6 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <CalendarCheck className="w-4 h-4 text-[var(--accent)]" />
          <Eyebrow>Calendar · next 7 days</Eyebrow>
        </div>
        <button onClick={load} className="btn-ghost p-1.5 rounded-full" aria-label="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!connected ? (
        <EmptyState icon={<CalendarCheck className="w-5 h-5" />} title="Calendar is not connected" hint="Sign out and back in to grant Calendar access." />
      ) : events === null ? (
        <div className="sk h-20 rounded-[10px]" />
      ) : events.length === 0 ? (
        <EmptyState icon={<CalendarCheck className="w-5 h-5" />} title="Nothing scheduled" hint="No events in the next 7 days." />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {events.map((e, index) => {
            const date = eventDate(e.start);
            const color = eventColors[index % eventColors.length];
            return (
            <a
              key={e.id}
              href={e.htmlLink || "#"}
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.045]"
            >
              <div className="w-10 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/[0.035] text-center leading-none">
                <div className="py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/80" style={{ background: color }}>
                  {date ? date.toLocaleDateString("en-US", { weekday: "short" }) : "All day"}
                </div>
                <div className="py-1.5 text-[16px] font-semibold text-[var(--text)]">{date?.getDate() ?? "•"}</div>
                {date && <div className="pb-1.5 text-[9px] uppercase text-[var(--text-3)]">{date.toLocaleDateString("en-US", { month: "short" })}</div>}
              </div>
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[var(--text)] truncate">{e.summary}</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-3)] truncate">
                  {fmtTime(e.start)}{e.location ? ` · ${e.location}` : ""}
                </p>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-[var(--text-4)] group-hover:text-[var(--text-2)] shrink-0" />
            </a>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
