import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyCronJob, type CronVisibility } from "@/lib/cron-visibility";

export const dynamic = "force-dynamic";

export type CronJob = {
  id: string;
  status: string;           // "active" | "paused"
  name: string;
  schedule: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  deliver: string | null;
  skills: string | null;
  script: string | null;
  mode: string | null;
  // personal = shown + actionable; system/work = hidden by default, read-only.
  visibility?: CronVisibility;
};

// Parse the raw `hermes cron list --all` terminal output into clean objects.
// Format per job: two-space-indented "<id> [status]" then four-space "Key: value" lines.
function parseCrons(raw: string): CronJob[] {
  const jobs: CronJob[] = [];
  let cur: CronJob | null = null;
  const push = () => { if (cur) jobs.push(cur); };
  for (const line of raw.split("\n")) {
    const head = line.match(/^\s{2}([0-9a-f]{6,})\s+\[(\w+)\]/);
    if (head) {
      push();
      cur = { id: head[1], status: head[2], name: "", schedule: "", nextRun: null, lastRun: null, lastResult: null, deliver: null, skills: null, script: null, mode: null };
      continue;
    }
    const kv = line.match(/^\s{4}([A-Za-z][A-Za-z ]*?):\s+(.*)$/);
    if (kv && cur) {
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      if (key === "name") cur.name = val;
      else if (key === "schedule") cur.schedule = val;
      else if (key === "next run") cur.nextRun = val;
      else if (key === "deliver") cur.deliver = val;
      else if (key === "skills") cur.skills = val;
      else if (key === "script") cur.script = val;
      else if (key === "mode") cur.mode = val;
      else if (key === "last run") {
        const m = val.match(/^(\S+)\s+(.*)$/);
        cur.lastRun = m ? m[1] : val;
        cur.lastResult = m ? m[2] : null;
      }
    }
  }
  push();
  return jobs;
}

async function loadJobs() {
  const row = await prisma.dataStore.findUnique({ where: { key: "hermes-crons" } });
  const data = (row?.data as { raw?: string; syncedAt?: string } | null) ?? {};
  const jobs = (data.raw ? parseCrons(data.raw) : []).map((j) => ({ ...j, visibility: classifyCronJob(j) }));
  return { jobs, syncedAt: data.syncedAt ?? null };
}

// Every job is returned with a `visibility` tag; the UI hides non-personal
// jobs behind "Show system & hidden jobs" (see src/lib/cron-visibility.ts).
export async function GET() {
  return NextResponse.json(await loadJobs());
}

// POST { op: "create"|"pause"|"resume"|"run"|"remove"|"edit", ... } → queue a cron mutation for the bridge
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const op = (b.op || "").toString();
  if (!["create", "pause", "resume", "run", "remove", "edit"].includes(op))
    return NextResponse.json({ error: "bad op" }, { status: 400 });
  // System and work jobs are read-only from HQ (pausing the kanban mirror
  // snapshot would break Tasks/Live Work; work jobs are not driven from HQ).
  if (op !== "create") {
    const { jobs } = await loadJobs();
    const target = jobs.find((j) => (b.id && j.id === b.id) || (!b.id && b.name && j.name === b.name));
    if (target && target.visibility !== "personal")
      return NextResponse.json({ error: `${target.visibility} jobs are read-only in HQ` }, { status: 403 });
  }
  const label = op === "create" ? `Schedule: ${b.schedule || "?"} — ${b.prompt || b.name || ""}` : `Cron ${op}: ${b.name || b.id || ""}`;
  // A cron changes future agent behavior; every mutation waits for human approval.
  const sideEffecting = true;
  const row = await prisma.agentRequest.create({
    data: {
      origin: "web",
      kind: `cron.${op}`,
      title: label.slice(0, 200),
      prompt: JSON.stringify(b),
      sideEffecting,
      status: sideEffecting ? "awaiting_approval" : "queued",
    },
  });
  return NextResponse.json({ request: row });
}
