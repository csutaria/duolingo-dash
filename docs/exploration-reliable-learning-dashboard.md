# Exploration: Reliable Learning Dashboard Direction

## Scope and constraints

- This document is exploration-only (no implementation commitments).
- Reliability policy is strict:
  - do not show unclear or made-up metrics;
  - derived metrics are allowed only from reliable inputs;
  - if reliability is unknown, omit the metric.
- Product goals in scope:
  - retention/review support,
  - cross-language planning (for Duolingo learning and beyond),
  - transfer to real content.

## Evidence reviewed

- Current code/data behavior:
  - `src/lib/duolingo.ts`
  - `src/lib/sync.ts`
  - `src/lib/polling.ts`
  - `src/lib/queries.ts`
  - `src/lib/db.ts`
  - `src/app/api/data/route.ts`
  - `src/app/vocab/page.tsx`
  - `src/app/course/[courseId]/page.tsx`
- Existing project docs:
  - `docs/api-map.md`
  - `docs/roadmap.md`
  - `README.md`
- External source checks (high level):
  - Tatoeba API root/docs: [api.tatoeba.org](https://api.tatoeba.org/)
  - MediaWiki/Wiktionary API help: [en.wiktionary.org/w/api.php](https://en.wiktionary.org/w/api.php?action=help&modules=query&format=json)
  - Anki export docs: [docs.ankiweb.net/exporting.html](https://docs.ankiweb.net/exporting.html)

## 1) Capability audit (Duolingo-centric)

Legend:

- `Reliable`: supports strict metric use.
- `Partial`: usable only with caveats; not strict for primary metrics.
- `Unavailable`: no reliable direct support from current known sources.


| Desired metric                                 | Current capability status               | Why                                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learned words list per language                | Partial                                 | Current app path uses `vocab_snapshots` or unfiltered skill `words_json`; this is not strict learned-vocab semantics today. `docs/api-map.md` points to learned-lexemes replacement but it is not implemented/verified here. |
| Total possible words per language              | Partial                                 | Skill word lists can approximate inventory, but may represent curriculum buckets and may duplicate/over-include relative to user-known set.                                                                                  |
| Learned / total per language                   | Unavailable (strict)                    | Numerator and denominator both require stronger semantics than current pipeline provides.                                                                                                                                    |
| Learned per skill                              | Partial                                 | `levels_finished` appears usable as progress proxy; `learned` and `strength` are documented as unreliable on new path accounts.                                                                                              |
| Time log of learned words (exact timestamp)    | Unavailable                             | Current storage offers `first_seen` (snapshot insertion time), not authoritative learned-at time.                                                                                                                            |
| "Words learned in last X" per language         | Unavailable (exact), Partial (windowed) | Exact learned time not available; only snapshot-window inference can be computed.                                                                                                                                            |
| Global cross-language recency ordering         | Unavailable (exact), Partial (windowed) | Requires exact learned time across courses; current model is snapshot-based and active-course-coupled.                                                                                                                       |
| Cross-language planning (XP/streak/time trend) | Reliable for broad trends               | Account-wide XP history and per-course XP snapshots exist; granularity is coarse but stable for planning.                                                                                                                    |
| Retention/review triggers                      | Partial                                 | Decay-like views can be built from repeated snapshots; validity depends on quality of per-word/per-skill inputs.                                                                                                             |
| "Transfer to real content" recommendations     | Partial                                 | Needs external lexical/content sources to become reliable and useful.                                                                                                                                                        |


### Hard constraints from current architecture

- Active-course coupling is structural:
  - vocab/legacy skill detail retrieval is course-context dependent and tied to switching (`docs/api-map.md`, `src/lib/sync.ts`).
- Polling currently uses all-course syncing with account-wide course switching:
  - `src/lib/polling.ts` calls `fullSync(client, true)` on XP change and on 3-hour schedule.
- Current vocab read path conflates "known" with "available":
  - `getVocabLatest()` falls back to `getVocabFromSkills()` (unfiltered curriculum words) in `src/lib/queries.ts`.

## 2) Alternative data source audit

Goal of this section: options that can improve usefulness without inventing metrics.


| Source class                                    | Relevance to goals                                                | Reliability notes                                                               | Policy/maintenance notes                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Duolingo unofficial endpoints only              | Core for native progress                                          | Endpoint churn risk; some fields already dead/unreliable (`docs/api-map.md`).   | Medium-high maintenance; account-side effects for multi-course detail sync.   |
| Tatoeba API                                     | Good for transfer-to-real-content (example sentences by language) | Public API with docs and search/download examples.                              | Low-medium maintenance; does not solve "learned timestamp" directly.          |
| Wiktionary/MediaWiki API                        | Good for lexical enrichment (definitions, POS, forms)             | Well-documented query API; stable ecosystem.                                    | Medium data-normalization work across languages/entries.                      |
| Anki imports (.apkg/.colpkg/plain text exports) | Strong for external learning continuity and augmentation          | Export formats are documented at user level; note parsing/normalization effort. | Medium integration complexity; very useful for outside-Duolingo augmentation. |
| CEFR/open lexical resources (dataset class)     | Good for graded planning and transfer paths                       | Often dataset-based rather than real-time API; quality varies by language.      | Medium curation effort; good for planning models.                             |


### Practical implication

If strict Duolingo-learned signals remain limited for some languages, the best high-value path is a hybrid product:

- keep Duolingo-native metrics only where reliable;
- use external sources for enrichment and transfer workflows;
- do not present external enrichment as Duolingo progress.

## 3) Product option mapping

### A. Retention/review support

1. **Strict-known review queue (Duolingo-native only)**

- Input contract: reliable learned-vocab source + review signal.
- Status now: blocked by learned-vocab reliability gaps.

1. **Skill-level review queue**

- Input contract: per-skill progress snapshots (`levels_finished`, changes over time).
- Status now: feasible as a coarse review assistant (skill-level, not precise word-level mastery).

1. **Content-based reinforcement queue**

- Input contract: known-word set + external sentence/content corpora.
- Status now: feasible once known-word source is reliable enough by language; high utility for transfer.

### B. Cross-language planning

1. **Portfolio planner (Duolingo-centric)**

- Inputs: per-course XP trend, streak/consistency, session cadence proxies.
- Status now: feasible and reliable at aggregate level.

1. **Goal allocation planner (Duolingo + external)**

- Inputs: above + user-defined outcomes (travel, reading, speaking) + external difficulty ladders.
- Status now: feasible with explicit user-configured goals.

### C. Transfer to real content

1. **Known-word coverage estimator on external texts**

- Inputs: reliable known-word set + tokenized text corpus.
- Status now: blocked for strict claims until known-word reliability improves.

1. **Guided content discovery by language level/topic**

- Inputs: external corpora + lexical metadata (not claiming known-word mastery).
- Status now: feasible now as non-misleading augmentation.

## 4) Feasibility/risk assessment

Scale: 1 (worst) to 5 (best).


| Option                                                 | Reliability | User value | Maintenance | Policy risk | Overall fit now                         |
| ------------------------------------------------------ | ----------- | ---------- | ----------- | ----------- | --------------------------------------- |
| Keep current dashboard unchanged                       | 2           | 2          | 3           | 2           | Low                                     |
| Duolingo-only strict progress dashboard                | 2           | 4          | 2           | 2           | Low-medium (blocked by capability gaps) |
| Duolingo + explicit reliability-gated metrics          | 4           | 4          | 3           | 2           | High                                    |
| Cross-language planner first (aggregate metrics)       | 4           | 4          | 4           | 3           | High                                    |
| Transfer-to-content augmentation first (external APIs) | 3           | 5          | 3           | 4           | High                                    |
| Broad pivot away from Duolingo data                    | 5           | 3          | 2           | 5           | Medium                                  |


Interpretation:

- Highest near-term value with reliability: planner + augmentation features that do not pretend exact learned-word truth where absent.
- Full strict per-word progress dashboards are currently constrained by Duolingo data semantics and endpoint behavior.

## 5) Decision framework (go / no-go)

### Gate 1: Stay Duolingo-centric for strict per-word progress?

Go only if all are true:

- reliable learned-vocab source exists for target languages,
- per-language learned counts are stable across repeated syncs,
- no silent fallback to curriculum-all words.

If any fail: no-go for strict per-word progress claims.

### Gate 2: Proceed with cross-language planning now?

Go if:

- aggregate metrics (XP/course progression cadence) are reliable,
- planning recommendations can be explained from those metrics,
- no dependence on unknown per-word timestamps.

Current assessment: **Go**.

### Gate 3: Proceed with transfer-to-real-content now?

Go if:

- external content/lexical sources are documented and stable,
- coverage suggestions are clearly labeled as enrichment, not strict Duolingo mastery claims.

Current assessment: **Go (with labeling constraints)**.

### Gate 4: Strategic pivot at higher level?

Pivot if:

- strict Duolingo word-level reliability remains below threshold after targeted validation,
- and user value from planner + transfer features remains high without strict per-word claims.

Current assessment: **Conditional pivot likely beneficial** if strict learned-vocab remains unresolved.

## Recommendation memo

1. **Do not treat this as a binary "keep dashboard vs abandon dashboard".**
  Use a reliability-gated product split:
  - strict Duolingo progress where truly reliable,
  - high-value augmentation (planning + transfer) where external sources are stronger.
2. **Prioritize exploration output in this order:**
  - capability matrix finalization per language/metric,
  - cross-language planner concept validation,
  - transfer-to-content concept validation with external sources.
3. **Avoid shipping any metric that implies exact learned-word recency unless exact time semantics are validated.**

This preserves trust, keeps the project useful for real learning decisions, and avoids overfitting to fragile endpoint assumptions.