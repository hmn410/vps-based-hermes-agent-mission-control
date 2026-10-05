// Bounded, cached per-task detail fetches (dashboard GET /tasks/:id) and the
// event-merge rules the live activity mirror depends on.
//
// Why: the board listing has no events/runs. Before this module the bridge
// re-fetched EVERY done card each 3s mirror tick, fetched every parked card,
// and took live activity only from the ~60s-old SQLite snapshot's newest 150
// global events, which heartbeats crowd out. Now a task's detail is fetched
// only when its card signature changes (status/run/heartbeat/comments/block)
// or a TTL lapses, with capped concurrency, and the detail's full per-task
// event list feeds the activity mirror directly (live, not snapshot-lagged).

export const ACTIVE_DETAIL_STATUSES = new Set(["running", "review", "ready"]);
const TERMINAL = new Set(["done", "completed", "archived"]);

export function isTerminalStatus(status) {
  return TERMINAL.has(String(status || "").toLowerCase());
}

/** Fields on a board card that change whenever its detail (events/runs) does. */
export function detailSignature(task) {
  return [
    task?.status, task?.current_run_id, task?.last_heartbeat_at, task?.comment_count,
    task?.block_kind, task?.block_recurrences, task?.completed_at, task?.started_at,
  ].map((v) => (v == null ? "" : String(v))).join("|");
}

export function createDetailCache({ activeTtlMs = 60_000, terminalTtlMs = 10 * 60_000, now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    /** Cached detail when the card is unchanged and still fresh, else null. */
    get(task) {
      const hit = entries.get(task.id);
      if (!hit) return null;
      const ttl = isTerminalStatus(task.status) ? terminalTtlMs : activeTtlMs;
      if (hit.signature !== detailSignature(task) || now() - hit.at > ttl) return null;
      return hit.detail;
    },
    set(task, detail) {
      entries.set(task.id, { signature: detailSignature(task), at: now(), detail });
    },
    /** Forget tasks that left the board so the cache cannot grow without bound. */
    retain(ids) {
      const keep = new Set(ids);
      for (const id of entries.keys()) if (!keep.has(id)) entries.delete(id);
    },
    get size() { return entries.size; },
  };
}

/** Promise.all with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Normalise a dashboard detail payload's events to the snapshot row shape
 * ({id, task_id, run_id, kind, payload: string|null, created_at}). `commented`
 * events carry only {author, len}; attach a short body preview from the
 * matching comment so the live view shows what was said.
 */
export function detailEvents(taskId, detail) {
  const comments = Array.isArray(detail?.comments) ? [...detail.comments] : [];
  const events = Array.isArray(detail?.events) ? detail.events : [];
  return events.map((e) => {
    let payload = e.payload ?? null;
    if (e.kind === "commented" && payload && typeof payload === "object") {
      const idx = comments.findIndex((c) => c.author === payload.author && Math.abs(Number(c.created_at) - Number(e.created_at)) <= 2);
      if (idx >= 0) {
        const [c] = comments.splice(idx, 1);
        payload = { ...payload, body_preview: String(c.body || "").replace(/\s+/g, " ").trim().slice(0, 280) };
      }
    }
    return {
      id: Number(e.id),
      task_id: e.task_id || taskId,
      run_id: e.run_id ?? null,
      kind: e.kind,
      payload: payload == null ? null : typeof payload === "string" ? payload : JSON.stringify(payload),
      created_at: Number(e.created_at),
    };
  });
}

/**
 * Merge event rows from several sources (live detail + snapshot cursor read),
 * dedupe by canonical kanban event id preferring the richer payload, and
 * return them newest-first by (created_at, id).
 */
export function mergeEventRows(...sources) {
  const byId = new Map();
  for (const rows of sources) {
    for (const row of rows || []) {
      if (!Number.isFinite(row?.id)) continue;
      const prev = byId.get(row.id);
      if (!prev || String(row.payload ?? "").length > String(prev.payload ?? "").length) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => (Number(b.created_at) - Number(a.created_at)) || (b.id - a.id));
}
