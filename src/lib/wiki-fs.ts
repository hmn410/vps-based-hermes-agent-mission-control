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
 *  - writes are atomic: content goes to a dot-prefixed temp file in the same
 *    directory (`.<name>.<random>.tmp`, ignored by listWiki), is fsynced, then
 *    renamed over the REAL target path (never over a symlink) and the
 *    directory is fsynced. Readers (Hermes) see either the old or the new
 *    file, never a truncated/partial one. The inode changes on every save;
 *    mode is copied from the original and owner/group too when running as
 *    root (the image runs as uid 10000, the wiki owner, so new files are
 *    already owned correctly and chown is a no-op).
 *  - creates are exclusive: temp file + link() onto the target, which fails
 *    atomically with EEXIST if anything appeared there meanwhile
 *  - temp files are removed on every error path
 */
import { createHash, randomBytes } from "node:crypto";
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

// Test-only seam: lets tests interleave work between the temp-file write and
// the commit (rename/link) to exercise conflict and cleanup paths.
export const _wikiTestHooks: { beforeCommit?: (tmpPath: string, targetPath: string) => Promise<void> | void } = {};

const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

function tempPathFor(target: string) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(8).toString("hex")}.tmp`);
}

/** Write `buf` to a fresh exclusive temp file next to `target` and fsync it. */
async function writeTemp(target: string, buf: Buffer, opts: { mode?: number; uid?: number; gid?: number }) {
  const tmp = tempPathFor(target);
  const handle = await fs.open(tmp, "wx", opts.mode ?? 0o666);
  try {
    if (opts.mode !== undefined) await handle.chmod(opts.mode); // undo umask
    if (opts.uid !== undefined && opts.gid !== undefined) {
      const myUid = typeof process.getuid === "function" ? process.getuid() : undefined;
      if (isRoot() || myUid === opts.uid) {
        try {
          await handle.chown(opts.uid, opts.gid);
        } catch {
          /* best effort (e.g. gid we're not a member of) */
        }
      }
    }
    let off = 0;
    while (off < buf.length) {
      const { bytesWritten } = await handle.write(buf, off, buf.length - off, off);
      off += bytesWritten;
    }
    await handle.sync();
    await handle.close();
  } catch (e) {
    await handle.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
  return tmp;
}

async function fsyncDir(dir: string) {
  let handle;
  try {
    handle = await fs.open(dir, "r");
    await handle.sync();
  } catch {
    /* some filesystems refuse directory fsync; the rename itself is still atomic */
  } finally {
    await handle?.close().catch(() => {});
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
    const buf = Buffer.from(content, "utf8");
    const conflict = (message: string, cur: { content: string; mtime: Date }) =>
      Object.assign(new WikiError(409, message), {
        current: { path: r.rel, content: cur.content, hash: hashContent(cur.content), mtime: cur.mtime.toISOString() },
      });
    const readCurrent = async () => {
      try {
        const st = await fs.stat(r.real);
        const text = await fs.readFile(r.real, "utf8");
        return { st, content: text, mtime: st.mtime };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    };
    let tmp: string | null = null;
    try {
      if (r.exists) {
        const creating = baseHash === null || baseHash === undefined || baseHash === "";
        if (!creating && typeof baseHash !== "string") throw new WikiError(400, "baseHash must be a string or null.");
        const before = await readCurrent();
        if (!before) throw new WikiError(409, "This file was deleted or moved since you opened it.");
        if (creating) throw conflict("A file with that name already exists. Open it to edit the current version.", before);
        if (hashContent(before.content) !== baseHash) {
          throw conflict("This file changed since you opened it. Review the latest version before saving.", before);
        }
        tmp = await writeTemp(r.real, buf, { mode: before.st.mode & 0o7777, uid: before.st.uid, gid: before.st.gid });
        await _wikiTestHooks.beforeCommit?.(tmp, r.real);
        // Last check right before the swap: the file must still be the same
        // inode with the same content we validated (Hermes may have edited
        // or atomically replaced it while we were writing the temp file).
        const now = await readCurrent();
        if (!now) throw new WikiError(409, "This file was deleted or moved since you opened it.");
        if (now.st.ino !== before.st.ino || now.st.dev !== before.st.dev) {
          throw conflict("This file was replaced since you opened it. Review the latest version before saving.", now);
        }
        if (hashContent(now.content) !== baseHash) {
          throw conflict("This file changed since you opened it. Review the latest version before saving.", now);
        }
        await fs.rename(tmp, r.real); // r.real is the resolved target, never a symlink
        tmp = null;
        await fsyncDir(path.dirname(r.real));
      } else {
        if (baseHash !== null && baseHash !== undefined && baseHash !== "") {
          throw new WikiError(409, "This file was deleted or moved since you opened it.");
        }
        const dir = path.dirname(r.abs);
        await fs.mkdir(dir, { recursive: true });
        // New files take the wiki root's owner when we're root (no-op otherwise).
        const rootSt = await fs.stat(r.root);
        tmp = await writeTemp(r.abs, buf, isRoot() ? { uid: rootSt.uid, gid: rootSt.gid } : {});
        await _wikiTestHooks.beforeCommit?.(tmp, r.abs);
        try {
          await fs.link(tmp, r.abs); // atomic exclusive create: EEXIST if anything is there
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST") {
            const cur = await readCurrent().catch(() => null);
            if (cur) throw conflict("A file with that name was just created. Open it to edit the current version.", cur);
            throw new WikiError(409, "A file with that name was just created.");
          }
          throw e;
        }
        await fs.unlink(tmp).catch(() => {});
        tmp = null;
        await fsyncDir(dir);
        if (isRoot()) {
          try {
            let d = dir;
            while (inside(r.root, d) && d !== r.root) {
              await fs.chown(d, rootSt.uid, rootSt.gid);
              d = path.dirname(d);
            }
          } catch {
            /* best effort */
          }
        }
      }
    } finally {
      if (tmp) await fs.unlink(tmp).catch(() => {});
    }
    return readWikiFile(r.rel, root);
  });
}
