import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashContent, listWiki, normalizeWikiPath, readWikiFile, writeWikiFile, WikiError } from "./wiki-fs";

async function fixture() {
  const base = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "wiki-test-"));
  const root = path.join(base, "wiki");
  await fs.mkdir(path.join(root, "daily"), { recursive: true });
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, "INDEX.md"), "# Index\n");
  await fs.writeFile(path.join(root, "PENDING.md"), "# Pending\n## Queue\n_No pending proposals._\n");
  await fs.writeFile(path.join(root, "daily", "2026-10-05.md"), "# Day\n");
  await fs.writeFile(path.join(root, "notes.txt"), "not markdown");
  await fs.writeFile(path.join(root, ".git", "config.md"), "hidden");
  await fs.writeFile(path.join(base, "secret.md"), "SECRET=1");
  await fs.writeFile(path.join(base, ".env"), "TOKEN=abc");
  await fs.symlink(path.join(base, "secret.md"), path.join(root, "escape.md"));
  await fs.symlink(base, path.join(root, "outside"));
  return { base, root };
}

async function rejects(p: Promise<unknown>, status: number) {
  await assert.rejects(p, (e: unknown) => e instanceof WikiError && e.status === status);
}

test("normalizeWikiPath rejects traversal, absolute, hidden, and non-.md paths", () => {
  for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd.md", "C:/x.md", "..\\x.md", ".env", ".git/config.md", "a//b.md", "x.txt", "INDEX.md\0", "", "./INDEX.md", "a/%2e%2e/x.md"]) {
    assert.throws(() => normalizeWikiPath(bad), WikiError, bad);
  }
  assert.equal(normalizeWikiPath("daily/2026-10-05.md"), "daily/2026-10-05.md");
  assert.equal(normalizeWikiPath("preferences/hermy-hq-operating-model.md"), "preferences/hermy-hq-operating-model.md");
});

test("listWiki returns only .md files inside the root, skipping dot dirs and symlinks", async () => {
  const { root } = await fixture();
  const files = (await listWiki(root)).map((f) => f.path);
  assert.deepEqual(files.sort(), ["INDEX.md", "PENDING.md", "daily/2026-10-05.md"]);
});

test("readWikiFile refuses symlinks that escape the root", async () => {
  const { root } = await fixture();
  await rejects(readWikiFile("escape.md", root), 403);
  await rejects(readWikiFile("outside/secret.md", root), 403);
  await rejects(readWikiFile("../secret.md", root), 400);
  const index = await readWikiFile("INDEX.md", root);
  assert.equal(index.content, "# Index\n");
  assert.equal(index.hash, hashContent("# Index\n"));
});

test("writeWikiFile updates the real file when baseHash matches", async () => {
  const { root } = await fixture();
  const before = await readWikiFile("INDEX.md", root);
  const inode = (await fs.stat(path.join(root, "INDEX.md"))).ino;
  const after = await writeWikiFile("INDEX.md", "# Index\n- new\n", before.hash, root);
  assert.equal(await fs.readFile(path.join(root, "INDEX.md"), "utf8"), "# Index\n- new\n");
  assert.equal(after.hash, hashContent("# Index\n- new\n"));
  assert.equal((await fs.stat(path.join(root, "INDEX.md"))).ino, inode, "write is in place");
});

test("writeWikiFile reports a conflict instead of overwriting a concurrent change", async () => {
  const { root } = await fixture();
  const loaded = await readWikiFile("PENDING.md", root);
  // A Hermes profile edits the file after the operator opened it.
  await fs.writeFile(path.join(root, "PENDING.md"), "# Pending\n## Queue\n### Proposed entry\n");
  await assert.rejects(writeWikiFile("PENDING.md", "operator draft", loaded.hash, root), (e: unknown) => {
    assert.ok(e instanceof WikiError);
    assert.equal(e.status, 409);
    const current = (e as WikiError & { current?: { content: string } }).current;
    assert.equal(current?.content, "# Pending\n## Queue\n### Proposed entry\n");
    return true;
  });
  assert.equal(await fs.readFile(path.join(root, "PENDING.md"), "utf8"), "# Pending\n## Queue\n### Proposed entry\n");
  await rejects(writeWikiFile("PENDING.md", "x", 42, root), 400);
});

