@AGENTS.md

**Where to look:** user setup, test commands, polling — **`README.md`**. Endpoint ↔ storage map — **`docs/api-map.md`**. Verifying external API behavior — **`AGENTS.md`** (Verification).

## Build & Test

```bash
npm run dev          # Start dev server
npm run build        # Production build (includes type checking)
npm test             # Run all tests
npx jest --watch     # Watch mode
npx jest <name>      # Run specific test file
```

## Architecture

- Next.js App Router with server-side API routes
- SQLite (better-sqlite3) for historical snapshots — `data/duolingo.db`
- All Duolingo API calls go through `src/lib/duolingo.ts` — single client module
- JWT stored in server process memory only, passed via `DUOLINGO_JWT` env var
- `serverExternalPackages: ["better-sqlite3"]` in next.config.ts

## Duolingo API Caveats

- **Unofficial API** — no docs, no guarantees. Reverse-engineered from web traffic.
- The `2017-06-30` versioned path is stable but endpoints can be removed without notice.
- `/vocabulary/overview` is dead (~2024). Vocab is extracted from skill word lists via the legacy endpoint.
- Legacy `/users/{username}` requires **username**, not numeric user ID. Legacy **`language_data`** keys may not match **`courses[].learningLanguage`** — skill sync uses **`src/lib/legacy-language-data.ts`**; semantics in **`docs/api-map.md`** (§⑤, Local SQLite).
- Duolingo avatar URLs need a size suffix (`/xlarge`) to be publicly accessible. Base URLs return 403.
- XP summary entries from the API can have null fields — always default to safe values before DB insert.
- Course switching (`PATCH /users/{id}`) is **account-wide** — it changes the user's active language in the real Duolingo app.
- Rate limiting is CAPTCHA-based (403 + `blockScript`), not 429.
