

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.



## Docs layout

Repo-root Markdown files (`README.md`, `TESTING.md`, `CLAUDE.md`, `AGENTS.md`) are for **users and agents orienting to the project** — setup, how to run things, where to look. Keep them short and scannable.

`docs/` is for **contributors** — design decisions, architecture, implementation details, API gotchas, test backlog. Depth goes here, not in the root.

When adding or moving content, pick the audience first. User-visible behavior → root. Internals → `docs/`.

## Verification

Do not treat the local codebase, comments, or prior chat as the source of truth for product or API behavior. **Never rely only on local assumptions** for how external systems (e.g. Duolingo) work. When behavior matters, confirm with public documentation, live API responses, or other verifiable evidence, and state what was verified vs. what is still uncertain.

`**docs/api-map.md`** — Duolingo endpoints ↔ this app (legacy `language_data` key resolution, local `xp_daily` aggregates, sync behavior, cross-cutting API caveats). Keep in sync when Duolingo API understanding changes.

`**docs/architecture.md**` — runtime structure: polling cadence, pause semantics, sync pipeline, `sync_log` schema, internal API routes. Keep in sync when server-side behavior changes.

`**README.md**` — setup and user-visible behavior (run commands, course-cycling disruption, pause, progress bar). Keep in sync when anything a first-time user sees changes.

`**TESTING.md**` + `**docs/testing.md**` — how to run tests / coverage + backlog. Update the latter whenever a test lands or a new gap is found.