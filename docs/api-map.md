# Duolingo API — Data Map

## Inputs that flow through the system

```
JWT (env var)
  └─► userId      (decoded from JWT sub claim, numeric)
  └─► username    (fetched from getUser() on first call, then cached)
  └─► activeLanguage  (implicitly set by account state, changed via PATCH)
```

---

## Cross-cutting caveats

- **Unofficial API.** No public docs, no stability guarantees. Everything here was reverse-engineered from web traffic. Individual endpoints can disappear without notice.
- `**2017-06-30`** URL prefix has been stable for years, but that stability is observational — don't treat it as contractual.
- **Rate limiting is CAPTCHA-style** (HTTP **403** with a `blockScript` payload), not classic **429**. The 30-minute baseline XP poll — and the 2-minute fast-mode polls, which only run briefly while the user is active — are chosen to match common community practice and stay well below trigger thresholds.
- **Avatar URLs from endpoint ①** are often protocol-relative (`//…`) and usually need a size suffix (`/xlarge`) to load publicly. Bare avatar URLs frequently **403**.
- **Detailed skill/vocab data follows the active course.** Endpoints ④ and ⑤ implicitly read whichever course is currently active on the account — the only way to read data for a non-active course is to PATCH (⑥) to it first, read, and switch back. This is why `syncAllCourseDetails` exists (see "What requires course switching" below).

---

## Endpoint by endpoint

**① `GET /2017-06-30/users/{userId}?fields=...`** — main user fetch  
*Input:* `userId` from JWT  
*Scope:* **account-wide** — returns all courses at once  
*Returns:* profile, streak, totalXp, xpGoal, gems, lingots, hasPlus, ALL courses (id, title, learningLanguage, fromLanguage, xp, crowns), currentCourseId, `_achievements`  
*Limitation:* `crowns` always 0/stale. `_achievements` may be empty.

**② `GET /2017-06-30/users/{userId}?fields=totalXp*`* — quick XP poll  
*Input:* `userId` from JWT  
*Scope:* account-wide, single field  
*Returns:* just `totalXp` — used only to decide whether a full sync is worth running

**③ `GET /2017-06-30/users/{userId}/xp_summaries?startDate=&endDate=&timezone=*`* — XP history  
*Input:* `userId`, date range (last 1 year), server's local timezone  
*Scope:* **account-wide** — all languages combined into one daily total  
*Returns:* per-day: `gainedXp`, `frozen`, `streakExtended`, `dailyGoalXp`, `numSessions`, `totalSessionTime`  
*Limitation:* no per-language breakdown

**④ `GET /vocabulary/overview*`* — vocab for active course  
*Input:* **none in the URL** — uses active course implicitly from account state  
*Scope:* **one course at a time** (whichever is currently active)  
*Returns:* per-word: `word_string`, `lexeme_id`, `strength_bars`, `skill`, `pos`, `gender`, `last_practiced`  
*Status:* **DEAD** (~2024) — returns HTML redirect

**⑤ `GET /users/{username}*`* — legacy skills  
*Input:* `username` string (not numeric ID) — obtained from endpoint ①  
*Scope:* **one course at a time** — only the active course’s skill tree appears under `language_data`  
*Returns:* `language_data[<key>].skills[]` — per skill: `name`, `id`, `learned`, `strength`, `words[]`, `levels_finished`, `finishedLevels`, `progress_percent`, `coords_x`, `coords_y`, `dependencies[]`; each block also has a `language` field with the learning-language code  
*Key mismatch:* the **top-level object key** for a course is **not always** the same string as `courses[].learningLanguage` from endpoint ① (e.g. Norwegian Bokmål is often `no` here while courses use `nb`; Chinese may use `zs` vs `zh`). This app resolves the correct block via `resolveLegacyLanguageData` / `resolveLegacyLanguageEntry` in `src/lib/legacy-language-data.ts` (aliases, inner `language` match, single-key fallback). In development (`NODE_ENV=development`), `**GET /api/debug*`* exposes `legacyLanguageResolution` per course for inspection.  
*Limitation:* `learned` and `strength` appear to be 0/false for all skills under Duolingo's new path system; `levels_finished` / `finishedLevels` may be the only reliable progress indicator

