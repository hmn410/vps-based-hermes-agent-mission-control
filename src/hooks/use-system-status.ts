"use client";

/* Shared client hook for HQ's one system-status indicator (sidebar footer).
   Polls /api/hermes/health (bridge Hermes-API probe + kanban mirror freshness)
   and derives a red/amber/green status with real text. Polling pauses while
   the tab is hidden and refreshes immediately when it becomes visible. */

import { useEffect, useState } from "react";
import { deriveSystemStatus, type HealthPayload, type SystemStatus } from "@/lib/system-status";

export const HEALTH_POLL_MS = 15_000;

export function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>(() => deriveSystemStatus(undefined, 0));

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const mine = ++seq;
      let payload: HealthPayload | null = null;
      let failed = false;
      try {
        const r = await fetch("/api/hermes/health", { cache: "no-store" });
        if (r.ok) payload = (await r.json()) as HealthPayload;
        else failed = true;
      } catch {
        failed = true;
      }
      // Discard a superseded response so an older poll never overwrites a newer one.
      if (cancelled || mine !== seq) return;
      setStatus(deriveSystemStatus(payload, Date.now(), failed));
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        if (document.visibilityState === "visible") await poll();
        if (!cancelled) schedule();
      }, HEALTH_POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void poll();
        schedule();
      }
    };

    const first = setTimeout(() => { void poll(); }, 0);
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return status;
}
