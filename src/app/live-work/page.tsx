import { redirect } from "next/navigation";
import { withQuery } from "@/lib/redirect-query";

// Live Work merged into Tasks (Live tab). Kept as a redirect for old links.
export default async function LiveWorkRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(withQuery("/tasks", await searchParams, { tab: "live" }));
}
