/* Upcoming Workday — manual, personal-only input for the morning brief.
   Stored in DataStore under KEY; the bridge renders it on weekdays when
   forDate matches the brief's America/Chicago date. Nothing here reads
   an employer calendar, mailbox, or any external service. */

export const UPCOMING_WORKDAY_KEY = "upcoming-workday-input";

export interface Commitment {
  title: string;
  time?: string;
  location?: string;
  travelMinutes?: string;
  deadline?: string;
}

export interface UpcomingWorkday {
  forDate: string; // YYYY-MM-DD (America/Chicago)
  fixedCommitments: Commitment[];
  priorities: string[];
  focusBlocks: string[];
  risks: string[];
  prepTonight: string[];
}

const MAX_TEXT = 300;
const MAX_LIST = 10;

function text(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, MAX_TEXT) : "";
}

function list(v: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(text).filter(Boolean).slice(0, max);
}

function commitment(v: unknown): Commitment | null {
  if (typeof v === "string") return text(v) ? { title: text(v) } : null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const title = text(o.title);
  if (!title) return null;
  const out: Commitment = { title };
  for (const k of ["time", "location", "travelMinutes", "deadline"] as const) {
    const t = text(o[k]);
    if (t) out[k] = t;
  }
  return out;
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Returns a clean object, or an error string when the input is unusable. */
export function sanitizeUpcomingWorkday(body: unknown): UpcomingWorkday | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Expected a JSON object.";
  const o = body as Record<string, unknown>;
  if (!isIsoDate(o.forDate)) return "forDate must be a valid YYYY-MM-DD date.";
  return {
    forDate: o.forDate,
    fixedCommitments: (Array.isArray(o.fixedCommitments) ? o.fixedCommitments : [])
      .map(commitment)
      .filter((c): c is Commitment => c !== null)
      .slice(0, MAX_LIST),
    priorities: list(o.priorities, 3),
    focusBlocks: list(o.focusBlocks),
    risks: list(o.risks),
    prepTonight: list(o.prepTonight),
  };
}

/** Next Mon–Fri date in America/Chicago, as YYYY-MM-DD. */
export function nextWorkday(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(now); // en-CA → YYYY-MM-DD
  const d = new Date(`${today}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