test("concurrent saves from the same base version allow exactly one writer", async () => {
  const { root } = await fixture();
  const loaded = await readWikiFile("INDEX.md", root);
  const [first, second] = await Promise.allSettled([
    writeWikiFile("INDEX.md", "A".repeat(400_000), loaded.hash, root),
    writeWikiFile("INDEX.md", "B".repeat(400_000), loaded.hash, root),
  ]);
  const outcomes = [first, second];
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected" && rejected.reason instanceof WikiError);
  assert.equal(rejected.reason.status, 409);
  const content = await fs.readFile(path.join(root, "INDEX.md"), "utf8");
  assert.ok(content === "A".repeat(400_000) || content === "B".repeat(400_000));
});

test("writeWikiFile creates new daily notes but never creates over an existing file", async () => {
  const { root } = await fixture();
  await writeWikiFile("daily/2026-10-06.md", "# Day 2\n", null, root);
  assert.equal(await fs.readFile(path.join(root, "daily", "2026-10-06.md"), "utf8"), "# Day 2\n");
  await assert.rejects(writeWikiFile("daily/2026-10-05.md", "clobber", null, root), (e: unknown) => {
    assert.ok(e instanceof WikiError);
    assert.equal(e.status, 409);
    const current = (e as WikiError & { current?: { content: string; hash: string } }).current;
    assert.equal(current?.content, "# Day\n");
    assert.equal(current?.hash, hashContent("# Day\n"));
    return true;
  });
  assert.equal(await fs.readFile(path.join(root, "daily", "2026-10-05.md"), "utf8"), "# Day\n");
  await rejects(writeWikiFile("gone.md", "x", "deadbeef", root), 409);
});

test("writeWikiFile refuses MEMORY.md/USER.md, escapes, non-md, and oversize content", async () => {
  const { root, base } = await fixture();
  await rejects(writeWikiFile("MEMORY.md", "x", null, root), 403);
  await rejects(writeWikiFile("sub/user.md", "x", null, root), 403);
  await rejects(writeWikiFile("escape.md", "x", "h", root), 403);
  await rejects(writeWikiFile("outside/new.md", "x", null, root), 403);
  await rejects(writeWikiFile("x.sh", "x", null, root), 400);
  await rejects(writeWikiFile("big.md", "a".repeat(600 * 1024), null, root), 413);
  assert.equal(await fs.readFile(path.join(base, "secret.md"), "utf8"), "SECRET=1");
});

test("missing root reports 503 instead of leaking paths", async () => {
  await rejects(listWiki("/nonexistent/wiki-root-xyz"), 503);
});

test("symlinks inside the root cannot alias reserved or hidden files", async () => {
  const { root } = await fixture();
  await fs.writeFile(path.join(root, "MEMORY.md"), "mem");
  await fs.symlink("MEMORY.md", path.join(root, "alias.md"));
  await fs.writeFile(path.join(root, ".env"), "TOKEN=abc");
  await fs.symlink(".env", path.join(root, "env.md"));
  const alias = await readWikiFile("alias.md", root);
  await rejects(writeWikiFile("alias.md", "PWNED", alias.hash, root), 403);
  assert.equal(await fs.readFile(path.join(root, "MEMORY.md"), "utf8"), "mem");
  await rejects(readWikiFile("env.md", root), 403);
});

test("editing a file deleted after it was opened reports 409, not 500", async () => {
  const { root } = await fixture();
  const loaded = await readWikiFile("INDEX.md", root);
  await fs.unlink(path.join(root, "INDEX.md"));
  await rejects(writeWikiFile("INDEX.md", "x", loaded.hash, root), 409);
});
