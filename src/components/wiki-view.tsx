"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CalendarPlus, FileText, Lock, Pencil, RefreshCw, Save, X } from "lucide-react";
import { Panel, Pill, SectionHeader } from "@/components/ui/kit";
import {
  type Block,
  type Inline,
  type PendingProposal,
  openProposals,
  parseMarkdown,
  resolveWikiLink,
  slugify,
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

const RESERVED_RE = /^(memory|user)\.md$/i;

/** MEMORY.md / USER.md (any folder, any case) are never editable from Hermy HQ. */
export function isReservedWikiPath(p: string) {
  return RESERVED_RE.test(p.split("/").pop() ?? "");
}

/** Today's date in the operator's timezone, as YYYY-MM-DD. */
function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

type Route = { path: string; frag: string };

/** Parse `#path.md` or `#path.md#heading`. Malformed percent-encoding falls back to INDEX.md instead of throwing. */
function parseHash(rawHash: string): Route {
  const raw = rawHash.replace(/^#/, "");
  const at = raw.indexOf("#");
  const pathPart = at < 0 ? raw : raw.slice(0, at);
  const fragPart = at < 0 ? "" : raw.slice(at + 1);
  let path = "";
  let frag = "";
  try {
    path = decodeURIComponent(pathPart);
  } catch {
    return { path: "INDEX.md", frag: "" };
  }
  try {
    frag = decodeURIComponent(fragPart);
  } catch {
    frag = "";
  }
  return path && path.toLowerCase().endsWith(".md") ? { path, frag } : { path: "INDEX.md", frag: "" };
}

function readHashRoute(): Route {
  if (typeof window === "undefined") return { path: "INDEX.md", frag: "" };
  return parseHash(window.location.hash);
}

function routeHash(path: string, frag = "") {
  return "#" + encodeURIComponent(path).replace(/%2F/g, "/") + (frag ? "#" + encodeURIComponent(frag) : "");
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
            const dest = target.kind === "dir" ? `dir:${target.path}` : target.hash ? `${target.path}#${target.hash}` : target.path;
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
            return <div key={i} id={`wiki-${b.id}`} role="heading" aria-level={b.level} className={`${size} mt-5 mb-2 font-semibold text-[var(--text)] first:mt-0`}><InlineView nodes={b.c} from={from} go={go} /></div>;
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
                  {b.head && (
                    <thead>
                      <tr className="border-b border-[var(--line-strong)]">
                        {b.head.map((cell, c) => (
                          <th key={c} scope="col" className="px-2 py-1 text-left align-top font-semibold text-[var(--text)]"><InlineView nodes={cell} from={from} go={go} /></th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-b border-[var(--line)]">
                        {row.map((cell, c) => (
                          <td key={c} className="px-2 py-1 align-top"><InlineView nodes={cell} from={from} go={go} /></td>
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

type EditSession = { path: string; baseHash: string | null };
type NoticeKind = "info" | "warn" | "gone";
type FileError = { kind: "notfound" | "removed" | "other"; message: string };

export function WikiView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [current, setCurrent] = useState("INDEX.md");
  const [frag, setFrag] = useState("");
  const [dirView, setDirView] = useState<string | null>(null);
  const [file, setFile] = useState<WikiFile | null>(null);
  const [fileError, setFileError] = useState<FileError | null>(null);
  // The edit session owns the path and base version the draft was loaded from;
  // Save always targets edit.path, never whatever happens to be displayed.
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [draft, setDraft] = useState("");
  const [stashedDraft, setStashedDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<WikiFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [creatingDaily, setCreatingDaily] = useState(false);
  const [, tick] = useState(0);
  const fileRef = useRef<WikiFile | null>(null);
  const currentRef = useRef(current);
  const editRef = useRef<EditSession | null>(null);
  const draftRef = useRef(draft);
  const lastHashRef = useRef("");
  const fileRequest = useRef(0);
  const loadingPath = useRef<string | null>(null);
  const catalogInFlight = useRef(false);
  fileRef.current = file;
  currentRef.current = current;
  editRef.current = edit;
  draftRef.current = draft;
  const editing = edit !== null;

  const loadFile = useCallback(async (path: string) => {
    const request = ++fileRequest.current;
    loadingPath.current = path;
    try {
      const r = await fetch(`/api/wiki/file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const data = await r.json();
      if (request !== fileRequest.current || path !== currentRef.current) return;
      if (!r.ok) {
        setFile(null);
        setFileError(r.status === 404 ? { kind: "notfound", message: `Not found: ${path} does not exist in the wiki.` } : { kind: "other", message: data.error || "Could not load file." });
        return;
      }
      setFile(data);
      setFileError(null);
    } catch (e) {
      if (request === fileRequest.current && path === currentRef.current) {
        setFile(null);
        setFileError({ kind: "other", message: e instanceof Error ? e.message : "Could not load file." });
      }
    } finally {
      if (request === fileRequest.current) loadingPath.current = null;
    }
  }, []);

  /** Drop the edit session synchronously (refs too, so a following hashchange does not re-prompt). */
  const endEdit = useCallback(() => {
    editRef.current = null;
    setEdit(null);
    setConflict(null);
    setStashedDraft(null);
    setNotice(null);
  }, []);

  const pollCatalog = useCallback(async () => {
    if (catalogInFlight.current) return;
    catalogInFlight.current = true;
    try {
      const r = await fetch("/api/wiki", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Wiki unavailable.");
      setCatalog(data);
      setLastCheckedAt(Date.now());
      setCatalogError(null);
      const selectedPath = currentRef.current;
      const selectedMeta = (data as Catalog).files.find((f) => f.path === selectedPath);
      const open = fileRef.current;
      const session = editRef.current;
      if (!selectedMeta) {
        // Only a file we actually had open was "removed"; a path that never loaded keeps its "Not found" error.
        if (open && open.path === selectedPath) {
          fileRequest.current += 1;
          setFile(null);
          setFileError({ kind: "removed", message: "This file was removed or moved on disk." });
          if (session && session.path === selectedPath) {
            setNotice({ kind: "gone", text: "This file was removed or moved on disk while you are editing. Your draft is kept; use Recreate file to save it again." });
          }
        }
      } else if (open && open.path === selectedPath) {
        if (selectedMeta.hash !== open.hash) {
          setLastChange(new Date().toISOString());
          if (session) {
            setNotice({ kind: "warn", text: "This file was changed on disk while you are editing. Saving will be blocked until you review the latest version." });
          } else {
            await loadFile(open.path);
          }
        }
      } else if (!session && loadingPath.current !== selectedPath) {
        // Nothing open (e.g. it was removed and has now reappeared): load it.
        await loadFile(selectedPath);
      }
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : "Wiki unavailable.");
    } finally {
      catalogInFlight.current = false;
    }
  }, [loadFile]);

  // Hash routing (#path.md or #path.md#heading) so records are linkable and the back button works.
  useEffect(() => {
    const sync = () => {
      const route = readHashRoute();
      const session = editRef.current;
      if (session && route.path !== session.path) {
        const dirty = fileRef.current?.path !== session.path || draftRef.current !== fileRef.current?.content;
        if (dirty && !window.confirm(`Discard unsaved edits to ${session.path}?`)) {
          // Stay on the file being edited: put its hash back without adding a history entry.
          window.history.replaceState(window.history.state, "", lastHashRef.current || routeHash(session.path));
          return;
        }
        endEdit();
      }
      lastHashRef.current = window.location.hash;
      setCurrent(route.path);
      setFrag(route.frag);
      setDirView(null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [endEdit]);

  // Load whenever the displayed file is not the selected one (and we are not mid-edit on it).
  useEffect(() => {
    if (edit && edit.path === current) return;
    if (fileRef.current?.path === current) return;
    setFile(null);
    setFileError(null);
    void loadFile(current);
  }, [current, edit, loadFile]);

  // Scroll to #heading after the target file renders.
  useEffect(() => {
    if (!frag || !file || file.path !== current || edit) return;
    const el = document.getElementById(`wiki-${frag}`) ?? document.getElementById(`wiki-${slugify(frag)}`);
    el?.scrollIntoView({ block: "start" });
  }, [frag, file, current, edit]);

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
      const visible = !document.hidden;
      setIsVisible(visible);
      if (!visible) stop();
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

  /** Navigate to `path`, `path#heading`, or `dir:folder`. Returns false if the user kept their edits. */
  const go = useCallback((dest: string, opts: { skipConfirm?: boolean } = {}) => {
    if (editRef.current && !opts.skipConfirm && !window.confirm("Discard unsaved edits?")) return false;
    endEdit();
    if (dest.startsWith("dir:")) {
      setDirView(dest.slice(4));
      return true;
    }
    const at = dest.indexOf("#");
    const path = at < 0 ? dest : dest.slice(0, at);
    const nextFrag = at < 0 ? "" : dest.slice(at + 1);
    setDirView(null);
    const hash = routeHash(path, nextFrag);
    if (path === currentRef.current) {
      // Same file: the hash may not change, so refresh explicitly (clears stale "removed" errors).
      if (window.location.hash !== hash) window.history.pushState(window.history.state, "", hash);
      lastHashRef.current = hash;
      setFrag(nextFrag);
      if (nextFrag) {
        const el = document.getElementById(`wiki-${nextFrag}`) ?? document.getElementById(`wiki-${slugify(nextFrag)}`);
        el?.scrollIntoView({ block: "start" });
      }
      void loadFile(path);
      return true;
    }
    window.location.hash = hash.slice(1);
    return true;
  }, [endEdit, loadFile]);

  const startEdit = () => {
    if (!file || isReservedWikiPath(file.path)) return;
    setDraft(file.content);
    setStashedDraft(null);
    setConflict(null);
    setNotice(null);
    const session = { path: file.path, baseHash: file.hash };
    editRef.current = session;
    setEdit(session);
  };

  const cancelEdit = () => {
    if (!edit) return;
    const dirty = !file || file.path !== edit.path || draft !== file.content;
    if (dirty && !window.confirm("Discard unsaved edits?")) return;
    const path = edit.path;
    endEdit();
    void loadFile(path);
  };

  const put = async (path: string, content: string, baseHash: string | null) => {
    const r = await fetch("/api/wiki/file", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content, baseHash }),
    });
    return { r, data: await r.json().catch(() => ({})) };
  };

  const save = async (opts: { recreate?: boolean } = {}) => {
    const session = editRef.current;
    if (!session || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const { r, data } = await put(session.path, draft, opts.recreate ? null : session.baseHash);
      if (r.status === 409) {
        if (data.current) {
          setConflict(data.current);
          setNotice({ kind: "warn", text: data.error || "Conflict: the file changed on disk." });
        } else {
          setNotice({ kind: "gone", text: `${data.error || "This file was deleted or moved since you opened it."} Your draft is still here; use Recreate file to save it as ${session.path}.` });
        }
        return;
      }
      if (!r.ok) throw new Error(data.error || "Save failed.");
      editRef.current = null;
      setEdit(null);
      setConflict(null);
      setStashedDraft(null);
      if (session.path === currentRef.current) {
        setFile(data);
        setFileError(null);
      }
      setNotice({ kind: "info", text: opts.recreate ? `Recreated ${session.path}.` : "Saved to the shared wiki file. All Hermes profiles see it on their next read." });
      void pollCatalog();
    } catch (e) {
      setNotice({ kind: "warn", text: e instanceof Error ? e.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  // After a conflict: load the on-disk version into the editor as the new base, and keep the
  // user's draft in a read-only box so they can copy pieces back in.
  const takeTheirs = () => {
    const session = editRef.current;
    if (!conflict || !session) return;
    setStashedDraft(draft);
    setDraft(conflict.content);
    const next = { path: session.path, baseHash: conflict.hash };
    editRef.current = next;
    setEdit(next);
    setFile(conflict);
    setFileError(null);
    setConflict(null);
    setNotice({ kind: "info", text: "Loaded the latest on-disk version. Your previous draft is shown below — copy what you need, then save." });
  };

  const newDailyNote = async () => {
    if (creatingDaily) return;
    if (editRef.current && !window.confirm("Discard unsaved edits?")) return;
    const day = chicagoToday();
    const path = `daily/${day}.md`;
    endEdit();
    if (catalog?.files.some((f) => f.path === path)) {
      go(path, { skipConfirm: true });
      return;
    }
    setCreatingDaily(true);
    try {
      const { r, data } = await put(path, `# ${day}\n`, null);
      // 409 = it already exists (created elsewhere meanwhile): just open it.
      if (!r.ok && r.status !== 409) throw new Error(data.error || "Could not create the daily note.");
      go(path, { skipConfirm: true });
      void pollCatalog();
    } catch (e) {
      setNotice({ kind: "warn", text: e instanceof Error ? e.message : "Could not create the daily note." });
    } finally {
      setCreatingDaily(false);
    }
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
            <button type="button" onClick={() => void newDailyNote()} disabled={creatingDaily} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] disabled:opacity-50">
              <CalendarPlus className="h-3.5 w-3.5" /> {creatingDaily ? "Creating…" : "New daily note"}
            </button>
            {catalogError ? <Pill tone="down">{catalogError}</Pill> : <Pill tone={isVisible ? "up" : "neutral"}>{isVisible ? `Live · checks every ${WIKI_POLL_MS / 1000}s` : "Paused while tab is hidden"}</Pill>}
            {lastCheckedAt !== null && <span>checked {ago(new Date(lastCheckedAt).toISOString())}</span>}
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
                  <span className="truncate font-mono text-[var(--text)]" data-testid="wiki-current-path">{edit ? edit.path : current}</span>
                  {editing && <Pill tone="accent">editing</Pill>}
                  {file && <span className="text-[11px] text-[var(--text-4)]">updated {ago(file.mtime)}</span>}
                  {lastChange && Date.now() - new Date(lastChange).getTime() < 15000 && <Pill tone="accent">changed on disk</Pill>}
                </div>
                {file && !editing && !isReservedWikiPath(file.path) && (
                  <button type="button" onClick={startEdit} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {file && !editing && isReservedWikiPath(file.path) && (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-3)]" title="Long-term memory is only changed by an approved Hermes action. Propose entries in PENDING.md.">
                    <Lock className="h-3.5 w-3.5" /> Read-only (propose changes in PENDING.md)
                  </span>
                )}
                {editing && (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void save()} disabled={saving || !!conflict} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1 text-[11.5px] disabled:opacity-50">
                      <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={cancelEdit} className="btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
                      <X className="h-3.5 w-3.5" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {notice && (
                <div role="status" className={`mb-3 flex items-start gap-2 rounded-[8px] border p-2.5 text-[12px] ${notice.kind !== "info" ? "border-[var(--warn)] text-[var(--warn)]" : "border-[var(--line)] text-[var(--text-2)]"}`}>
                  {notice.kind !== "info" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                  <div className="flex-1">
                    {notice.text}
                    {conflict && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={takeTheirs} className="btn-ghost px-2 py-1 text-[11.5px]">Load latest version (your draft stays visible to copy)</button>
                      </div>
                    )}
                    {notice.kind === "gone" && editing && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => void save({ recreate: true })} disabled={saving} className="btn-ghost px-2 py-1 text-[11.5px] disabled:opacity-50">Recreate file</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {fileError && !editing && (
                <p className="text-[13px] text-[var(--down)]" data-testid="wiki-file-error">
                  {fileError.kind === "notfound" ? <span className="font-semibold">Not found. </span> : null}
                  {fileError.kind === "notfound" ? `${current} does not exist in the wiki.` : fileError.message}
                </p>
              )}

              {editing ? (
                <div className="space-y-3">
                  {conflict && (
                    <div>
                      <div className="eyebrow mb-1">Latest on-disk version (changed by someone else)</div>
                      <pre className="max-h-64 overflow-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface-2)] p-3 font-mono text-[12px] text-[var(--text-2)]">{conflict.content}</pre>
                      <div className="eyebrow mb-1 mt-3">Your draft</div>
                    </div>
                  )}
                  {stashedDraft !== null && (
                    <div className="rounded-[8px] border border-[var(--warn)] p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="eyebrow">Your previous draft (read-only — copy what you need)</div>
                        <button type="button" onClick={() => setStashedDraft(null)} className="btn-ghost px-2 py-0.5 text-[11px]">Dismiss</button>
                      </div>
                      <textarea
                        readOnly
                        value={stashedDraft}
                        aria-label="Your previous draft"
                        rows={10}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full resize-y rounded-[6px] border border-[var(--line)] bg-[var(--surface-2)] p-2 font-mono text-[12px] text-[var(--text-2)] outline-none"
                      />
                      <div className="eyebrow mt-2">Latest version (editable)</div>
                    </div>
                  )}
                  <textarea
                    aria-label={edit ? `Editing ${edit.path}` : "Editor"}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    rows={24}
                    className="w-full resize-y rounded-[8px] border border-[var(--line)] bg-[var(--surface-1)] p-3 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none"
                  />
                  {edit?.path === "PENDING.md" && (
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
