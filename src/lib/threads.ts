/* Conversation threads for the /hermes Dispatch page: groups AgentRequest
   rows (original request + follow-ups share conversationId), classifies each
   thread by its latest message, and filters/searches/paginates the list. */

export interface ThreadMessage {
  id: string;
  title: string;
  prompt: string | null;
  replyText: string | null;
  conversationId: string | null;
  status: string;
  result: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Thread<M extends ThreadMessage = ThreadMessage> {
  id: string;
  messages: M[];
}

export type ThreadState = "active" | "needs_reply" | "done";
export type ThreadFilter = ThreadState | "all";

export const THREAD_PAGE_SIZE = 20;

// Waiting on Josh: pre-flight approval, a block, a review hand-off, or a
// failure he should correct/retry.
const NEEDS_REPLY = new Set(["awaiting_approval", "blocked", "review", "failed"]);
const DONE = new Set(["done", "rejected"]);

const time = (d: string) => {
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function groupThreads<M extends ThreadMessage>(requests: M[]): Thread<M>[] {
  const grouped = new Map<string, M[]>();
  for (const request of requests) {
    const key = request.conversationId || request.id;
    const list = grouped.get(key);
    if (list) list.push(request);
    else grouped.set(key, [request]);
  }
  return Array.from(grouped, ([id, messages]) => ({
    id,
    messages: [...messages].sort((a, b) => time(a.createdAt) - time(b.createdAt)),
  })).sort((a, b) => latestTime(b) - latestTime(a));
}

function latest<M extends ThreadMessage>(thread: Thread<M>): M {
  return thread.messages[thread.messages.length - 1];
}

function latestTime(thread: Thread): number {
  const m = latest(thread);
  return time(m.finishedAt || m.createdAt);
}

export function threadState(thread: Thread): ThreadState {
  const status = latest(thread).status;
  if (NEEDS_REPLY.has(status)) return "needs_reply";
  if (DONE.has(status)) return "done";
  return "active";
}

export function threadMatches(thread: Thread, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return thread.messages.some((m) =>
    [m.title, m.prompt, m.replyText, m.result, m.error, m.id].some((v) => v?.toLowerCase().includes(q)),
  );
}

export function filterThreads<T extends Thread>(threads: T[], filter: ThreadFilter, query: string): T[] {
  return threads.filter((t) => (filter === "all" || threadState(t) === filter) && threadMatches(t, query));
}

export function countByState(threads: Thread[]): Record<ThreadFilter, number> {
  const counts: Record<ThreadFilter, number> = { all: threads.length, active: 0, needs_reply: 0, done: 0 };
  for (const t of threads) counts[threadState(t)] += 1;
  return counts;
}

export function paginate<T>(items: T[], page: number, size = THREAD_PAGE_SIZE): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(0, page), pageCount - 1);
  return { items: items.slice(p * size, p * size + size), page: p, pageCount };
}

/** Page index that contains the thread holding message/thread `id`, or -1. */
export function pageOfThread(threads: Thread[], id: string, size = THREAD_PAGE_SIZE): number {
  const index = threads.findIndex((t) => t.id === id || t.messages.some((m) => m.id === id));
  return index < 0 ? -1 : Math.floor(index / size);
}
