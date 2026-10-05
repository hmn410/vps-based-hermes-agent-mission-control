import { NextResponse } from "next/server";
import { readWikiFile, writeWikiFile, WikiError } from "@/lib/wiki-fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Hard cap on PUT bodies (JSON-escaped content can be larger than the 512 KB file limit). */
const WIKI_MAX_BODY_BYTES = 1024 * 1024;

async function readBounded(req: Request, limit: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new WikiError(413, "Request body is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fail(e: unknown) {
  if (e instanceof WikiError) {
    const body: Record<string, unknown> = { error: e.message };
    const current = (e as WikiError & { current?: unknown }).current;
    if (current) body.current = current;
    return NextResponse.json(body, { status: e.status });
  }
  console.error("wiki file op failed", e);
  return NextResponse.json({ error: "Wiki operation failed." }, { status: 500 });
}

// GET /api/wiki/file?path=standing-instructions.md
export async function GET(req: Request) {
  try {
    const path = new URL(req.url).searchParams.get("path");
    const file = await readWikiFile(path ?? "");
    return NextResponse.json(file, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

// PUT /api/wiki/file  { path, content, baseHash }
// baseHash = hash of the version the editor loaded (null to create a new file).
// A mismatch returns 409 with the current on-disk version; nothing is overwritten.
export async function PUT(req: Request) {
  try {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > WIKI_MAX_BODY_BYTES) throw new WikiError(413, "Request body is too large.");
    // Content-Length can be absent (chunked); read with a bound instead of trusting req.json().
    const text = await readBounded(req, WIKI_MAX_BODY_BYTES);
    let body: { path?: unknown; content?: unknown; baseHash?: unknown } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") throw new WikiError(400, "JSON body required.");
    if (typeof body.path !== "string") throw new WikiError(400, "Path is required.");
    const file = await writeWikiFile(body.path, body.content, body.baseHash ?? null);
    return NextResponse.json(file);
  } catch (e) {
    return fail(e);
  }
}
