import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'

// Pure JWT auth — no DB adapter required.
// Users are verified via allowedEmails; session is a signed cookie.
// Google access/refresh tokens are carried in the encrypted JWT so server-side
// API routes can call Gmail/Calendar. They are attached to the `session` object
// too, but only ever read server-side via getServerSession() — never surface
// them to a client component.
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
].join(' ')

async function refreshGoogleAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken as string,
      }),
    })
    const refreshed = await res.json()
    if (!res.ok) throw refreshed
    return {
      ...token,
      accessToken: refreshed.access_token,
      accessTokenExpires: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
      // Google only returns a new refresh_token occasionally; keep the old one otherwise.
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    }
  } catch (e) {
    console.error('Google token refresh failed', e)
    return { ...token, error: 'RefreshAccessTokenError' as const }
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: GOOGLE_SCOPES,
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Comma-separated allowlist from env, e.g. ALLOWED_EMAILS="you@example.com,teammate@example.com"
      const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
      if (allowedEmails.length === 0) return false // lock down by default until configured
      return allowedEmails.includes((user.email ?? '').toLowerCase())
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
        token.email = user.email
      }
      // First sign-in: Google includes tokens on the `account` object once.
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600_000
        return token
      }
      // Subsequent calls: reuse the access token until it's close to expiry.
      if (typeof token.accessTokenExpires === 'number' && Date.now() < token.accessTokenExpires - 60_000) {
        return token
      }
      if (!token.refreshToken) return token // no refresh token (re-consent needed) — leave as-is
      return refreshGoogleAccessToken(token)
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''
        session.user.email = token.email as string
      }
      session.accessToken = token.accessToken as string | undefined
      session.googleError = token.error as string | undefined
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}
