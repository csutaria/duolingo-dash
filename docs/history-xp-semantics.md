# History XP semantics

Product + implementation decision record for History/Overview XP chart behavior.

This is the canonical place to understand:

- what each selector means,
- what data shape each mode returns,
- why both "All time" controls exist,
- what is still intentionally unresolved.

---

## Scope

This doc covers:

- History page stacked XP area chart semantics.
- History page selector semantics and card ordering.
- Shared data contracts from `/api/data?q=course-xp-history`.

This doc does **not** cover:

- Sync cadence/timers (see `docs/architecture.md`).
- Daily bar chart internals except where they intersect with pending chart decisions.

---

## Current user-facing model

### Selector model (History page)

- **Change side**: `1 day`, `7 days`, `30 days`, `90 days`, `All time`.
- **Total side**: `All time`.

Both sides intentionally have an `All time` control.

### Meaning of each side

- **Change** = delta stack (`XP gained per language`).
- **Total** = cumulative stack (`Cumulative XP per language`).

Interpretation:

- Left `All time` = full-span gains from tracking horizon.
- Right `All time` = all-time per-language totals.

To avoid ambiguity, subtitles/titles may render the total mode as `All time Total`.

---

## Rationale and trade-off

This split was chosen because a single all-time chart mode cannot cleanly answer both:

- "What changed in this interval?" (delta question)
- "How large is each language overall?" (cumulative question)

General-case guidance adopted:

- bounded windows and gain-oriented comparisons use **delta**,
- total-size questions use **cumulative**.

This avoids forcing users to interpret tracker-horizon artifacts as lifetime totals.

---

## Data/API contract (`q=course-xp-history`)

### Query behavior

- `days=N` (N >= 1): delta, bounded window.
- `days=all`: delta, full span.
- no `days`: cumulative, full span.
- `stack=delta` with no `days`: explicit full-span delta fetch (advanced/internal use).

### Returned row conventions

Common fields:

- `date`
- per-course keys (`course_id` string keys)
- `_total` (tracked/ideal total line basis)
- `_pretrack` (non-course gap needed to reconcile profile/daily vs course breakdown)
- `_prior` (delta-mode floor offset; cumulative mode is `0`)

Invariants:

- Delta mode: `_prior + _pretrack + Σ(course deltas) = _total`.
- Cumulative mode: `_prior = 0` and `_pretrack + Σ(course totals) = _total`.

---

## Course cards and ordering

### History page cards

- **Change views**: Overview-style ranking
  - active courses first,
  - active sorted by change amount (desc),
  - inactive sorted by all-time XP (desc).
- **Total view**:
  - all-time XP (desc),
  - no change-specific dimming semantics.

### Active-in-window definition

A course is active in a change view if **any** row in the selected stack data has value `> 0` for that course.

---

## Labeling rules

- Change modes subtitle lead: `XP gained per language`.
- Total mode subtitle lead: `Cumulative XP per language`.
- Legend text currently uses:
  - `Pre-tracking`
  - `Cumulative XP`
  - `Profile total XP`

---

## Implementation map

Primary files:

- `src/app/history/page.tsx` (selector UI, subtitle copy, card sorting, query params).
- `src/app/api/data/route.ts` (`course-xp-history` param routing).
- `src/lib/queries.ts` (`getCourseXpHistory` mode logic and stack invariants).
- `src/components/StackedXpChart.tsx` (chart rendering + legend labels).
- `src/lib/__tests__/queries-windowing.test.ts` (windowing + mode invariants).

---

## Decision timeline (condensed)

1. Initial history chart issue: bounded windows visually collapsed due to cumulative slabs.
2. Delta-based bounded behavior added for readability.
3. Attempted "all ranges are delta" unification; rejected (all-time meaning became less intuitive for totals).
4. Adopted split semantics:
  - change-side all windows (including all-time) = delta,
  - total-side all-time = cumulative.
5. Selector was updated to explicitly expose both all-time interpretations.

---

## Status snapshot

### Completed

- Off-by-one range fix (`days=N` returns exactly N calendar days).
- `/xp` -> `/history` route rename + redirect.
- Overview window XP card emphasis and inactive dimming.
- History dual all-time model (change vs total) with explicit selector semantics.
- History card sorting aligned with Overview behavior for change modes.

### Open follow-ups

- Add meta cards for non-course series (`_untracked` / `_pretrack`) and review whether the tracked line legend should remain.
- Fix daily stacked bar ordering regression where `_untracked` can be visually overtaken after hover/window changes.

---

## Change protocol for future edits

When changing chart semantics, update in the same PR:

1. This file (`docs/history-xp-semantics.md`) with the new contract.
2. `src/lib/queries.ts` behavior and comments.
3. `src/app/api/data/route.ts` contract mapping.
4. `src/lib/__tests__/queries-windowing.test.ts` (or equivalent) to pin invariant changes.

If selector labels change, also update subtitle/legend copy and keep left/right all-time semantics explicit.