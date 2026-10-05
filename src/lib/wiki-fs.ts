/**
 * Shared Hermes wiki access, restricted to one approved root and to `.md` files.
 *
 * The canonical wiki lives at /opt/data/home/.hermes/wiki inside the Hermes
 * container, which is /docker/hermes-agent-mnis/data/home/.hermes/wiki on the
 * VPS host. compose.yaml bind-mounts ONLY that directory into the `app`
 * container at /wiki (HERMES_WIKI_ROOT). Nothing else on the host is visible.
 *
 * Rules enforced here (and covered by wiki-fs.test.ts):
 *  - relative POSIX paths only; no absolute paths, `..`, `.`, empty, hidden
 *    (dot-prefixed) segments, backslashes, or NUL bytes
 *  - `.md` extension only; MEMORY.md / USER.md names are refused (memory is
 *    promoted only by a human-approved Hermes action, never from Hermy HQ)
 *  - realpath of the target (or its parent, for new files) must stay inside
 *    the realpath of the root, so symlinks cannot escape it
 *  - writes require the hash of the version the editor started from; if the
 *    file changed meanwhile the write is refused with a conflict, never
 *    silently overwritten
 *  - writes are in place (preserves inode + owner uid 10000 so Hermes
 *    profiles can keep editing); new files are chowned to the parent dir owner
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const WIKI_MAX_BYTES = 512 * 1024;
const MAX_FILES = 1000;
const MAX_DEPTH = 6;
const RESERVED = new Set(["memory.md", "user.md"]);

// The dashboard runs a single Node process. Serialize each file's compare-and-
// swap so two editor requests based on the same version cannot both pass the
// hash check and interleave their writes.
const writeLocks = new Map<string, Promise<void>>();

async function withWriteLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  writeLocks.set(key, queued);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (writeLocks.get(key) === queued) writeLocks.delete(key);
  }
}

export class WikiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function wikiRoot(): string {
  return path.resolve(process.env.HERMES_WIKI_ROOT || "/wiki");
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 32);
}

/** Validate a client-supplied relative path. Returns the normalized relative path. */
export function normalizeWikiPath(input: unknown): string {
  if (typeof input !== "string") throw new WikiError(400, "Path is required.");
  const raw = input.trim();
  if (!raw || raw.length > 300) throw new WikiError(400, "Invalid path.");
  if (raw.includes("\0") || raw.includes("\\")) throw new WikiError(400, "Invalid path.");
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) throw new WikiError(400, "Absolute paths are not allowed.");
  const segments = raw.split("/");
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.startsWith(".")) throw new WikiError(400, "Invalid path segment.");
    if (!/^[A-Za-z0-9._ -]+$/.test(s)) throw new WikiError(400, "Invalid characters in path.");
  }
  if (segments.length > MAX_DEPTH) throw new WikiError(400, "Path is too deep.");
  const name = segments[segments.length - 1];
  if (!name.toLowerCase().endsWith(".md")) throw new WikiError(400, "Only .md files are allowed.");
  return segments.join("/");
}

function inside(root: string, target: string) {
  return target === root || target.startsWith(root + path.sep);
}

async function realRoot(root: string) {
  try {
    return await fs.realpath(root);
  } catch {
    throw new WikiError(503, "Wiki root is not mounted.");
  }
}

/** Resolve to an absolute path that is guaranteed to be inside the root. */
export async function resolveWikiPath(rel: string, root = wikiRoot()) {
  const norm = normalizeWikiPath(rel);
  const rroot = await realRoot(root);
  const abs = path.resolve(rroot, norm);
  if (!inside(rroot, abs)) throw new WikiError(400, "Path escapes the wiki root.");
  let exists = true;
  let realRel = norm;
  let real = abs;
  try {
    real = await fs.realpath(abs);
    if (!inside(rroot, real)) throw new WikiError(403, "Path escapes the wiki root.");
    // A symlink inside the root must also point at an allowed target (.md, not
    // hidden, not under a dot dir) — otherwise `notes.md -> .env` would leak.
    realRel = path.relative(rroot, real).split(path.sep).join("/");
    try {
      normalizeWikiPath(realRel);
    } catch {
      throw new WikiError(403, "Link target is not an allowed wiki file.");
    }
    const st = await fs.stat(real);
    if (!st.isFile()) throw new WikiError(400, "Not a file.");
  } catch (e) {
    if (e instanceof WikiError) throw e;
    exists = false;
    real = abs;
    realRel = norm;
    // New file: the nearest existing ancestor must resolve inside the root.
    let dir = path.dirname(abs);
    for (;;) {
      try {
        const realDir = await fs.realpath(dir);
        if (!inside(rroot, realDir)) throw new WikiError(403, "Path escapes the wiki root.");
        break;
      } catch (err) {
        if (err instanceof WikiError) throw err;
        const up = path.dirname(dir);
        if (up === dir || !inside(rroot, up)) throw new WikiError(400, "Invalid path.");
        dir = up;
      }
    }
  }
  return { rel: norm, abs, real, realRel, root: rroot, exists };
}

export type WikiFileMeta = { path: string; size: number; mtime: string; hash: string };

