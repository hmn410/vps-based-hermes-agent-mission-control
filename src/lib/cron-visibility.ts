/* Which recurring Hermes jobs the /hermes schedules list shows by default.
   HQ is a personal + JoshBuilds.Tech terminal (wiki: preferences/
   hermy-hq-operating-model). Two kinds of job are hidden unless the operator
   opts in with "Show system & hidden jobs", and are always read-only here:

   - "system": plumbing that keeps HQ itself working (kanban mirror snapshots,
     digests delivered locally). Pausing one from the UI would break Tasks /
     Live Work, so it is never actionable from HQ.
   - "work": jobs about employer work. HQ never connects employer accounts and
     should not surface or drive employer work, so these are hidden too. */

export type CronVisibility = "personal" | "system" | "work";

export interface CronLike {
  name?: string | null;
  deliver?: string | null;
  prompt?: string | null;
}

/** Name prefix / deliver targets that mark HQ plumbing jobs. */
const SYSTEM_NAME_PREFIX = /^kanban-/i;
const SYSTEM_DELIVER = new Set(["local"]);

/** Employer-work markers, matched on the job name and (if mirrored) prompt. */
export const WORK_JOB_PATTERN = /\b(integris|msp)\b|\bwork(day)?[\s-]+planning\b|\btickets?\b/i;

export function classifyCronJob(job: CronLike): CronVisibility {
  const name = (job.name ?? "").trim();
  const deliver = (job.deliver ?? "").split(":")[0].trim().toLowerCase();
  if (WORK_JOB_PATTERN.test(name) || WORK_JOB_PATTERN.test(job.prompt ?? "")) return "work";
  if (SYSTEM_NAME_PREFIX.test(name) || SYSTEM_DELIVER.has(deliver)) return "system";
  return "personal";
}

/** Hidden jobs are not shown by default and never get Run now / Pause controls. */
export function isHiddenCron(job: CronLike): boolean {
  return classifyCronJob(job) !== "personal";
}
