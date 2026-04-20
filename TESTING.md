# Testing

For users running the test suite. For contributors writing or planning tests, see `**docs/testing.md**`.

## Run

```bash
npm test                 # Run everything
npx jest --watch         # Watch mode
npx jest <name>          # Run a specific file (e.g. npx jest db)
npx jest --coverage      # Coverage report
```

No setup beyond `npm install`. Tests use an in-memory SQLite DB and do not touch `data/duolingo.db` or reach duolingo.com.

## What's covered at a glance

- Duolingo client: JWT parsing, API error handling, legacy endpoint URL construction.
- Database: schema constraints, upserts, `first_seen` preservation, vocab-from-skills fallback.
- Queries: XP stats aggregation, vocab/skill decay detection, course comparison.
- Sync: null-safe XP summary mapping, avatar URL handling, legacy `language_data` key resolution.
- Polling: manual-refresh cooldown, XP change detection, first-sync trigger.
- Classification: writing system / script skills, language names + flags.

Full list, invariants, and planned work: `**docs/testing.md**`.

## Tests fail after `git pull`?

- `npm install` if dependencies changed.
- Delete any stray `data/*.db-journal` / `data/*.db-wal` leftover from an interrupted dev run — tests do not read from `data/`, but file-permission issues there can still surface noisy output.

