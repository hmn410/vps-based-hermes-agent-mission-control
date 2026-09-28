// Read-only Gmail/Calendar actions run immediately. Anything that sends,
// creates, edits, or deletes a real-world object goes through the Approval
// Inbox — no client-supplied flag can downgrade that. Unknown action kinds
// fail closed (treated as requiring approval) rather than silently running.
const SAFE_ACTIONS = new Set([
  "gmail.list",
  "gmail.get",
  "gmail.draft",
  "calendar.list",
  "calendar.get",
]);

export function classifyGoogleAction(kind: string): { requiresApproval: boolean } {
  return { requiresApproval: !SAFE_ACTIONS.has(kind) };
}
