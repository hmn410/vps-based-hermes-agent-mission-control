/* Ideas are a backlog only: New → Considering → (Rejected | Sent to Hermes).
   Once sent, the linked kanban task (Idea.kanbanTaskId) owns the lifecycle.
   Legacy rows written by the old 6-state board (approved / in-progress /
   done) are mapped for display only — nothing is migrated in the database. */

export const IDEA_BACKLOG_STATUSES = ["new", "considering", "rejected"] as const;
export type IdeaBacklogStatus = (typeof IDEA_BACKLOG_STATUSES)[number];
export type IdeaDisplayStatus = IdeaBacklogStatus | "sent";

export interface IdeaStatusInput {
  status?: string | null;
  kanbanTaskId?: string | null;
}

export function ideaDisplayStatus(idea: IdeaStatusInput): IdeaDisplayStatus {
  const status = (idea.status || "new").toLowerCase();
  if (status === "rejected") return "rejected";
  if (idea.kanbanTaskId) return "sent";
  if (status === "new") return "new";
  // "considering", legacy approved / in-progress / done without a linked
  // task, "sent" whose link was lost, and anything unknown.
  return "considering";
}

export function isBacklogStatus(value: unknown): value is IdeaBacklogStatus {
  return typeof value === "string" && (IDEA_BACKLOG_STATUSES as readonly string[]).includes(value);
}

/** Minimum description length before an idea may become a kanban task: vague
 *  ideas create tasks no worker can act on (a past runaway-loop incident). */
export const MIN_SEND_DESCRIPTION = 20;

export function sendBlocker(idea: IdeaStatusInput & { description?: string | null; title?: string }): string | null {
  if (ideaDisplayStatus(idea) === "sent") return "This idea was already sent to Hermes.";
  if (ideaDisplayStatus(idea) === "rejected") return "Reopen this idea before sending it.";
  if ((idea.description || "").trim().length < MIN_SEND_DESCRIPTION) {
    return `Add a real description before sending "${idea.title ?? "this idea"}" — what exactly should happen, and where (site/product/system).`;
  }
  return null;
}
