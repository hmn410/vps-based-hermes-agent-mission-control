/**
 * Minimal, dependency-free Markdown parsing for the Hermy HQ read-me wiki.
 * Produces a plain data AST that the client renders as React elements, so no
 * raw HTML from wiki files ever reaches the DOM (no dangerouslySetInnerHTML).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h"; level: number; c: Inline[]; id: string }
  | { t: "p"; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; items: { checked: boolean | null; c: Inline[]; depth: number }[] }
  | { t: "table"; head: Inline[][] | null; rows: Inline[][][] }
  | { t: "hr" };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#!|-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || (ch === "_" && (i === 0 || /\W/.test(src[i - 1])))) {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[i + 1] !== " ") {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = src.indexOf("](", i + 1);
      const end = close > i ? matchParen(src, close + 1) : -1;
      if (close > i && end > close) {
        flush();
        out.push({ t: "link", href: src.slice(close + 2, end).trim(), c: parseInline(src.slice(i + 1, close)) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Index of the `)` that closes the `(` at `open`, honouring nested parentheses and `\)` escapes; -1 if unbalanced. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j;
  }
  return -1;
}

/** Split a `| a | b |` table row on unescaped pipes. `\|` stays escaped so parseInline renders a literal `|`. */
export function splitTableRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "\\" && j + 1 < body.length) {
      cur += c + body[j + 1];
      j++;
    } else if (c === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** Plain text of inline nodes (used for heading ids). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c))).join("");
}

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(src: string, seenIds: Map<string, number> = new Map()): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  // Skip YAML frontmatter.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) i = end + 1;
  }
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
      i++;
      blocks.push({ t: "code", lang: fence[2] || "", v: buf.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const c = parseInline(h[2]);
      const base = slugify(inlineText(c)) || "section";
      const n = seenIds.get(base) ?? 0;
      seenIds.set(base, n + 1);
      blocks.push({ t: "h", level: h[1].length, c, id: n ? `${base}-${n}` : base });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(buf.join("\n"), seenIds) });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const raw: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) raw.push(splitTableRow(lines[i++]));
      const isSep = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c));
      // GFM: the first row is a header only when the delimiter row follows it.
      const hasHead = raw.length > 1 && isSep(raw[1]);
      const head = hasHead ? raw[0].map(parseInline) : null;
      const rows = raw.slice(hasHead ? 2 : 0).filter((cells) => !isSep(cells)).map((cells) => cells.map(parseInline));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    const lm = line.match(LIST_RE);
    if (lm) {
      const ordered = /\d/.test(lm[2]);
      const items: { checked: boolean | null; c: Inline[]; depth: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_RE);
        // A top-level marker of the other kind (`-` vs `1.`) starts a new list.
        if (m && items.length && /\d/.test(m[2]) !== ordered && m[1].replace(/\t/g, "  ").length < 2) break;
        if (m) {
          let text = m[3];
          let checked: boolean | null = null;
          const cb = text.match(/^\[([ xX])\]\s+(.*)$/);
          if (cb) {
            checked = cb[1] !== " ";
            text = cb[2];
          }
          items.push({ checked, c: parseInline(text), depth: Math.min(4, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          // Continuation line of the previous item.
          items[items.length - 1].c.push({ t: "text", v: " " }, ...parseInline(lines[i].trim()));
          i++;
        } else break;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~|>)/.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    )
      buf.push(lines[i++].trim());
    blocks.push({ t: "p", c: parseInline(buf.join(" ")) });
  }
  return blocks;
}

/**
 * Resolve a link found in `fromPath` to an in-wiki target.
 * Returns {kind:"wiki", path} for .md files, {kind:"dir", path} for folders
 * (e.g. `daily/`), {kind:"external", href} for http(s)/mailto, or null.
 */
export function resolveWikiLink(fromPath: string, href: string):
  | { kind: "wiki"; path: string; hash: string }
  | { kind: "dir"; path: string }
  | { kind: "external"; href: string }
  | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return { kind: "external", href: h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return null;
  const hashAt = h.indexOf("#");
  const pathPart = hashAt < 0 ? h : h.slice(0, hashAt);
  const frag = hashAt < 0 ? "" : h.slice(hashAt + 1);
  // `#section` links point at a heading in the current file.
  if (!pathPart) return frag ? { kind: "wiki", path: fromPath, hash: frag } : null;
  const baseParts = fromPath.split("/").slice(0, -1);
  const parts = pathPart.startsWith("/") ? [] : baseParts;
  for (const seg of pathPart.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  const resolved = parts.join("/");
  if (pathPart.endsWith("/")) return { kind: "dir", path: resolved };
  if (!resolved.toLowerCase().endsWith(".md")) return null;
  return { kind: "wiki", path: resolved, hash: frag };
}

export type PendingProposal = { title: string; target: string | null; status: string | null; summary: string };

/**
 * Parse the `## Queue` section of PENDING.md into proposals (one per `###`
 * heading). The proposal template inside a code fence is ignored.
 */
export function parsePending(src: string): PendingProposal[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: PendingProposal[] = [];
  let inQueue = false;
  let inFence = false;
  let cur: (PendingProposal & { text: string[] }) | null = null;
  const push = () => {
    if (!cur) return;
    const exact = cur.text.join(" ").replace(/\s+/g, " ").trim();
    out.push({ title: cur.title, target: cur.target, status: cur.status, summary: exact || cur.title });
    cur = null;
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      push();
      inQueue = /queue/i.test(h2[1]);
      continue;
    }
    if (!inQueue) continue;
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      push();
      cur = { title: h3[1].trim(), target: null, status: null, summary: "", text: [] };
      continue;
    }
    if (!cur) continue;
    const target = line.match(/^\s*-\s*Target:\s*(.*)$/i);
    if (target) {
      cur.target = target[1].replace(/`/g, "").trim();
      continue;
    }
    const status = line.match(/^\s*-\s*Status:\s*(.*)$/i);
    if (status) {
      cur.status = status[1].replace(/`/g, "").trim().toLowerCase();
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote && quote[1].trim()) cur.text.push(quote[1].trim());
  }
  push();
  return out;
}

/** Proposals still awaiting a decision (status missing or "pending"). */
export function openProposals(list: PendingProposal[]) {
  return list.filter((p) => !p.status || p.status === "pending");
}
