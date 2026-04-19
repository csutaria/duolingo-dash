<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Verification

Do not treat the local codebase, comments, or prior chat as the source of truth for product or API behavior. **Never rely only on local assumptions** for how external systems (e.g. Duolingo) work. When behavior matters, confirm with public documentation, live API responses, or other verifiable evidence, and state what was verified vs. what is still uncertain.

**`docs/api-map.md`** maps Duolingo endpoints to this app (legacy `language_data` key resolution, local `xp_daily` aggregates, sync behavior).

**`README.md`** — setup, testing, polling, user-facing API limitations — keep in sync when behavior changes for end users.