**⑥ `PATCH /2017-06-30/users/{userId}*`* — switch active course  
*Input:* `userId`, `courseId`, `learningLanguage`, `fromLanguage` — all sourced from endpoint ①  
*Scope:* **account-wide side effect** — changes active course for the real Duolingo account  
*Required because:* endpoints ④ and ⑤ are implicitly scoped to the active course — the only way to read another language's vocab/skills is to switch first  
*Side effect on course ordering:* the switched-to course moves to the top of the user's course-selector (a recency stack). The API-returned `user.courses` array mirrors that selector order. To avoid perturbing it, `syncAllCourseDetails` visits non-active courses in **reverse of `user.courses`** and restores the original active course last — the identity permutation on the stack, so the selector ends the cycle in the same order the user started with

**⑦ `GET /v2/mistakes/users/{userId}/courses/{courseId}/count*`* — mistakes  
*Input:* `userId`, `courseId` (from endpoint ①)  
*Scope:* per-course, **no switching needed**  
*Returns:* integer mistake count for that specific course

**⑧ `POST /2017-06-30/users/{userId}/courses/{langCode}/en/learned-lexemes*`* — vocabulary (new, replaces ④)  
*Input:* `userId`, `langCode`; payload: `{ lastTotalLexemeCount: 0, progressedSkills: [{finishedLevels, finishedSessions, skillId}] }` — skill data sourced from `currentCourse.pathSectioned` (see ⑨)  
*Scope:* active course (same implicit scoping as ④); paginated via `startIndex` query param  
*Returns:* paginated `learnedLexemes[]`; exact field names (word, strength, POS, gender, last_practiced) **unconfirmed** — needs testing  
*Note:* `fromLanguage` hardcoded as `en` in known implementations — may not work for non-English base courses  
*Status:* **active** as of 2024; replaces the dead `/vocabulary/overview`

**⑨ `GET /2017-06-30/users/{userId}?fields=currentCourse*`* — new path-based course data  
*Input:* `userId` from JWT  
*Scope:* account-wide, active course only  
*Returns:* `currentCourse.pathSectioned` — sections containing `completedUnits`, `units[].levels[].pathLevelClientData` with `skillId`, `finishedLevels`, `finishedSessions` per skill  
*Note:* this is Duolingo's new internal path representation; may provide richer skill completion data than the legacy endpoint (⑤) for new-path accounts  
*Status:* active; partially confirmed via community implementations

---

## What requires course switching and why

The coupling between ④/⑤ and ⑥ is the core complexity:

```
To read skills or vocab for language X:
  ⑥ PATCH → switch to X
  ⑤ GET /users/{username} → language_data[<key>] for the active course (see §⑤ key mismatch)
  ④ GET /vocabulary/overview → returns X's vocab (dead)
  ⑥ PATCH → switch back to original
```

This is why `syncAllCourseDetails` exists, and why course cycling carries risk — a mid-sync switch is visible in the real Duolingo app.

---

## Sync operation map


| Operation                                      | Endpoints called       | Switching?                | Data written                                                                                                                    |
| ---------------------------------------------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `quickCheck`                                   | ②                      | No                        | Nothing (read-only)                                                                                                             |
| `fullSync(cycleAll=false)`                     | ①, ③, ⑤, ⑦             | No                        | profile, all course XP snapshots, XP daily history, active course skills+mistakes, achievements, streak epochs, implied freezes |
| `fullSync(cycleAll=true)`                      | ①, ③, ⑤×N, ⑥×2N, ⑦×N   | Yes (N−1 courses)         | same + skills for every course                                                                                                  |
| `syncCourseDetails` (manual per-course button) | ①, ⑤, ⑦, ⑥×2 if needed | Only if not active course | skills+vocab+mistakes for one course                                                                                            |


> Note: endpoint ④ (vocab) is dead so it contributes nothing in practice. Endpoint ⑦ (mistakes) is called from `syncCourseDetails` only — not from the `saveLanguageDetails` path inside `syncAllCourseDetails`, so periodic all-course syncs don't collect mistake counts for non-active courses.

---

## Total XP — two categories of data

**Measured:** `course_snapshots.xp` per language, forward-filled to daily. The sum across all languages at any date D is the best measured estimate of total XP at that date. This is what the cumulative stacked chart uses — the stack top IS the measured total. No reconstruction from `xp_daily` is needed or correct: `xp_daily` only goes back ~1 year and has no valid absolute origin to anchor a cumulative sum.

