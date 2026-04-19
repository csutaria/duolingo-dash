# Roadmap

## Feature Requests

### Repo readiness

- Verify DB is excluded from version control (`.gitignore`)
- Confirm `data/` directory and schema are fully auto-initialized on first run with no manual steps
- Review README for accuracy and completeness
- Once functionality is stable, do a clean commit

### Top bar — active language indicator

- Show the flag/icon of the currently active Duolingo course in the nav bar
- Source: `user_profile.learning_language` from DB (updated on each sync)

### XP over time — per-language breakdown

- **Chart:** stacked area chart showing XP contribution per language over time (currently all languages are summed into one daily total)
- **Incremental XP list:** tag each XP entry with the language it came from
- **Blocker:** Duolingo's XP summaries API (endpoint ③) returns account-wide daily totals with no per-language breakdown. This may require inferring language from course XP deltas between snapshots (coarse), or finding an alternative endpoint
- See [api-map.md](api-map.md) for endpoint details

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