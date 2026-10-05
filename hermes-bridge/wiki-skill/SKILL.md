---
name: hermes-wiki
description: "Use when reading or updating the shared Hermes wiki. One canonical path for all profiles."
version: 2.0.0
metadata:
  hermes:
    tags: [wiki, documentation, memory, pending, daily-notes]
---

# Hermes Wiki (shared, canonical)

> Source of truth for this skill: `hermy-hq/hermes-bridge/wiki-skill/SKILL.md`.
> Installed copies live at `<profile>/skills/note-taking/hermes-wiki/SKILL.md`.

The one documentation wiki for **every** Hermes profile (default, builder, ops,
personal, seocontent) and for Hermy HQ's `/wiki` page lives at:

```
/opt/data/home/.hermes/wiki/
```

Always use this absolute path. Never use `~/wiki`, `~/.hermes/wiki`, `$HOME/...`
or `$WIKI_PATH`: in non-default profiles those resolve to a per-profile copy
that nobody else sees. Never create a second wiki anywhere.

## Layout (don't invent new top-level folders without recording why in INDEX.md)

- `INDEX.md`: catalog of durable records. Start here when you don't know the record.
- `standing-instructions.md`: operating rules and precedence.
- `PENDING.md`: the **only** queue for proposed `MEMORY.md` / `USER.md` entries.
- `projects/specs-and-decisions.md`: project scope, decisions, rationale (dated `###` entries).
- `daily/YYYY-MM-DD.md`: dated work log (America/Chicago date). Append; don't rewrite others' entries.
- `preferences/`: durable operator preferences and operating models.

## Workflow

1. **Session start:** read `PENDING.md`; report how many proposals await Josh's
   approval with a one-line summary each, or say the queue is empty.
2. **Before work:** open the relevant record (via `INDEX.md`).
3. **Before finishing:** record decisions in `projects/specs-and-decisions.md`,
   log the work in today's `daily/` note, and add any new durable record to `INDEX.md`.
4. **Re-read a file right before editing it.** Other profiles and Hermy HQ write
   the same files; use a targeted patch, never overwrite a whole file from a stale copy.

## Long-term memory rule

Never write `MEMORY.md` / `USER.md` directly from wiki work. Add a proposal to
`PENDING.md` (target, exact text, rationale, source link, `Status: pending`).
Nothing is promoted until Josh approves that exact entry.

## Hygiene check (when asked, or after large edits)

- Every relative link resolves (ignore links inside fenced code blocks).
- Every durable record is listed in `INDEX.md`; no orphans.
- Markdown (`.md`) files only; no secrets, credentials, or tokens in the wiki.

The wiki is not a git repo; there is no commit step and no consolidation cron.
