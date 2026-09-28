const EXTERNAL_ACTION = /\b(send|reply|publish|upload|delete|remove|purchase|buy|pay|transfer|deploy|schedule|invite|submit|connect|disconnect)\b/i;
const DRAFT_ONLY = /\b(draft|prepare|write)\b[\s\S]{0,80}\b(email|message|reply|post)\b/i;

/**
 * A conservative server-side approval guard. The browser may request an
 * approval state, but cannot downgrade an obviously external action.
 */
export function requiresApproval(kind: string, prompt: string): boolean {
  if (kind.startsWith("cron.")) return true;
  if (DRAFT_ONLY.test(prompt)) return false;
  return EXTERNAL_ACTION.test(prompt);
}
