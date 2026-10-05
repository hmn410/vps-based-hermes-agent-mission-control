"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, FileText, Pencil, RefreshCw, Save, X } from "lucide-react";
import { Panel, Pill, SectionHeader } from "@/components/ui/kit";
import {
  type Block,
  type Inline,
  type PendingProposal,
  openProposals,
  parseMarkdown,
  resolveWikiLink,
} from "@/lib/wiki-markdown";

/** Poll interval for detecting changes made by Hermes profiles. Paused while the tab is hidden. */
export const WIKI_POLL_MS = 3000;

type FileMeta = { path: string; size: number; mtime: string; hash: string };
type WikiFile = { path: string; content: string; hash: string; mtime: string };
type Catalog = { files: FileMeta[]; pending: { open: number; proposals: PendingProposal[] } | null; checkedAt: string };

const CORE = ["INDEX.md", "PENDING.md", "standing-instructions.md", "projects/specs-and-decisions.md"];

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function readHashPath() {
  if (typeof window === "undefined") return "INDEX.md";
  const h = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return h && h.toLowerCase().endsWith(".md") ? h : "INDEX.md";
}

function InlineView({ nodes, from, go }: { nodes: Inline[]; from: string; go: (p: string) => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "code":
            return <code key={i} className="rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-[12px] text-[var(--text)]">{n.v}</code>;
          case "strong":
            return <strong key={i} className="font-semibold text-[var(--text)]"><InlineView nodes={n.c} from={from} go={go} /></strong>;
          case "em":
            return <em key={i}><InlineView nodes={n.c} from={from} go={go} /></em>;
          case "link": {
            const target = resolveWikiLink(from, n.href);
            const label = <InlineView nodes={n.c} from={from} go={go} />;
            if (!target) return <span key={i} className="underline decoration-dotted">{label}</span>;
            if (target.kind === "external")
              return <a key={i} href={target.href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">{label}</a>;
            const dest = target.kind === "dir" ? `dir:${target.path}` : target.path;
            return (
              <button key={i} type="button" onClick={() => go(dest)} className="text-[var(--accent)] underline underline-offset-2">
                {label}
              </button>
            );
          }
        }
      })}
    </>
  );
}

