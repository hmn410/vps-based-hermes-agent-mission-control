"use client";

import { Activity } from "lucide-react";
import { LiveOrchestrator } from "@/components/live-orchestrator";
import { Eyebrow, rise } from "@/components/ui/kit";

export default function LiveWorkPage() {
  return (
    <div className="relative z-10 w-full mx-auto pt-4 pb-16">
      <header className="hq-rise mb-8" style={rise(0)}>
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-[var(--r-sm)] border border-[var(--line-strong)] bg-[var(--surface-1)] p-2 text-[var(--accent)]">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <Eyebrow>Live from Hermes</Eyebrow>
            <h1 className="mt-2.5 text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
              Live Work
            </h1>
            <p className="text-[13px] text-[var(--text-3)] mt-3 max-w-2xl">
              Follow active HQ work as it moves through Hermes: assignment, worker start, heartbeats, blockers, and completion.
            </p>
          </div>
        </div>
      </header>

      <section className="hq-rise" style={rise(1)}>
        <LiveOrchestrator expanded />
      </section>
    </div>
  );
}
