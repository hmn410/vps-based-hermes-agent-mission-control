"use client";

import { useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { HermesBriefing } from "@/components/hermes-briefing";
import { ApprovalInbox } from "@/components/approval-inbox";
import { GmailPanel, type GmailConnection } from "@/components/gmail-panel";
import { CalendarPanel } from "@/components/calendar-panel";
import { homePrivacyLine } from "@/lib/gmail-overview";

export default function Dashboard() {
  // Driven by what the Gmail panel actually holds, so the subtitle never
  // claims a connection state that isn't true. System health lives once, in
  // the sidebar footer.
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

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch">
        <HermesBriefing className="xl:col-span-2 min-h-[420px]" />
        <CalendarPanel className="min-h-[420px]" />
      </section>

      <section className="mt-9">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Mail className="w-4 h-4 shrink-0 text-[var(--accent)]" />
          <span className="eyebrow">Gmail &amp; Approvals</span>
          <span className="h-px w-12 sm:w-24 bg-[var(--hq-hairline)]" />
          <span className="text-[12px] text-[var(--hq-text-ghost)]">Inbox and pending sign-offs</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          <div id="gmail-area" className="h-[300px]">
            <GmailPanel className="h-full" onConnection={setGmail} />
          </div>
          <div className="h-[300px]">
            <ApprovalInbox compact className="h-full" />
          </div>
        </div>
      </section>

      <section className="mt-9">
        <div className="panel p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[var(--warn)]" /><span className="eyebrow">Approval boundary</span></div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--hq-text-dim)]">Drafting, research, task updates, and wiki edits can run internally. Sending email, calendar changes, publishing, and other active changes wait in the Approval Inbox.</p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--hq-text-ghost)]"><Mail className="w-3.5 h-3.5" /> Gmail send/reply/labels and Calendar create/edit/delete require your approval.</div>
        </div>
      </section>
    </div>
  );
}
