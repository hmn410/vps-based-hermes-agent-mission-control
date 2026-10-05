import { NextResponse } from "next/server";
import { listWiki, readWikiFile, WikiError } from "@/lib/wiki-fs";
import { openProposals, parsePending } from "@/lib/wiki-markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/wiki → catalog of .md files (path, size, mtime, content hash) plus
// the PENDING.md queue summary. Polled by the /wiki page every few seconds;
// the hashes let the client detect changes made by any Hermes profile.
export async function GET() {
  try {
    const files = await listWiki();
    let pending: { open: number; proposals: ReturnType<typeof parsePending> } | null = null;
    if (files.some((f) => f.path === "PENDING.md")) {
      const p = await readWikiFile("PENDING.md");
      const proposals = parsePending(p.content);
      pending = { open: openProposals(proposals).length, proposals };
    }
    return NextResponse.json(
      { files, pending, checkedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const status = e instanceof WikiError ? e.status : 500;
    const error = e instanceof WikiError ? e.message : "Could not read the wiki.";
    if (!(e instanceof WikiError)) console.error("wiki list failed", e);
    return NextResponse.json({ error }, { status });
  }
}
