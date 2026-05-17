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
  - *What the client does today:* `DuolingoClient.request` in `src/lib/duolingo.ts` only special-cases `401` and `429`. A CAPTCHA-style `403` falls through to the generic `Duolingo API error: 403 …` branch — no dedicated detection or backoff. Adding 403/`blockScript` handling is a known gap, not a shipped feature.
- **Avatar URLs from endpoint ①** are often protocol-relative (`//…`) and usually need a size suffix (`/xlarge`) to load publicly. Bare avatar URLs frequently **403**.
- **Detailed skill/vocab data follows the active course.** Endpoints ④ and ⑤ implicitly read whichever course is currently active on the account — the only way to read data for a non-active course is to PATCH (⑥) to it first, read, and switch back. This is why `syncAllCourseDetails` exists (see "What requires course switching" below).

---

## Endpoint by endpoint

**① `GET /2017-06-30/users/{userId}?fields=...`** — main user fetch  
*Input:* `userId` from JWT  
*Scope:* **account-wide** — returns all courses at once  
*Returns:* profile, streak, totalXp, xpGoal, gems, lingots, hasPlus, `timezone` (IANA zone when present), ALL courses (id, title, learningLanguage, fromLanguage, xp, crowns), currentCourseId, `_achievements` — we request `timezone` in `USER_FIELDS` and persist it to `user_profile.timezone` for **R** (after `DUOLINGO_TZ`, before host `Intl`).  
*Limitation:* `crowns` always 0/stale. `_achievements` may be empty.

**② `GET /2017-06-30/users/{userId}?fields=totalXp*`* — quick XP poll  
*Input:* `userId` from JWT  
*Scope:* account-wide, single field  
*Returns:* just `totalXp` — used only to decide whether a full sync is worth running

**③ `GET /2017-06-30/users/{userId}/xp_summaries?startDate=&endDate=&timezone=*`* — XP history  
*Input:* `userId`, date range (last 1 year), resolved app timezone (**R**, not necessarily host timezone)  
*Scope:* **account-wide** — all languages combined into one daily total  
*Returns:* per-day: `gainedXp`, `frozen`, `streakExtended`, `dailyGoalXp`, `numSessions`, `totalSessionTime`  
*Limitation:* no per-language breakdown  
*Wire encoding (`summaries[].date`):* a **calendar-day label**, encoded as `Date.UTC(year, month, day)` — i.e. midnight UTC of that day, **regardless of the `timezone` query param**. Verified by hitting the endpoint with `=America/Los_Angeles`, `=UTC`, and `=Asia/Kolkata` for the same user/window: the `date` field is byte-for-byte identical across all three. The `timezone` param controls which days are *included* in the response (Duolingo buckets sessions server-side using their stored profile zone), not the wire encoding. We therefore read `s.date * 1000` as a UTC calendar date when persisting `xp_daily.date` (`src/lib/sync.ts` § `saveXpHistory`); reading it through R shifts the label backward by one day for any negative-offset zone.

Deployment note: `R` is still relevant for this endpoint because we pass it as the `timezone` query param to keep the response window aligned with the user's calendar. If `DUOLINGO_TZ` is unset and Duolingo has not yet returned `timezone` (so `user_profile.timezone` is empty) and there is no UI override, `R` falls through to host `Intl`; on a UTC host the request window will use UTC days, which may include or exclude an extra session at the edges. Set `DUOLINGO_TZ` (or use the SyncBar override) for user-local semantics before the first profile sync. Bucketing of stored rows is unaffected — `xp_daily.date` is keyed off the wire label, not `R`.

**④ `GET /vocabulary/overview*`* — vocab for active course  
*Input:* **none in the URL** — uses active course implicitly from account state  
*Scope:* **one course at a time** (whichever is currently active)  
*Returns:* per-word: `word_string`, `lexeme_id`, `strength_bars`, `skill`, `pos`, `gender`, `last_practiced`  
*Status:* **DEAD** (~2024) — returns HTML redirect  
*Implementation today:* `client.getVocabulary()` in `src/lib/duolingo.ts` still issues this request; the JSON content-type guard throws on the HTML redirect and the caller's silent `catch` falls through. The call is harmless (one wasted request per sync) but has not been removed pending ⑧.

