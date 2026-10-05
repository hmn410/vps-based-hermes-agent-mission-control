/* One derived "is HQ healthy?" status for the sidebar footer, computed from
   /api/hermes/health (bridge-written Hermes API probe + kanban mirror
   freshness). Pure so the thresholds are tested rather than eyeballed. */

export interface HealthPayload {
  online?: boolean;
  gateway?: string | null;
  lastSeen?: string | null;
  mirror?: {
    lastSuccessfulEventReadAt?: string | null;
    available?: boolean;
    error?: string | null;
  } | null;
}

export type StatusLevel = "up" | "warn" | "down";

export interface SystemStatus {
  level: StatusLevel;
  text: string;
  detail: string;
}

/** The bridge writes health every mirror tick (seconds). Silence beyond this means the bridge is down. */
export const BRIDGE_SILENT_MS = 2 * 60_000;
/** Kanban telemetry older than this makes the Tasks page stale. */
export const MIRROR_STALE_MS = 60_000;

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/**
 * `health` null with `fetchFailed` means HQ's own API did not answer.
 * `health` undefined means the first poll has not completed yet.
 */
export function deriveSystemStatus(
  health: HealthPayload | null | undefined,
  now: number,
  fetchFailed = false,
): SystemStatus {
  if (health === undefined && !fetchFailed) {
    return { level: "warn", text: "Checking status…", detail: "First health check in progress" };
  }
  if (fetchFailed || !health) {
    return { level: "down", text: "HQ API unreachable", detail: "/api/hermes/health did not respond" };
  }
  const seenAge = ageMs(health.lastSeen, now);
  if (seenAge === null) {
    return { level: "down", text: "Bridge not reporting", detail: "The Hermes bridge has never written a health check" };
  }
  if (seenAge > BRIDGE_SILENT_MS) {
    return { level: "down", text: `Bridge silent ${formatAge(seenAge)}`, detail: `Last bridge health check ${formatAge(seenAge)} ago` };
  }
  if (!health.online) {
    return { level: "down", text: "Hermes offline", detail: `Bridge is up but the Hermes API did not answer (checked ${formatAge(seenAge)} ago)` };
  }
  const mirror = health.mirror;
  if (mirror) {
    const mirrorAge = ageMs(mirror.lastSuccessfulEventReadAt, now);
    if (mirrorAge === null) {
      return { level: "warn", text: "Mirror not reporting", detail: mirror.error || "No kanban telemetry read recorded yet" };
    }
    if (mirrorAge > MIRROR_STALE_MS) {
      return { level: "warn", text: `Mirror stale ${formatAge(mirrorAge)}`, detail: mirror.error || `Task telemetry last read ${formatAge(mirrorAge)} ago` };
    }
  }
  return { level: "up", text: "Hermes online", detail: `Hermes API answered ${formatAge(seenAge)} ago${mirror ? " · task mirror fresh" : ""}` };
}