/** Bounded recursive listing of .md files (skips dot dirs and symlinks). */
export async function listWiki(root = wikiRoot()): Promise<WikiFileMeta[]> {
  const rroot = await realRoot(root);
  const out: WikiFileMeta[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (out.length >= MAX_FILES) return;
      if (ent.name.startsWith(".") || ent.isSymbolicLink()) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(abs, depth + 1);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        const rel = path.relative(rroot, abs).split(path.sep).join("/");
        try {
          normalizeWikiPath(rel);
        } catch {
          continue;
        }
        let st, content;
        try {
          st = await fs.stat(abs);
          if (st.size > WIKI_MAX_BYTES) continue;
          content = await fs.readFile(abs, "utf8");
        } catch {
          continue; // vanished (atomic rename by Hermes) or unreadable: skip, don't fail the whole catalog
        }
        out.push({ path: rel, size: st.size, mtime: st.mtime.toISOString(), hash: hashContent(content) });
      }
    }
  }
  await walk(rroot, 1);
  return out;
}

export async function readWikiFile(rel: string, root = wikiRoot()) {
  const r = await resolveWikiPath(rel, root);
  if (!r.exists) throw new WikiError(404, "Not found.");
  const st = await fs.stat(r.abs);
  if (st.size > WIKI_MAX_BYTES) throw new WikiError(413, "File is too large to display.");
  const content = await fs.readFile(r.abs, "utf8");
  return { path: r.rel, content, hash: hashContent(content), mtime: st.mtime.toISOString(), size: st.size };
}

/**
 * Optimistic-concurrency write. `baseHash` is the hash the editor loaded;
 * null means "create a new file" and fails if it already exists.
 */
export async function writeWikiFile(rel: string, content: unknown, baseHash: unknown, root = wikiRoot()) {
  if (typeof content !== "string") throw new WikiError(400, "Content must be a string.");
  if (Buffer.byteLength(content, "utf8") > WIKI_MAX_BYTES) throw new WikiError(413, "Content is too large.");
  if (content.includes("\0")) throw new WikiError(400, "Content contains NUL bytes.");
  const assertWritable = (r: { rel: string; realRel: string }) => {
    for (const p of [r.rel, r.realRel]) {
      if (RESERVED.has(path.posix.basename(p).toLowerCase())) {
        throw new WikiError(403, "MEMORY.md / USER.md cannot be written from Hermy HQ. Propose entries in PENDING.md.");
      }
    }
  };
  const pre = await resolveWikiPath(rel, root);
  assertWritable(pre);

  // Lock on the resolved target so symlink aliases of one file share a lock;
  // re-resolve inside the lock so `exists` reflects the serialized state.
  return withWriteLock(pre.real, async () => {
    const r = await resolveWikiPath(rel, root);
    assertWritable(r);
    if (r.exists) {
      const creating = baseHash === null || baseHash === undefined || baseHash === "";
      if (!creating && typeof baseHash !== "string") throw new WikiError(400, "baseHash must be a string or null.");
      let handle;
      try {
        handle = await fs.open(r.real, "r+");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new WikiError(409, "This file was deleted or moved since you opened it.");
        throw e;
      }
      try {
        const current = await handle.readFile({ encoding: "utf8" });
        const currentHash = hashContent(current);
        const hst = await handle.stat();
        // If Hermes atomically replaced the file (rename) after we opened it,
        // our handle points at an orphaned inode: writing would be lost.
        const pst = await fs.stat(r.real).catch(() => null);
        if (!pst || pst.ino !== hst.ino || pst.dev !== hst.dev) {
          throw new WikiError(409, "This file was replaced since you opened it. Review the latest version before saving.");
        }
        if (creating || currentHash !== baseHash) {
          const message = creating
            ? "A file with that name already exists. Open it to edit the current version."
            : "This file changed since you opened it. Review the latest version before saving.";
          throw Object.assign(new WikiError(409, message), {
            current: { path: r.rel, content: current, hash: currentHash, mtime: hst.mtime.toISOString() },
          });
        }
        const buf = Buffer.from(content, "utf8");
        await handle.truncate(0);
        let off = 0;
        while (off < buf.length) {
          const { bytesWritten } = await handle.write(buf, off, buf.length - off, off);
          off += bytesWritten;
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      if (baseHash !== null && baseHash !== undefined && baseHash !== "") {
        throw new WikiError(409, "This file was deleted or moved since you opened it.");
      }
      const dir = path.dirname(r.abs);
      await fs.mkdir(dir, { recursive: true });
      try {
        await fs.writeFile(r.abs, content, { encoding: "utf8", flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new WikiError(409, "A file with that name was just created.");
        throw e;
      }
      // Keep ownership consistent with the Hermes-owned wiki (best effort; only works as root).
      try {
        const st = await fs.stat(r.root);
        await fs.chown(r.abs, st.uid, st.gid);
        let d = dir;
        while (inside(r.root, d) && d !== r.root) {
          await fs.chown(d, st.uid, st.gid);
          d = path.dirname(d);
        }
      } catch {
        /* not root: file already belongs to the writing user */
      }
    }
    return readWikiFile(r.rel, root);
  });
}
