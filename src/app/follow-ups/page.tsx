import { redirect } from "next/navigation";
import { withQuery } from "@/lib/redirect-query";

// Follow-up threads live on the Dispatch page (/hermes). Kept as a redirect
// for old links; ?thread=<id> (and any other query) is forwarded.
export default async function FollowUpsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(withQuery("/hermes", await searchParams));
}
