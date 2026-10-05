import assert from "node:assert/strict";
import test from "node:test";
import { openProposals, parseInline, parseMarkdown, parsePending, resolveWikiLink } from "./wiki-markdown";

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
