import { gmailClient, calendarClient, getGoogleAuth } from "@/lib/google-client";

const GOOGLE_KINDS = new Set([
  "gmail.send",
  "gmail.reply",
  "gmail.modify",
  "gmail.trash",
  "calendar.create",
  "calendar.update",
  "calendar.delete",
]);

export function isGoogleKind(kind: string) {
  return GOOGLE_KINDS.has(kind);
}

function buildRawMessage({ to, subject, body, inReplyTo }: { to: string; subject: string; body: string; inReplyTo?: string }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
  ].filter(Boolean).join("\r\n");
  const raw = `${headers}\r\n\r\n${body}`;
  return Buffer.from(raw).toString("base64url");
}

/**
 * Executes an approved Gmail/Calendar mutation using the APPROVING operator's
 * own Google session (never the bridge's, which has no Google credentials).
 * Called only from the approval PATCH route, only after status has already
 * moved out of awaiting_approval/queued. Throws on failure — caller records
 * the error on the AgentRequest row.
 */
export async function executeGoogleAction(kind: string, promptJson: string | null): Promise<string> {
  const auth = await getGoogleAuth();
  if (!auth) throw new Error("Google is not connected for the current session");
  const p = promptJson ? JSON.parse(promptJson) : {};

  if (kind === "gmail.send" || kind === "gmail.reply") {
    const gmail = gmailClient(auth);
    const raw = buildRawMessage({ to: p.to, subject: p.subject || "(no subject)", body: p.body || "", inReplyTo: p.messageId });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: p.threadId || undefined },
    });
    return `sent message ${res.data.id}`;
  }
  if (kind === "gmail.modify") {
    const gmail = gmailClient(auth);
    await gmail.users.messages.modify({
      userId: "me",
      id: p.messageId,
      requestBody: { addLabelIds: p.addLabelIds || [], removeLabelIds: p.removeLabelIds || [] },
    });
    return `modified message ${p.messageId}`;
  }
  if (kind === "gmail.trash") {
    const gmail = gmailClient(auth);
    await gmail.users.messages.trash({ userId: "me", id: p.messageId });
    return `trashed message ${p.messageId}`;
  }
  if (kind === "calendar.create") {
    const calendar = calendarClient(auth);
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: p.summary,
        location: p.location || undefined,
        description: p.description || undefined,
        start: { dateTime: p.start },
        end: { dateTime: p.end },
        attendees: Array.isArray(p.attendees) ? p.attendees.map((email: string) => ({ email })) : undefined,
      },
    });
    return `created event ${res.data.id}`;
  }
  if (kind === "calendar.update") {
    const calendar = calendarClient(auth);
    await calendar.events.patch({
      calendarId: "primary",
      eventId: p.eventId,
      requestBody: {
        summary: p.summary || undefined,
        location: p.location || undefined,
        description: p.description || undefined,
        start: p.start ? { dateTime: p.start } : undefined,
        end: p.end ? { dateTime: p.end } : undefined,
      },
    });
    return `updated event ${p.eventId}`;
  }
  if (kind === "calendar.delete") {
    const calendar = calendarClient(auth);
    await calendar.events.delete({ calendarId: "primary", eventId: p.eventId });
    return `deleted event ${p.eventId}`;
  }
  throw new Error(`unknown Google action kind ${kind}`);
}
