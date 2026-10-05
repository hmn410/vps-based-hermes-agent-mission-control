import assert from "node:assert/strict";
import test from "node:test";
import { type Block, type Inline, inlineText, openProposals, parseInline, parseMarkdown, parsePending, resolveWikiLink, slugify } from "./wiki-markdown";

test("resolveWikiLink keeps links inside the wiki", () => {
  assert.deepEqual(resolveWikiLink("INDEX.md", "standing-instructions.md"), { kind: "wiki", path: "standing-instructions.md", hash: "" });
  assert.deepEqual(resolveWikiLink("daily/2026-10-05.md", "../INDEX.md"), { kind: "wiki", path: "INDEX.md", hash: "" });
  assert.deepEqual(resolveWikiLink("INDEX.md", "daily/"), { kind: "dir", path: "daily" });
  assert.deepEqual(resolveWikiLink("INDEX.md", "preferences/hermy-hq-operating-model.md"), { kind: "wiki", path: "preferences/hermy-hq-operating-model.md", hash: "" });
  assert.equal(resolveWikiLink("INDEX.md", "../../etc/passwd.md"), null);
  assert.equal(resolveWikiLink("INDEX.md", "javascript:alert(1)"), null);
  assert.equal(resolveWikiLink("INDEX.md", "//evil.example/x.md"), null);
  assert.deepEqual(resolveWikiLink("INDEX.md", "https://example.com"), { kind: "external", href: "https://example.com" });
});

test("parseMarkdown handles headings, lists, code, quotes and frontmatter", () => {
  const blocks = parseMarkdown("---\nid: x\n---\n# Title\n\n- [Link](a.md) — **bold**\n- [ ] todo\n\n```markdown\n### not a heading\n```\n\n> quoted\n");
  assert.deepEqual(blocks.map((b) => b.t), ["h", "list", "code", "quote"]);
  const list = blocks[1];
  assert.ok(list.t === "list" && list.items[1].checked === false);
  assert.deepEqual(parseInline("`code` and <script>"), [{ t: "code", v: "code" }, { t: "text", v: " and <script>" }]);
});

const EMPTY = `# Pending Long-Term Memory Proposals

## Proposal template

\`\`\`markdown
### Proposed entry — YYYY-MM-DD
- Target: \`MEMORY.md\` or \`USER.md\`
- Status: pending | approved | declined | promoted
\`\`\`

## Queue

_No pending proposals._
`;

test("parsePending ignores the template and reports an empty queue", () => {
  assert.deepEqual(parsePending(EMPTY), []);
});

test("parsePending lists proposals and counts only open ones", () => {
  const src = EMPTY.replace(
    "_No pending proposals._",
    `### Proposed entry — 2026-10-05
- Target: \`USER.md\`
- Exact text:
  > Josh prefers plain-text CLI replies.
- Status: pending

### Proposed entry — 2026-10-04
- Target: \`MEMORY.md\`
- Exact text:
  > Old fact.
- Status: declined
`,
  );
  const all = parsePending(src);
  assert.equal(all.length, 2);
  assert.equal(all[0].target, "USER.md");
  assert.equal(all[0].summary, "Josh prefers plain-text CLI replies.");
  assert.deepEqual(openProposals(all).map((p) => p.title), ["Proposed entry — 2026-10-05"]);
});

test("link URLs may contain balanced parentheses", () => {
  const nodes = parseInline("see [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) now");
  assert.deepEqual(nodes[1], { t: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", c: [{ t: "text", v: "Foo" }] });
  assert.deepEqual(nodes[2], { t: "text", v: " now" });
  // Nested and wiki-relative paths too.
  const rel = parseInline("[n](notes/a_(b_(c)).md)");
  assert.equal(rel[0].t === "link" && rel[0].href, "notes/a_(b_(c)).md");
  // Unbalanced: not a link, rendered as text.
  assert.deepEqual(parseInline("[x](oops"), [{ t: "text", v: "[x](oops" }]);
});

test("escaped pipes stay inside table cells", () => {
  const [table] = parseMarkdown("| cmd | meaning |\n| --- | --- |\n| a \\| b | or |\n");
  assert.ok(table.t === "table");
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].length, 2);
  assert.equal(inlineText(table.rows[0][0]), "a | b");
  assert.equal(inlineText(table.rows[0][1]), "or");
});

test("table header row is separated from body rows", () => {
  const [table] = parseMarkdown("| Name | Value |\n|:--|--:|\n| x | 1 |\n| y | 2 |\n");
  assert.ok(table.t === "table");
  assert.deepEqual(table.head?.map(inlineText), ["Name", "Value"]);
  assert.deepEqual(table.rows.map((r) => r.map(inlineText)), [["x", "1"], ["y", "2"]]);
  // No delimiter row: no header.
  const [plain] = parseMarkdown("| a | b |\n| c | d |\n");
  assert.ok(plain.t === "table" && plain.head === null && plain.rows.length === 2);
});

test("switching between bullet and numbered markers starts a new list", () => {
  const blocks = parseMarkdown("- one\n- two\n1. first\n2. second\n- back\n");
  const lists = blocks.filter((b): b is Extract<Block, { t: "list" }> => b.t === "list");
  assert.deepEqual(lists.map((l) => [l.ordered, l.items.length]), [[false, 2], [true, 2], [false, 1]]);
  // Nested items of another kind stay in the parent list.
  const [nested] = parseMarkdown("- parent\n  1. child\n- sibling\n");
  assert.ok(nested.t === "list" && nested.items.length === 3);
});

test("internal links keep their #fragment and headings get matching ids", () => {
  assert.deepEqual(resolveWikiLink("INDEX.md", "standing-instructions.md#Memory-rules"), { kind: "wiki", path: "standing-instructions.md", hash: "Memory-rules" });
  assert.deepEqual(resolveWikiLink("daily/2026-10-05.md", "#todo"), { kind: "wiki", path: "daily/2026-10-05.md", hash: "todo" });
  assert.equal(resolveWikiLink("INDEX.md", "#"), null);
  const heads = parseMarkdown("# Memory rules\n## Memory rules\n### `code` & **Bold**!\n").filter((b): b is Extract<Block, { t: "h" }> => b.t === "h");
  assert.deepEqual(heads.map((h) => h.id), ["memory-rules", "memory-rules-1", "code--bold"]);
  assert.equal(slugify("Hermy HQ — Wiki"), "hermy-hq--wiki");
});

test("XSS protections: script/data URLs are not links and raw HTML is plain text", () => {
  for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd"]) {
    assert.equal(resolveWikiLink("INDEX.md", href), null, href);
  }
  const nodes = parseInline("[click](javascript:alert(document.cookie))");
  assert.equal(nodes[0].t === "link" && nodes[0].href, "javascript:alert(document.cookie)");
  assert.equal(resolveWikiLink("INDEX.md", (nodes[0] as Extract<Inline, { t: "link" }>).href), null);
  const [p] = parseMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
  assert.ok(p.t === "p");
  assert.deepEqual(p.c, [{ t: "text", v: '<img src=x onerror="alert(1)"> <script>alert(1)</script>' }]);
});
