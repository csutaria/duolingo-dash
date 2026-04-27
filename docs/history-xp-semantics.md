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

## Chart render-stability rules

These rules exist to keep the stacked Area chart visually stable across
view transitions (e.g. 7d → 1d → 7d). Recharts decides each Area's
stack baseline from the order of the cartesian items it has registered
internally; if Areas mount and unmount across renders, that registry
order can drift and corrupt the visible stack on the return trip.

Invariants enforced in `src/components/StackedXpChart.tsx`:

- The `<Area>` children set is **stable across all views**:
  - one Area per course id in `courseIds` (even courses with all-zero
    values in the current window),
  - plus the `_prior` and `_pretrack` Areas, always rendered, even when
    their values are 0 across every row.
- The dynamic sort ("smallest delta at the bottom, biggest on top") is
  preserved by re-sorting the **render order** of the same Areas each
  render, not by adding/removing them. Equal-valued series fall back
  to alphabetical-by-id so the inactive zero pile is deterministic.
- Tooltip uses a custom `content` component that filters out zero-value
  rows so inactive courses don't clutter the hover panel.
- The chart is keyed on `view` in `src/app/history/page.tsx`. This is
  belt-and-suspenders on top of the stable child set above and makes
  any residual recharts state get rebuilt on view change.

### 1-day view: single-row synthesis

Recharts cannot draw a stacked Area from a single data point — it
falls back to a column of dots, and a 1-point stack has no shape to
anchor stack baselines to.

When `data.length === 1` (typically the 1d view), `StackedXpChart`
synthesizes a leading start-of-day and trailing end-of-day point with
the same values, so each course paints as a horizontal band across
the day. The 1d X domain in `history/page.tsx` is anchored at
midnight (instead of noon) so the synthesized band fills the full
visible range.

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
- Meta cards for non-course series (`_untracked` / `_pretrack`).
- Stack-order stability across view transitions: stable Area child set,
  stable tiebreaker, custom tooltip filter, view-keyed remount.
- 1-day view renders as horizontal lines via single-row synthesis.

### Open follow-ups

- Decide whether the `Cumulative XP` line legend remains useful once
  `Profile total XP` and per-course coverage are visible.
- Daily stacked bar chart was previously suspected of a similar
  ordering regression; current observation is no visible issue. Revisit
  if it resurfaces.

---

## Change protocol for future edits

When changing chart semantics, update in the same PR:

1. This file (`docs/history-xp-semantics.md`) with the new contract.
2. `src/lib/queries.ts` behavior and comments.
3. `src/app/api/data/route.ts` contract mapping.
4. `src/lib/__tests__/queries-windowing.test.ts` (or equivalent) to pin invariant changes.

If selector labels change, also update subtitle/legend copy and keep left/right all-time semantics explicit.