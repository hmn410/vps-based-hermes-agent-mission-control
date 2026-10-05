"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Clock, Lightbulb, X, Pencil, Trash2, RotateCcw, Send, ArrowUpRight, Eye } from "lucide-react";
import { ideaDisplayStatus, sendBlocker, type IdeaDisplayStatus } from "@/lib/idea-status";
import { Panel, Pill, Button, Skeleton, EmptyState, rise } from "@/components/ui/kit";

interface Idea {
  id: string;
  title: string;
  description: string;
  source: string;
  category: string;
  estimatedTime: string;
  status: string;
  createdAt?: string;
  timestamp?: string;
  rejectionReason?: string;
  kanbanTaskId?: string | null;
}

type Tone = "neutral" | "up" | "down" | "warn" | "accent";

// Backlog statuses + "Sent" (has a linked kanban task). Legacy approved /
// in-progress / done rows are mapped by ideaDisplayStatus (no DB migration).
const STATUS_CONFIG: Record<IdeaDisplayStatus, { label: string; tone: Tone }> = {
  new:         { label: "New",         tone: "accent" },
  considering: { label: "Considering", tone: "warn" },
  sent:        { label: "Sent",        tone: "up" },
  rejected:    { label: "Rejected",    tone: "down" },
};
const CATEGORY_CONFIG: Record<string, { label: string }> = {
  build:      { label: "Build" },
  content:    { label: "Content" },
  feature:    { label: "Feature" },
  thread:     { label: "Thread" },
  experiment: { label: "Experiment" },
};

const inputCls =
  "w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-[var(--r-sm)] px-4 py-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--line-strong)] transition-colors";

function formatDate(dateStr?: string) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return ""; }
}