**Ideal/authoritative:** `profile.total_xp` from endpoint ①. Updates immediately after a session completes, before `xp_summaries` (endpoint ③) catches up. Used as a flat reference ceiling in the stacked chart. Not mixed into the measured curve.

## Per-language daily XP — inferred approximation

Endpoint ③ returns account-wide daily totals only — no per-language breakdown exists in the API. `getCourseXpDailyHistory` approximates daily per-language XP as day-over-day deltas from `course_snapshots.xp`. Key properties of this approximation:

- **Resolution is sync-cadence:** if no sync happened on day D for language L, the delta is 0 regardless of actual practice. Practice data for that day appears in `xp_daily.gained_xp` but not in the per-language bars.
- **`_untracked` segment:** `max(0, xp_daily.gained_xp - sum_of_language_deltas)` per day. Positive when language snapshot coverage is incomplete; zero when deltas account for the full daily total. If `xp_daily` itself lags (e.g. a session completed but `xp_summaries` hasn't updated), the untracked segment may also be zero or smaller than expected — that's correct behavior, not a bug.
- **No mixing of categories:** language deltas (measured from snapshots) and `xp_daily.gained_xp` (authoritative from endpoint ③) are kept separate. The `_untracked` gap is the delta between them, not a synthetic total.

---

## Local SQLite — streak tracking

Two tables maintained locally (no direct Duolingo API equivalent):

**`streak_epochs`** — records each distinct streak start and end as detected by the app. One row per streak epoch.

| Column             | Type    | Notes                                                                      |
| ------------------ | ------- | -------------------------------------------------------------------------- |
| `streak_start_date` | TEXT   | Date the streak started (from `streakData.currentStreak.startDate`)        |
| `streak_end_date`  | TEXT    | Date the streak ended (day before the new streak started); NULL if ongoing |
| `streak_length`    | INTEGER | From `streakData.previousStreak.length` at transition time; NULL if ongoing |
| `detected_at`      | TEXT    | When this epoch was recorded                                               |

`updateStreakEpochs` guards against intra-day syncs (`startDate >= today` → early return). First sync ever inserts the initial epoch. Subsequent syncs that detect a new `startDate` close the old epoch (`streak_end_date = newStart - 1 day`) and open a new one.

**`xp_daily.implied_freeze`** — column added by `migrateStreakTracking`. Set to `1` by `backfillImpliedFreeze` for zero-XP days within the current streak window (`date >= currentStreakStart AND date < DATE('now')`) that are not already marked `frozen` or `streak_extended`. Represents days where a streak shield was inferred to have been used — Duolingo's API doesn't flag these as `frozen` but they occurred within a streak that survived.

`implied_freeze` is used by `DailyMetricChart` for per-day background coloring (ice color) but is **not** included in `XP_STATS_SQL` aggregates — `freeze_days` counts only API-reported `frozen = 1` rows.

## Local SQLite (`xp_daily`)

Synced from endpoint ③. `**XP_STATS_SQL**` in `**src/lib/queries.ts**` (`getXpStats()`, shared with tests) aggregates the **full** table: `**freeze_days`** counts `frozen = 1` including zero-XP rows; `**total_days`** counts rows with `**gained_xp > 0` AND `frozen = 0`**. Validate ambiguous totals against live `**xp_summaries**` payloads when debugging.

---

## Known field reliability issues


| Field                                | Source     | Status                                                        |
| ------------------------------------ | ---------- | ------------------------------------------------------------- |
| `crowns` on courses                  | endpoint ① | Always 0/stale — Duolingo deprecated in 2022-2023 path update |
| `learned` on skills                  | endpoint ⑤ | Appears always `false` under new path system                  |
| `strength` on skills                 | endpoint ⑤ | Appears always `0` under new path system                      |
| `levels_finished` / `finishedLevels` | endpoint ⑤ | Likely still reflects crown levels completed (0–5 per skill)  |
| `_achievements`                      | endpoint ① | May return empty — field reliability unclear post-2024        |
| `vocab_overview`                     | endpoint ④ | **Dead** — returns HTML redirect since ~2024                  |


