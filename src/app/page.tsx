"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, CalendarCheck, ChevronDown, ChevronUp, Cpu, ListTodo, Mail, ShieldCheck } from "lucide-react";
import { HermesBriefing } from "@/components/hermes-briefing";
import { ApprovalInbox } from "@/components/approval-inbox";
import { GmailPanel } from "@/components/gmail-panel";
import { CalendarPanel } from "@/components/calendar-panel";

const destinations = [
  {
    href: "/hermes",
    title: "Dispatch terminal",
    detail: "Send internal work to Hermes, review runs, and approve real-world changes.",
    icon: Cpu,
  },
  {
    href: "/tasks",
    title: "Tasks",
    detail: "Review active, blocked, and completed work from the Hermes board.",
    icon: ListTodo,
  },
];

export default function Dashboard() {
  const [showGmail, setShowGmail] = useState(true);

  return (
    <div className="relative z-10 w-full mx-auto pb-16">
      <header className="pt-4 pb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow mb-2.5">Mission control · personal and JoshBuilds.Tech</div>
          <h1 className="text-[40px] font-semibold tracking-[-0.025em] leading-none text-[var(--hq-text)]">Morning Brief</h1>
          <p className="text-[13px] text-[var(--hq-text-ghost)] mt-3 max-w-2xl">
            Real Hermes tasks, schedules, memory, and approvals. Work-account data and Gmail stay disconnected unless you explicitly add them.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--hq-hairline)] bg-white/[0.02] px-3 py-1.5">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "color-mix(in srgb, var(--up) 60%, transparent)" }} />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: "var(--up)" }} />
          </span>
          <span className="eyebrow !text-[9.5px] !text-[var(--hq-text-faint)]">Hermes bridge connected</span>
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
          <button
            type="button"
            onClick={() => setShowGmail((visible) => !visible)}
            aria-expanded={showGmail}
            aria-controls="gmail-area"
            className="btn-ghost ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] shrink-0"
          >
            {showGmail ? "Hide Gmail" : "Show Gmail"}
            {showGmail ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {showGmail && (
            <div id="gmail-area" className="h-[300px]">
              <GmailPanel className="h-full" />
            </div>
          )}
          <div className={`h-[300px] ${showGmail ? "" : "lg:col-span-2"}`}>
            <ApprovalInbox compact className="h-full" />
          </div>
        </div>
      </section>

      <section className="mt-9">
        <div className="flex items-center gap-3 mb-3">
          <span className="eyebrow">Start here</span>
          <span className="h-px flex-1 bg-[var(--hq-hairline)]" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {destinations.map(({ href, title, detail, icon: Icon }) => (
            <Link key={href} href={href} className="panel panel-interactive p-5 group">
              <div className="flex items-start justify-between gap-4">
                <Icon className="w-5 h-5 text-[var(--accent)]" />
                <ArrowUpRight className="w-4 h-4 text-[var(--hq-text-ghost)] group-hover:text-[var(--hq-text)] transition-colors" />
              </div>
              <h2 className="mt-6 text-[15px] font-semibold text-[var(--hq-text)]">{title}</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--hq-text-ghost)]">{detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="panel p-5">
          <div className="flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-[var(--accent)]" /><span className="eyebrow">Daily focus</span></div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--hq-text-dim)]">Generate the brief each morning to review today’s tasks, personal follow-ups, JoshBuilds priorities, and work follow-ups you have manually recorded.</p>
        </div>
        <div className="panel p-5">
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[var(--warn)]" /><span className="eyebrow">Approval boundary</span></div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--hq-text-dim)]">Drafting, research, task updates, and wiki edits can run internally. Sending email, calendar changes, publishing, and other active changes wait in the Approval Inbox.</p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--hq-text-ghost)]"><Mail className="w-3.5 h-3.5" /> Gmail send/reply/labels and Calendar create/edit/delete require your approval.</div>
        </div>
      </section>
    </div>
  );
}
