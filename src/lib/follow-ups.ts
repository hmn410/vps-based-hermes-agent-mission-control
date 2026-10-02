export type ConversationRequest = {
  id: string;
  conversationId: string | null;
};

export function conversationRootId(request: ConversationRequest): string {
  return request.conversationId || request.id;
}

function section(label: string, content: string): string {
  return `## ${label}\n${content.trim() || "(No text was recorded.)"}`;
}

export function buildFollowUpPrompt({
  originalTitle,
  originalPrompt,
  priorResponse,
  feedback,
}: {
  originalTitle: string;
  originalPrompt: string | null;
  priorResponse: string | null;
  feedback: string;
}): string {
  return [
    "This is a follow-up from the same human after an earlier Hermy HQ request.",
    section("Original request", originalPrompt || originalTitle),
    section("Prior response", priorResponse || "No written response was returned."),
    section("My follow-up", feedback),
    "Act on my follow-up instead of merely repeating the prior answer. If the earlier work was incomplete, do the missing work now. Return the full answer or result to Hermy HQ when complete.",
  ].join("\n\n");
}