function IdeaCard({ idea, onUpdate }: { idea: Idea; onUpdate: () => void }) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [edit, setEdit] = useState({ title: idea.title, description: idea.description, category: idea.category || "build" });
  const [busy, setBusy] = useState(false);

  const status = ideaDisplayStatus(idea);
  const statusConf = STATUS_CONFIG[status];
  const catConf = CATEGORY_CONFIG[idea.category] || { label: idea.category || "other" };
  const date = idea.createdAt || idea.timestamp || "";
  const isDead = status === "rejected";
  const isSent = status === "sent";
  const blocker = sendBlocker(idea);

  const updateIdea = async (updates: Partial<Idea>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idea.id, ...updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error || "Couldn't update this idea.");
        return;
      }
      onUpdate();
    } finally {
      setBusy(false);
    }
  };

  const sendToHermes = async () => {
    if (blocker) { window.alert(blocker); return; }
    if (!window.confirm(`Send "${idea.title}" to Hermes? This creates a kanban task.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ideas/${encodeURIComponent(idea.id)}/send`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error || "Couldn't send this idea to Hermes.");
        return;
      }
      onUpdate();
    } finally {
      setBusy(false);
    }
  };

  const deleteIdea = async () => {
    if (!window.confirm(`Delete "${idea.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await fetch("/api/ideas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idea.id }),
      });
      onUpdate();
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    await updateIdea({ status: "rejected", rejectionReason: rejectReason.trim() });
    setIsRejecting(false);
    setRejectReason("");
  };

  const startEdit = () => {
    setEdit({ title: idea.title, description: idea.description, category: idea.category || "build" });
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!edit.title.trim() || !edit.description.trim()) return;
    await updateIdea({ title: edit.title.trim(), description: edit.description.trim(), category: edit.category });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Panel className="p-5">
        <span className="eyebrow">Edit Idea</span>
        <div className="space-y-3 mt-3">
          <input
            type="text"
            value={edit.title}
            onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            className={inputCls}
            placeholder="Idea title"
            autoFocus
          />
          <textarea
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            className={`${inputCls} resize-none`}
            placeholder="Describe the idea"
            rows={4}
          />
          <select
            value={edit.category}
            onChange={(e) => setEdit({ ...edit, category: e.target.value })}
            className="w-full bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
          >
            <option value="build">Build</option>
            <option value="content">Content</option>
            <option value="feature">Feature</option>
            <option value="thread">Thread</option>
            <option value="experiment">Experiment</option>
          </select>
          <div className="flex gap-2 pt-1">
            <Button variant="primary" size="sm" onClick={saveEdit} disabled={busy || !edit.title.trim() || !edit.description.trim()}>
              {busy ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>Cancel</Button>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      className={`p-5 ${isDead ? "opacity-55 hover:opacity-80 transition-opacity" : ""}`}
      style={isSent ? { borderColor: "color-mix(in srgb, var(--up) 28%, transparent)" } : undefined}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={statusConf.tone}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "currentColor" }} />
            {statusConf.label}
          </Pill>
          <Pill tone="neutral">{catConf.label}</Pill>
        </div>
        <div className="flex items-center gap-3 text-[11px] num text-[var(--text-4)] shrink-0">
          {date && <span>{formatDate(date)}</span>}
          {idea.estimatedTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {idea.estimatedTime}
            </span>
          )}
        </div>
      </div>

      {/* Title + description */}
      <h3 className="text-[14px] font-semibold text-[var(--text)] mb-1.5 leading-snug">{idea.title}</h3>
      <p className="text-[var(--text-2)] text-[13px] leading-relaxed mb-4 whitespace-pre-wrap">{idea.description}</p>

      {/* Rejection reason */}
      {status === "rejected" && idea.rejectionReason && (
        <div
          className="rounded-[var(--r-sm)] px-3 py-2 mb-4"
          style={{
            background: "color-mix(in srgb, var(--down) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--down) 22%, transparent)",
          }}
        >
          <p className="text-[12px]" style={{ color: "var(--down)" }}>
            <span className="font-medium">Rejected:</span> {idea.rejectionReason}
          </p>
        </div>
      )}

      {/* Source */}
      {idea.source && idea.source !== "manual" && (
        <p className="text-[var(--text-4)] text-[11px] num mb-3">via {idea.source}</p>
      )}

      {/* Actions */}
      {!isRejecting && (
        <div className="flex items-center gap-2 flex-wrap">
          {isSent && idea.kanbanTaskId && (
            <a
              href={`/tasks?task=${encodeURIComponent(idea.kanbanTaskId)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors"
              style={{ color: "var(--up)", borderColor: "color-mix(in srgb, var(--up) 24%, transparent)" }}
            >
              Sent <ArrowUpRight className="w-3 h-3" /> <span className="num">{idea.kanbanTaskId}</span>
            </a>
          )}

          {(status === "new" || status === "considering") && (
            <>
              <button
                onClick={sendToHermes}
                disabled={busy}
                title={blocker ?? "Create a kanban task for this idea"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40"
                style={{ color: "var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 24%, transparent)" }}
              >
                <Send className="w-3 h-3" />
                Send to Hermes
              </button>
              {status === "new" && (
                <button
                  onClick={() => updateIdea({ status: "considering" })}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40"
                  style={{ color: "var(--warn)", borderColor: "color-mix(in srgb, var(--warn) 24%, transparent)" }}
                >
                  <Eye className="w-3 h-3" />
                  Consider
                </button>
              )}
              <button
                onClick={() => setIsRejecting(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40"
                style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 24%, transparent)" }}
              >
                <X className="w-3 h-3" />
                Reject
              </button>
            </>
          )}

          {isDead && (
            <button
              onClick={() => updateIdea({ status: "considering" })}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 text-[var(--text-3)] border-[var(--line)] hover:text-[var(--text)] hover:border-[var(--line-strong)]"
            >
              <RotateCcw className="w-3 h-3" />
              Reopen
            </button>
          )}

          {/* Always-available: edit + delete */}
          <button
            onClick={startEdit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 text-[var(--text-3)] border-[var(--line)] hover:text-[var(--text)] hover:border-[var(--line-strong)]"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={deleteIdea}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 ml-auto"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 24%, transparent)" }}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>
        </div>
      )}

      {/* Reject input */}
      {isRejecting && (
        <div className="flex gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReject()}
            placeholder="Why reject? (helps Hermes learn)"
            className="flex-1 bg-[var(--surface-2)] border rounded-full px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none transition-colors"
            style={{ borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
            autoFocus
          />
          <button
            onClick={handleReject}
            disabled={!rejectReason.trim()}
            className="px-3 py-2 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: "var(--down)", borderColor: "color-mix(in srgb, var(--down) 28%, transparent)" }}
          >
            Reject
          </button>
          <button
            onClick={() => { setIsRejecting(false); setRejectReason(""); }}
            className="px-3 py-2 rounded-full text-[12px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </Panel>
  );
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [newIdea, setNewIdea] = useState({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
  const [submitting, setSubmitting] = useState(false);

  const fetchIdeas = useCallback(async () => {
    try {
      const res = await fetch("/api/ideas");
      const data = await res.json();
      setIdeas(data);
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdea.title.trim() || !newIdea.description.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newIdea, createdAt: new Date().toISOString() }),
      });
      await fetchIdeas();
      setNewIdea({ title: "", description: "", source: "manual", category: "build", estimatedTime: "1 hour", status: "new" });
      setShowForm(false);
    } catch { /* noop */ } finally { setSubmitting(false); }
  };

  const sorted = [...ideas].sort((a, b) => {
    const da = a.createdAt || a.timestamp || "";
    const db = b.createdAt || b.timestamp || "";
    return db.localeCompare(da);
  });

  const filtered = sorted.filter((idea) => {
    const s = ideaDisplayStatus(idea);
    if (statusFilter === "active" && (s === "rejected" || s === "sent")) return false;
    if (statusFilter !== "active" && statusFilter !== "all" && s !== statusFilter) return false;
    if (categoryFilter !== "all" && (idea.category || "") !== categoryFilter) return false;
    return true;
  });

  const uniqueCategories = [...new Set(ideas.map(i => i.category).filter(Boolean))];

  const countOf = (st: IdeaDisplayStatus) => ideas.filter((i) => ideaDisplayStatus(i) === st).length;
  const statusTabs = [
    { key: "active", label: "Backlog", count: countOf("new") + countOf("considering") },
    { key: "new", label: "New", count: countOf("new") },
    { key: "considering", label: "Considering", count: countOf("considering") },
    { key: "sent", label: "Sent", count: countOf("sent") },
    { key: "rejected", label: "Rejected", count: countOf("rejected") },
    { key: "all", label: "All", count: ideas.length },
  ];

  if (loading) {
    return (
      <div className="w-full mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-32" />
          </div>
          <Skeleton className="h-9 w-28 !rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="panel p-5 space-y-3">
              <div className="flex gap-2"><Skeleton className="h-5 w-16 !rounded-full" /><Skeleton className="h-5 w-14 !rounded-full" /></div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto p-6 pb-16">
      {/* Header */}
      <div className="hq-rise flex items-end justify-between gap-4 pt-2 pb-8" style={rise(0)}>
        <div>
          <div className="eyebrow mb-2.5 flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" />
            Idea board
          </div>
          <h1 className="text-[32px] font-semibold tracking-[-0.025em] leading-none text-[var(--text)]">Ideas</h1>
          <p className="num text-[var(--text-4)] text-[12px] mt-3">{filtered.length} showing · {ideas.length} total</p>
        </div>
        <Button
          variant={showForm ? "ghost" : "primary"}
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancel" : "Add Idea"}
        </Button>
      </div>

      {/* Add Idea Form */}
      {showForm && (
        <div className="hq-rise panel p-6 mb-8" style={rise(1)}>
          <span className="eyebrow">New Idea</span>
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <input
              type="text"
              value={newIdea.title}
              onChange={(e) => setNewIdea({ ...newIdea, title: e.target.value })}
              className={inputCls}
              placeholder="Idea title *"
              required
            />
            <textarea
              value={newIdea.description}
              onChange={(e) => setNewIdea({ ...newIdea, description: e.target.value })}
              className={`${inputCls} resize-none`}
              placeholder="Describe the idea *"
              rows={3}
              required
            />
            <div className="flex gap-3">
              <select
                value={newIdea.category}
                onChange={(e) => setNewIdea({ ...newIdea, category: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="build">Build</option>
                <option value="content">Content</option>
                <option value="feature">Feature</option>
                <option value="thread">Thread</option>
                <option value="experiment">Experiment</option>
              </select>
              <select
                value={newIdea.estimatedTime}
                onChange={(e) => setNewIdea({ ...newIdea, estimatedTime: e.target.value })}
                className="flex-1 bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-2)] px-3 py-2.5 rounded-[var(--r-sm)] text-[13px] focus:outline-none focus:border-[var(--line-strong)]"
              >
                <option value="30 minutes">30 min</option>
                <option value="1 hour">1 hour</option>
                <option value="2 hours">2 hours</option>
                <option value="3 hours">3 hours</option>
                <option value="Half day">Half day</option>
                <option value="Full day">Full day</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !newIdea.title.trim() || !newIdea.description.trim()}
              >
                {submitting ? "Adding..." : "Add Idea"}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 border ${
              statusFilter === tab.key
                ? "bg-[var(--surface-2)] text-[var(--text)] border-[var(--line-strong)]"
                : "text-[var(--text-3)] hover:text-[var(--text)] border-[var(--line)] hover:border-[var(--line-strong)]"
            }`}
          >
            {tab.label}
            <span className="num text-[10px] text-[var(--text-4)]">{tab.count}</span>
          </button>
        ))}
        {uniqueCategories.length > 0 && (
          <>
            <div className="w-px h-4 bg-[var(--line)] mx-1" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent border border-[var(--line)] text-[var(--text-2)] px-3 py-1.5 rounded-full text-[12px] focus:outline-none focus:border-[var(--line-strong)]"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Ideas grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} onUpdate={fetchIdeas} />
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="panel">
          <EmptyState
            icon={<Lightbulb className="w-8 h-8" />}
            title="No ideas found"
            hint={statusFilter !== "all" ? "Try adjusting your filters" : "Add your first idea to get started"}
          />
        </div>
      )}
    </div>
  );
}
