/* Builds a redirect target for a retired route, carrying over the incoming
   query string (Next page `searchParams`) and merging in fixed params. The
   URL fragment is preserved by the browser across the redirect. */
export function withQuery(
  path: string,
  incoming: Record<string, string | string[] | undefined>,
  fixed: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  for (const [key, value] of Object.entries(fixed)) params.set(key, value);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
