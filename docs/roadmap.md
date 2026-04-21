# Roadmap

## Feature Requests

### Repo readiness

- Verify DB is excluded from version control (`.gitignore`)
- Confirm `data/` directory and schema are fully auto-initialized on first run with no manual steps
- Review README for accuracy and completeness
- Once functionality is stable, do a clean commit

### Demo screenshot regeneration — one command

- Today screenshots require several manual steps: seed the mock DB (`scripts/seed-mock.js`), start the server with `DEMO_MODE=true` on port 3001, run `scripts/screenshot.js`, stop the server.
- Goal: a single `npm run screenshots` (or similar) that seeds, boots the demo server, waits for it to be ready, captures all screenshots, and shuts the server down.
- Should be idempotent and safe to run on a clean checkout. Fail loudly if Playwright isn't installed.
- Follow-up: document the command in `README.md` and reference it from `docs/testing.md` under the demo/mock coverage backlog.

### Top bar — active language indicator

- Show the flag/icon of the currently active Duolingo course in the nav bar
- Source: `user_profile.learning_language` from DB (updated on each sync)

### XP over time — per-language breakdown **[shipped]**

- **Overview page:** daily stacked bar chart (`DailyXpBarChart`) — per-language XP deltas inferred from day-over-day `course_snapshots.xp` diffs. An `_untracked` segment fills the gap between language deltas and `xp_daily.gained_xp` when snapshot coverage is incomplete. Cards sorted: active-in-window first (by window XP desc), then inactive (by total XP desc).
- **History page** (formerly "XP History"): cumulative stacked area chart (`StackedXpChart`). Compact stat cards with period label. Language cards with streak-window dots. "Streak Details" section: selectable time/sessions area chart with per-day background coloring (fire = streak extended, ice = frozen or implied-frozen, gray = no streak). Blue/red dashed reference lines mark known streak start/end dates from `streak_epochs`.
- **Color palette:** alphabetical-by-course-id assignment from the full course list, shared across both pages — a course always maps to the same color.
- **Limitation:** per-language daily XP is an approximation (snapshot deltas, not direct API data). Days with no snapshot for a language show 0 delta regardless of actual practice. Endpoint ③ remains account-wide only.

### Light mode UI

- Add light/dark mode toggle (or system preference detection)
- Currently hard-coded dark (`bg-zinc-950`, `text-zinc-100` throughout)
- Tailwind's `dark:` variant would allow both without a full redesign

### Dev/prod split + logging

- Gate debug/diagnostic features on `NODE_ENV === 'development'` (Next.js sets this automatically)
- Structured logger with `LOG_LEVEL` env var (default `"info"` in prod, `"debug"` in dev)
- Consider `pino` (fast, structured JSON, Next.js-friendly) or a lightweight `console` wrapper with level filtering
- Audit silent `catch {}` blocks in sync/polling — most errors are currently swallowed with no log output in production

### Implement new vocabulary endpoint (learned-lexemes)

- `/vocabulary/overview` is deprecated but **replaced**, not dead
- New endpoint: `POST /2017-06-30/users/{userId}/courses/{langCode}/en/learned-lexemes?sortBy=ALPHABETICAL&startIndex={n}`
- Payload requires `progressedSkills` array sourced from the new path API (`currentCourse.pathSectioned`) — a new API we have not yet accessed
- Returns paginated `learnedLexemes`; field names (word, strength, POS, gender, last_practiced) unconfirmed — needs testing
- Hardcoded `en` as `fromLanguage` in known implementations; may not work for non-English base courses
- High value if it restores vocab strength, POS, gender, and last_practiced data

### Vocabulary word detail — translations on hover/click

- Click or hover a word in the vocab table to see translation, example sentences, notes
- Potential endpoint: `GET /api/1/dictionary_page?lexeme_id={lexeme_id}` — `lexeme_id` is already stored in `vocab_snapshots`
- `d2.duolingo.com/api/1/dictionary/hints/` confirmed dead as of 2022-2023; no confirmed replacement found
- Investigate whether any translation/hints endpoint still works before building UI

### Skill detail drill-down

- Click into a skill to see its words, what was/wasn't practiced, content breakdown
- Script skills should have their own detail view (character/writing system content)
- Goal: surface content for export to external apps (flashcard apps, Anki, etc.)
- Words per skill are already stored in `skill_snapshots.words_json`; need richer per-word data

### Explore unused / undiscovered Duolingo API endpoints

- Audit what endpoints exist but aren't currently used (lexeme, translation, dictionary, hints, path-based APIs, etc.)
- The `currentCourse.pathSectioned` new-path API is already partially identified via the learned-lexemes investigation — may contain richer skill completion data than legacy endpoint
- `strength` and `learned` fields in legacy API may have data for old-path accounts; confirmed 0/false for new-path accounts (like this one). Track whether a new-path alternative exists.
- Potential starting points: `GET /api/1/dictionary_page`, `/words/hints/{from}/{to}`, `currentCourse` fields from `/2017-06-30/users/{userId}`
- Feed findings back into api-map.md