function BlocksView({ blocks, from, go }: { blocks: Block[]; from: string; go: (p: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h": {
            const size = ["text-[20px]", "text-[17px]", "text-[15px]", "text-[14px]", "text-[13px]", "text-[13px]"][b.level - 1];
            return <div key={i} role="heading" aria-level={b.level} className={`${size} mt-5 mb-2 font-semibold text-[var(--text)] first:mt-0`}><InlineView nodes={b.c} from={from} go={go} /></div>;
          }
          case "p":
            return <p key={i} className="my-2 leading-relaxed"><InlineView nodes={b.c} from={from} go={go} /></p>;
          case "code":
            return <pre key={i} className="my-3 overflow-x-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[12px] text-[var(--text-2)]">{b.v}</pre>;
          case "quote":
            return <blockquote key={i} className="my-3 border-l-2 border-[var(--line-strong)] pl-3 text-[var(--text-3)]"><BlocksView blocks={b.c} from={from} go={go} /></blockquote>;
          case "hr":
            return <hr key={i} className="my-4 border-[var(--line)]" />;
          case "table":
            return (
              <div key={i} className="my-3 overflow-x-auto">
                <table className="text-[12.5px]">
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-[var(--line)]">
                        {row.map((cell, c) => (
                          <td key={c} className={`px-2 py-1 align-top ${r === 0 ? "font-semibold text-[var(--text)]" : ""}`}><InlineView nodes={cell} from={from} go={go} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`my-2 space-y-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j} style={{ marginLeft: it.depth * 16 }} className={it.checked !== null ? "list-none -ml-5" : ""}>
                    {it.checked !== null && <span className="mr-1.5 font-mono">{it.checked ? "☑" : "☐"}</span>}
                    <InlineView nodes={it.c} from={from} go={go} />
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </>
  );
}

export function WikiView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [current, setCurrent] = useState("INDEX.md");
  const [dirView, setDirView] = useState<string | null>(null);
  const [file, setFile] = useState<WikiFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [baseHash, setBaseHash] = useState<string | null>(null);
  const [conflict, setConflict] = useState<WikiFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [, tick] = useState(0);
  const fileRef = useRef<WikiFile | null>(null);
  const editingRef = useRef(false);
  fileRef.current = file;
  editingRef.current = editing;

  const loadFile = useCallback(async (path: string) => {
    setFileError(null);
    try {
      const r = await fetch(`/api/wiki/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not load file.");
      setFile(data);
    } catch (e) {
      setFile(null);
      setFileError(e instanceof Error ? e.message : "Could not load file.");
    }
  }, []);

  const pollCatalog = useCallback(async () => {
    try {
      const r = await fetch("/api/wiki", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Wiki unavailable.");
      setCatalog(data);
      setCatalogError(null);
      const open = fileRef.current;
      if (open) {
        const meta = (data as Catalog).files.find((f) => f.path === open.path);
        if (meta && meta.hash !== open.hash) {
          setLastChange(new Date().toISOString());
          if (editingRef.current) {
            setNotice("This file was changed on disk while you are editing. Saving will be blocked until you review the latest version.");
          } else {
            await loadFile(open.path);
          }
        }
      }
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Wiki unavailable.");
    }
  }, [loadFile]);

  // Hash routing (#path.md) so records are linkable and the back button works.
  useEffect(() => {
    const sync = () => {
      setCurrent(readHashPath());
      setDirView(null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (editingRef.current) return;
    void loadFile(current);
  }, [current, loadFile]);

  // Bounded polling: one lightweight catalog request every WIKI_POLL_MS while visible.
  useEffect(() => {
    void pollCatalog();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => void pollCatalog(), WIKI_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        void pollCatalog();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    const clock = setInterval(() => tick((n) => n + 1), 5000);
    return () => {
      stop();
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollCatalog]);

  const go = useCallback((dest: string) => {
    if (editingRef.current && !window.confirm("Discard unsaved edits?")) return;
    setEditing(false);
    setConflict(null);
    setNotice(null);
    if (dest.startsWith("dir:")) {
      setDirView(dest.slice(4));
      return;
    }
    setDirView(null);
    window.location.hash = encodeURIComponent(dest).replace(/%2F/g, "/");
  }, []);

  const startEdit = () => {
    if (!file) return;
    setDraft(file.content);
    setBaseHash(file.hash);
    setConflict(null);
    setNotice(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (file && draft !== file.content && !window.confirm("Discard unsaved edits?")) return;
    setEditing(false);
    setConflict(null);
    setNotice(null);
    void loadFile(current);
  };

  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const r = await fetch("/api/wiki/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: draft, baseHash }),
      });
      const data = await r.json();
      if (r.status === 409) {
        setConflict(data.current ?? null);
        setNotice(data.error || "Conflict: the file changed on disk.");
        return;
      }
      if (!r.ok) throw new Error(data.error || "Save failed.");
      setFile(data);
      setEditing(false);
      setConflict(null);
      setNotice("Saved to the shared wiki file. All Hermes profiles see it on their next read.");
      void pollCatalog();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // After a conflict: load the on-disk version into the editor as the new base (the user's draft stays visible for copy).
  const takeTheirs = () => {
    if (!conflict) return;
    setDraft(conflict.content);
    setBaseHash(conflict.hash);
    setFile(conflict);
    setConflict(null);
    setNotice("Loaded the latest on-disk version. Re-apply your change, then save.");
  };

  const blocks = useMemo(() => (file ? parseMarkdown(file.content) : []), [file]);
  const files = catalog?.files ?? [];
  const daily = files.filter((f) => f.path.startsWith("daily/")).sort((a, b) => b.path.localeCompare(a.path));
  const other = files.filter((f) => !CORE.includes(f.path) && !f.path.startsWith("daily/"));
  const pending = catalog?.pending;
  const openList = pending ? openProposals(pending.proposals) : [];
  const latestEdit = files.reduce<FileMeta | null>((a, f) => (!a || f.mtime > a.mtime ? f : a), null);

  const navItem = (f: FileMeta) => (
    <button
      key={f.path}
      type="button"
      onClick={() => go(f.path)}
      className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1 text-left text-[12.5px] transition-colors ${
        f.path === current && !dirView ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--text-2)] hover:bg-[var(--surface-1)]"
      }`}
    >
      <span className="truncate font-mono">{f.path}</span>
      <span className="shrink-0 text-[10.5px] text-[var(--text-4)]">{ago(f.mtime)}</span>
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <SectionHeader
        label="Shared read-me"
        title="Hermes Wiki"
        action={
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
            {catalogError ? <Pill tone="down">{catalogError}</Pill> : <Pill tone="up">Live · checks every {WIKI_POLL_MS / 1000}s</Pill>}
            {catalog && <span>checked {ago(catalog.checkedAt)}</span>}
            <button type="button" onClick={() => void pollCatalog()} className="btn-ghost p-1.5" aria-label="Refresh now">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />

      <Panel className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow">Pending memory proposals (PENDING.md)</div>
            {!pending ? (
              <p className="mt-1 text-[13px] text-[var(--text-3)]">PENDING.md not found.</p>
            ) : openList.length === 0 ? (
              <p className="mt-1 text-[13px] text-[var(--text-2)]">Queue is empty — no proposals awaiting approval.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[13px] text-[var(--text-2)]">
                {openList.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium text-[var(--text)]">{p.title}</span>
                    {p.target && <span className="text-[var(--text-3)]"> → {p.target}</span>}
                    <span className="text-[var(--text-3)]"> — {p.summary.slice(0, 160)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11.5px] text-[var(--text-4)]">
              Read-only queue. Hermy HQ never promotes entries into MEMORY.md / USER.md; Josh approves each exact entry with Hermes directly.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pending && <Pill tone={openList.length ? "warn" : "neutral"}>{openList.length} pending</Pill>}
            <button type="button" onClick={() => go("PENDING.md")} className="btn-ghost px-2.5 py-1 text-[11.5px]">Open queue</button>
          </div>
        </div>
        {latestEdit && (
          <p className="mt-3 border-t border-[var(--line)] pt-2 text-[11.5px] text-[var(--text-3)]">
            Latest wiki activity: <button type="button" className="font-mono underline" onClick={() => go(latestEdit.path)}>{latestEdit.path}</button> updated {ago(latestEdit.mtime)}.
          </p>
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-[230px_1fr]">
        <Panel className="h-fit p-3">
          <div className="eyebrow mb-1 px-2">Core</div>
          {CORE.map((p) => files.find((f) => f.path === p)).filter((f): f is FileMeta => !!f).map((f) => navItem(f))}
          {other.length > 0 && <div className="eyebrow mb-1 mt-3 px-2">Records</div>}
          {other.map((f) => navItem(f))}
          {daily.length > 0 && (
            <>
              <div className="eyebrow mb-1 mt-3 px-2">Daily notes</div>
              {daily.slice(0, 14).map((f) => navItem(f))}
            </>
          )}
        </Panel>

        <Panel className="min-w-0 p-5">
          {dirView !== null ? (
            <div>
              <div className="mb-3 flex items-center gap-2 font-mono text-[13px] text-[var(--text)]"><BookOpen className="h-4 w-4" /> {dirView}/</div>
              <ul className="space-y-1">
                {files.filter((f) => f.path.startsWith(dirView + "/")).sort((a, b) => b.path.localeCompare(a.path)).map((f) => (
                  <li key={f.path}>{navItem(f)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <FileText className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
                  <span className="truncate font-mono text-[var(--text)]">{current}</span>
                  {file && <span className="text-[11px] text-[var(--text-4)]">updated {ago(file.mtime)}</span>}
                  {lastChange && Date.now() - new Date(lastChange).getTime() < 15000 && <Pill tone="accent">changed on disk</Pill>}
                </div>
                {file && !editing && (
                  <button type="button" onClick={startEdit} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {editing && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={save} disabled={saving || !!conflict} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1 text-[11.5px] disabled:opacity-50">
                      <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={cancelEdit} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {notice && (
                <div className={`mb-3 flex items-start gap-2 rounded-[8px] border p-2.5 text-[12px] ${conflict || /changed on disk/.test(notice) ? "border-[var(--warn)] text-[var(--warn)]" : "border-[var(--line)] text-[var(--text-2)]"}`}>
                  {(conflict || /changed on disk/.test(notice)) && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <div className="flex-1">
                    {notice}
                    {conflict && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={takeTheirs} className="btn-ghost px-2 py-1 text-[11.5px]">Load latest version (your draft is shown below to copy)</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {fileError && <p className="text-[13px] text-[var(--down)]">{fileError}</p>}

              {editing ? (
                <div className="space-y-3">
                  {conflict && (
                    <div>
                      <div className="eyebrow mb-1">Latest on-disk version (changed by someone else)</div>
                      <pre className="max-h-64 overflow-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[12px] text-[var(--text-2)]">{conflict.content}</pre>
                      <div className="eyebrow mb-1 mt-3">Your draft</div>
                    </div>
                  )}
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    rows={24}
                    className="w-full resize-y rounded-[8px] border border-[var(--line)] bg-[var(--surface-1)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none"
                  />
                  {current === "PENDING.md" && (
                    <p className="text-[11.5px] text-[var(--text-3)]">Editing PENDING.md only changes the proposal queue. It does not write MEMORY.md or USER.md.</p>
                  )}
                </div>
              ) : (
                file && (
                  <article className="text-[13.5px] text-[var(--text-2)]">
                    <BlocksView blocks={blocks} from={file.path} go={go} />
                  </article>
                )
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
