"use client";

import { Eyebrow, rise } from "@/components/ui/kit";
import { SchedulesPanel } from "@/components/schedules-panel";
import { navLabel } from "@/components/nav-config";

export default function SchedulesPage() {
  return (
    <div className="relative z-10 w-full mx-auto pt-4 pb-16">
      <header className="hq-rise mb-8" style={rise(0)}>
        <Eyebrow>Hermes · recurring jobs</Eyebrow>
        <h1 className="mt-2.5 text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">
          {navLabel("/schedules")}
        </h1>
        <p className="text-[13px] text-[var(--text-3)] mt-3 max-w-2xl">
          Personal schedules you can create, run, pause, or resume. Every change waits in the Approval Inbox.
          System and hidden jobs are read-only here.
        </p>
      </header>
      <section className="hq-rise" style={rise(1)}>
        <SchedulesPanel />
      </section>
    </div>
  );
}
