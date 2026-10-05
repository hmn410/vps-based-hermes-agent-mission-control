/* Presentation rules for the Home Gmail overview. */

/** A cached AI summary older than this is flagged as stale on Home. */
export const GMAIL_SUMMARY_STALE_MS = 12 * 3_600_000;

export interface GmailOverviewData {
  total: number | null;
  summary: string | null;
  generatedAt: string | null;
}

export function summaryAgeMs(generatedAt: string | null | undefined, now: number): number | null {
  if (!generatedAt) return null;
  const t = new Date(generatedAt).getTime();
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

export function isSummaryStale(generatedAt: string | null | undefined, now: number): boolean {
  const age = summaryAgeMs(generatedAt, now);
  return age !== null && age > GMAIL_SUMMARY_STALE_MS;
}

/** True when HQ actually holds Gmail-derived data (so it may claim Gmail is connected). */
export function hasGmailData(o: GmailOverviewData | null | undefined): boolean {
  return !!o && (o.summary !== null || o.total !== null);
}

/** Home subtitle, accurate to what the Gmail panel actually holds. */
export function homePrivacyLine(gmail: "loading" | "connected" | "not_connected"): string {
  if (gmail === "connected") return "Personal Gmail connected · work accounts never connected.";
  if (gmail === "not_connected") return "Gmail not connected · work accounts never connected.";
  return "Work accounts never connected.";
}
