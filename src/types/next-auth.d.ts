import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
    // Server-side only in practice: only API routes call getServerSession()
    // and read these; never pass the session object itself to a client
    // component that doesn't need it.
    accessToken?: string
    googleError?: string
  }
}