**⑤ `GET /users/{username}*`* — legacy skills  
*Input:* `username` string (not numeric ID) — obtained from endpoint ①  
*Scope:* **one course at a time** — only the active course’s skill tree appears under `language_data`  
*Returns:* `language_data[<key>].skills[]` — per skill, when present: `name`, `id`, `learned`, `strength`, `words[]`, `levels_finished`, `finishedLevels`, `progress_percent`, `coords_x`, `coords_y`, `dependencies[]`; each block also has a `language` field with the learning-language code
*Key mismatch:* the **top-level object key** for a course is **not always** the same string as `courses[].learningLanguage` from endpoint ① (e.g. Norwegian Bokmål is often `no` here while courses use `nb`; Chinese may use `zs` vs `zh`). This app resolves the correct block via `resolveLegacyLanguageData` / `resolveLegacyLanguageEntry` in `src/lib/legacy-language-data.ts` (aliases, inner `language` match, single-key fallback). In development (`NODE_ENV=development`), `**GET /api/debug*`* exposes `legacyLanguageResolution` per course for inspection.  
*Limitation:* this is an opportunistic word-map source, not a reliable progress source. `skills[]` may be empty for path-era courses; `learned`, `strength`, and legacy progress fields can be stale or zero.

**⑥ `PATCH /2017-06-30/users/{userId}*`* — switch active course  
*Input:* `userId`, `courseId`, `learningLanguage`, `fromLanguage` — all sourced from endpoint ①  
*Scope:* **account-wide side effect** — changes active course for the real Duolingo account  
*Required because:* endpoints ④ and ⑤ are implicitly scoped to the active course — the only way to read another language's vocab/skills is to switch first  
*Side effect on course ordering:* the switched-to course moves to the top of the user's course-selector (a recency stack). The API-returned `user.courses` array mirrors that selector order. To avoid perturbing it, `syncAllCourseDetails` visits non-active courses in **reverse of the target selector order** and restores the original active course last — the identity permutation on the stack, so the selector ends the cycle in the same order the user started with. Automatic conflict recovery uses the pre-conflict target order if the course set still matches.

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
*Implementation today:* **not wired.** No method on `DuolingoClient` calls this endpoint yet; tracked in `docs/roadmap.md` § "Implement new vocabulary endpoint (learned-lexemes)".

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


| Operation                                      | Endpoints called             | Switching?                | Data written                                                                                                                    |
| ---------------------------------------------- | ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `quickCheck`                                   | ②                            | No                        | Nothing (read-only)                                                                                                             |
| `fullSync(cycleAll=false)`                     | ①, ③, ④, ⑤, ⑦, ⑨             | No                        | profile, all course XP snapshots, XP daily history, active course skills+mistakes, achievements, streak epochs, implied freezes |
| `fullSync(cycleAll=true)`                      | ①, ③, (④, ⑤, ⑦, ⑨)×N, ⑥×2(N−1), extra ① course-restore checks | Yes (N−1 courses) | same + skills+mistakes for every course                                                                                         |
| `syncCourseDetails` (manual per-course button) | ①, ④, ⑤, ⑦, ⑨, ⑥×2 if needed, extra ① restore checks if switched | Only if not active course | skills+vocab+mistakes for one course                                                                                            |


> Notes:
> - Endpoint ④ (vocab) is dead. The request is still issued by `saveLanguageDetails` and `syncCourseDetails` but always errors out at the JSON content-type check — see ④ "Implementation today" above.
> - Endpoint ⑦ (mistakes) is called for every course visited by `saveLanguageDetails`, including the per-course visits inside `syncAllCourseDetails`, so all-course cycle syncs **do** collect mistake counts for non-active courses (this contradicts an earlier note that's been removed).
> - Endpoint ⑨ (`pathSectioned`) is fetched once per course-detail skill snapshot (`saveLanguageDetails` and `syncCourseDetails`) and used as the preferred skill status source. If endpoint ⑤ returns no skills, the app reuses the latest stored skill word map and refreshes status from endpoint ⑨.
> - Course-cycling syncs re-read endpoint ① around switch/fetch/restore steps and before/after active-course-dependent detail fetches. If the account's active course or total XP changes outside Dash's expected sequence, the sync aborts with `Active course changed outside this sync` or `XP changed outside this sync`, stops switching, and does not restore over another actor's course inline after drift. Automatic polling keeps the pre-cycle selector order from the interrupted sync and retries that order-preserving cycle after account quiet/backoff, as long as the current course set is compatible. Clean course details are written from an in-memory draft; drift-tainted course details are skipped. The Redis/Valkey account lock is still the hard cross-server guard.

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

**`xp_daily.implied_freeze`** — column added by `migrateStreakTracking`. Set to `1` by `backfillImpliedFreeze` for zero-XP days within the current streak window (`date >= currentStreakStart AND date < LOCAL_DATE(datetime('now'))`) that are not already marked `frozen` or `streak_extended`. Represents days where a streak shield was inferred to have been used — Duolingo's API doesn't flag these as `frozen` but they occurred within a streak that survived.

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
| `levels_finished` / `finishedLevels` | endpoint ⑤ | Legacy field can be stale/zero under the path system; this app prefers endpoint ⑨ path-derived status when available |
| `_achievements`                      | endpoint ① | May return empty — field reliability unclear post-2024        |
| `vocab_overview`                     | endpoint ④ | **Dead** — returns HTML redirect since ~2024                  |
