"use client";

import { useState } from "react";
import { HermesBriefing } from "@/components/hermes-briefing";
import { ApprovalInbox } from "@/components/approval-inbox";
import { GmailPanel, type GmailConnection } from "@/components/gmail-panel";
import { CalendarPanel } from "@/components/calendar-panel";
import { homePrivacyLine } from "@/lib/gmail-overview";

// Layout: what needs Josh first (Approval Inbox + Chief of Staff), then
// Calendar (a one-line connect prompt until connected), Gmail last and
// collapsed by default. The approval policy lives in the inbox header's info
// tooltip. System health lives once, in the sidebar footer.
export default function Dashboard() {
  // Driven by what the Gmail panel actually holds, so the subtitle never
  // claims a connection state that isn't true.
  const [gmail, setGmail] = useState<GmailConnection>("loading");

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <header className="pt-4 pb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow mb-2.5">Mission control · personal and JoshBuilds.Tech</div>
          <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">Morning Brief</h1>
          <p className="text-[13px] text-[var(--hq-text-ghost)] mt-3 max-w-2xl" data-testid="home-privacy-line">
            Real Hermes tasks, schedules, memory, and approvals. {homePrivacyLine(gmail)}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-5 gap-5 items-stretch">
        <div className="xl:col-span-2 min-h-[420px] xl:h-[520px]">
          <ApprovalInbox compact className="h-full" />
        </div>
        <HermesBriefing className="xl:col-span-3 min-h-[420px]" />
      </section>

      <section className="mt-9">
        <CalendarPanel className="min-h-0 max-h-[360px]" />
      </section>

      <section className="mt-9">
        <div id="gmail-area">
          <GmailPanel onConnection={setGmail} />
        </div>
      </section>
    </div>
  );
}
