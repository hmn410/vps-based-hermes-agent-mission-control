import { NextResponse } from "next/server";
import { readWikiFile, writeWikiFile, WikiError } from "@/lib/wiki-fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new WikiError(400, "JSON body required.");
    const file = await writeWikiFile(body.path, body.content, body.baseHash ?? null);
    return NextResponse.json(file);
  } catch (e) {
    return fail(e);
  }
}
