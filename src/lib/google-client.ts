import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Resolve an authenticated Google OAuth2 client for the signed-in operator.
 * Returns null if there is no session, no Google access token, or the token
 * is broken (RefreshAccessTokenError) — callers must treat null as "Google
 * not connected" and degrade gracefully, never throw to the client.
 */
export async function getGoogleAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.googleError) return null;
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: session.accessToken });
  return auth;
}

export function gmailClient(auth: InstanceType<typeof google.auth.OAuth2>) {
  return google.gmail({ version: "v1", auth });
}

export function calendarClient(auth: InstanceType<typeof google.auth.OAuth2>) {
  return google.calendar({ version: "v3", auth });
}
