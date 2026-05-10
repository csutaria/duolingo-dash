"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useSync,
  useStatus,
  usePollingControl,
  useUpdateSettings,
} from "@/lib/hooks";
import { parseUtcDate } from "@/lib/utils";

function ceilMin(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60_000));
}

type CurrentSync = { type: "single" | "cycle"; startedAtMs: number };

function SyncProgressBar({
  startedAtMs,
  expectedMs,
}: {
  startedAtMs: number;
  expectedMs: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAtMs);
  const determinate = expectedMs != null && expectedMs > 0;
  const progress = determinate ? Math.min(elapsed / expectedMs, 0.95) : 0;

  return (
    <div
      className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(progress * 100) : undefined}
      aria-label="Sync progress"
    >
      {determinate ? (
        <div
          className="h-full rounded-full bg-yellow-400 transition-[width] duration-300 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded-full bg-yellow-400/60" />
      )}
    </div>
  );
}

const panelBase =
  "absolute top-full right-0 z-[200] mt-2 w-max max-w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(70vh,calc(100vh-6rem))] overflow-y-auto rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-left text-xs text-zinc-300 shadow-xl transition-opacity duration-150";

const panelShown = "pointer-events-auto visible opacity-100";
const panelHidden = "pointer-events-none invisible opacity-0";

type SyncMode = "baseline" | "fast" | "course_conflict";

function sourceLabel(source: string): string {
  if (source === "settings") return "override";
  if (source === "env") return "DUOLINGO_TZ";
  if (source === "profile") return "Duolingo profile";
  if (source === "system") return "host";
  return source;
}

/**
 * Inline editor for `app_settings.timezone_override`. The committed
 * value lives on the server (`/api/status` → `timezoneOverride`); the
 * `draft` here is the in-flight edit while the user types. Save fires
 * the parent's `onCommit(value)`; Reset fires `onCommit(null)`.
 *
 * Validation is server-side: `POST /api/settings` rejects non-IANA
 * names with 400 and the error string surfaces under the row.
 */
function TimezoneOverrideRow({
  current,
  onCommit,
  busy,
  error,
  disabled,
}: {
  current: string | null;
  onCommit: (value: string | null) => void;
  busy: boolean;
  error: string | null;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<string>(current ?? "");

  // Sync the local draft when the server-confirmed value changes (e.g.
  // after a successful POST or another instance writing the same DB).
  // Don't clobber an in-flight edit: only re-sync when the draft
  // matches the prior server value or is empty.
  const lastCurrent = useRef<string | null>(current);
  useEffect(() => {
    if (draft === (lastCurrent.current ?? "") || draft === "") {
      setDraft(current ?? "");
    }
    lastCurrent.current = current;
  }, [current, draft]);

  const trimmed = draft.trim();
  const isUnchanged = trimmed === (current ?? "");
  const canSave = !busy && !disabled && trimmed.length > 0 && !isUnchanged;
  const canReset = !busy && !disabled && current != null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <dt className="shrink-0 text-zinc-500">Override</dt>
        <dd className="flex min-w-0 items-center gap-1 text-zinc-300">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                onCommit(trimmed);
              }
            }}
            disabled={busy || disabled}
            placeholder="e.g. Asia/Tokyo"
            spellCheck={false}
            autoComplete="off"
            aria-label="Timezone override (IANA zone)"
            title="Persisted in app_settings.timezone_override. Takes precedence over DUOLINGO_TZ, Duolingo profile, and host."
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => onCommit(trimmed)}
            disabled={!canSave}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            {busy ? "…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => onCommit(null)}
            disabled={!canReset}
            title="Clear the override and fall back to DUOLINGO_TZ → Duolingo profile → host."
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-700 disabled:opacity-40"
          >
            Reset
          </button>
        </dd>
      </div>
      {error != null && (
        <p className="ml-[5.25rem] text-[10px] text-amber-400">{error}</p>
      )}
    </div>
  );
}

function SyncStatusPanel({
  lastSync,
  syncError,
  pollingOn,
  paused,
  currentlyRunning,
  authenticated,
  readOnly,
  resolvedTimezone,
  resolvedTimezoneSource,
  msUntilNextXpCheck,
  msUntilNextNightlySync,
  syncMode,
  fastIdleTicks,
  fastIdleTicksRequired,
  nightlyHour,
  onChangeNightlyHour,
  nightlyHourBusy,
  timezoneOverride,
  onCommitTimezoneOverride,
  timezoneOverrideBusy,
  timezoneOverrideError,
  pinned,
  visible,
  onTogglePaused,
  pauseBusy,
  currentSync,
  expectedMsForCurrent,
}: {
  lastSync: string | null;
  syncError: string | null;
  pollingOn: boolean;
  paused: boolean;
  currentlyRunning: boolean;
  authenticated: boolean;
  readOnly: boolean;
  resolvedTimezone: string | null;
  resolvedTimezoneSource: string | null;
  msUntilNextXpCheck: number | null;
  msUntilNextNightlySync: number | null;
  syncMode: SyncMode;
  fastIdleTicks: number;
  fastIdleTicksRequired: number;
  nightlyHour: number;
  onChangeNightlyHour: (h: number) => void;
  nightlyHourBusy: boolean;
  timezoneOverride: string | null;
  onCommitTimezoneOverride: (value: string | null) => void;
  timezoneOverrideBusy: boolean;
  timezoneOverrideError: string | null;
  pinned: boolean;
  visible: boolean;
  onTogglePaused: () => void;
  pauseBusy: boolean;
  currentSync: CurrentSync | null;
  expectedMsForCurrent: number | null;
}) {
  const watchingAccount = syncMode === "fast" || syncMode === "course_conflict";
  const idleText =
    watchingAccount
      ? "Watching account — checking every 2m"
      : "Idle — XP check every 30m";

  const stateLabel = readOnly
    ? { text: "Read-only — display instance", color: "text-blue-300" }
    : !authenticated
      ? { text: "Not connected", color: "text-red-400" }
      : paused && currentlyRunning
        ? { text: "Paused — syncing now…", color: "text-yellow-400" }
        : paused
          ? { text: "Paused", color: "text-red-400" }
          : !pollingOn
            ? { text: "Polling off", color: "text-red-400" }
            : currentlyRunning
              ? { text: "Syncing now…", color: "text-yellow-400" }
              : { text: idleText, color: "text-green-400" };

  const xpCheckMin = msUntilNextXpCheck != null ? ceilMin(msUntilNextXpCheck) : null;
  const nightlyMin = msUntilNextNightlySync != null ? ceilMin(msUntilNextNightlySync) : null;
  const quietRemainingMin =
    watchingAccount
      ? Math.max(0, fastIdleTicksRequired - fastIdleTicks) * 2
      : null;

  return (
    <div
      className={`${panelBase} ${visible ? panelShown : panelHidden}`}
      role={pinned ? "dialog" : "tooltip"}
      aria-label="Sync status"
      aria-hidden={!visible}
    >
      <div className="space-y-1.5 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-zinc-100">Sync</span>
          <span className={stateLabel.color}>● {stateLabel.text}</span>
        </div>
        {currentSync && (
          <SyncProgressBar
            startedAtMs={currentSync.startedAtMs}
            expectedMs={expectedMsForCurrent}
          />
        )}
        {lastSync != null ? (
          <p className="text-[11px] text-zinc-400">
            Last sync:{" "}
            <span className="tabular-nums text-zinc-300">
              {parseUtcDate(lastSync).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-zinc-500">Last sync: —</p>
        )}
        {syncError != null && (
          <p className="text-[11px] text-amber-400">Error: {syncError}</p>
        )}
      </div>

      <dl className="mt-2 space-y-1.5 text-[11px] leading-snug">
        {!readOnly && (
          <>
            <div className="flex gap-2">
              <dt className="shrink-0 text-zinc-500">Next XP check</dt>
              <dd className="tabular-nums text-zinc-300">
                {paused
                  ? "— (paused)"
                  : xpCheckMin != null && xpCheckMin > 0
                    ? `~${xpCheckMin}m`
                    : xpCheckMin === 0
                      ? "imminent"
                      : "— (pending first check)"}
              </dd>
            </div>
            {watchingAccount && quietRemainingMin != null && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-zinc-500">Full sync if quiet</dt>
                <dd className="tabular-nums text-zinc-300">
                  {quietRemainingMin > 0 ? `in ~${quietRemainingMin}m` : "imminent"}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-zinc-500">Next nightly sync</dt>
              <dd className="tabular-nums text-zinc-300">
                {paused
                  ? "— (paused)"
                  : nightlyMin != null && nightlyMin > 0
                    ? `~${nightlyMin}m`
                    : nightlyMin === 0
                      ? "imminent"
                      : "— (scheduling)"}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="shrink-0 text-zinc-500">Nightly at</dt>
              <dd className="flex items-center gap-1 text-zinc-300">
                <select
                  value={nightlyHour}
                  onChange={(e) => onChangeNightlyHour(Number(e.target.value))}
                  disabled={nightlyHourBusy || !authenticated}
                  aria-label="Nightly sync hour"
                  title="Hour of day (in resolved timezone) when the nightly cycle-all sync fires."
                  className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[11px] tabular-nums text-zinc-200 disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
                <span className="text-zinc-500">in {resolvedTimezone ?? "R"}</span>
              </dd>
            </div>
          </>
        )}
        {resolvedTimezone != null && resolvedTimezoneSource != null && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-zinc-500">Timezone</dt>
            <dd
              className="min-w-0 break-all text-zinc-300"
              title={`Resolved IANA timezone (R) for calendar days, XP daily rows, and the nightly sync. Priority: override (here) → DUOLINGO_TZ env → Duolingo profile (after sync) → host.`}
            >
              {resolvedTimezone}{" "}
              <span className="text-zinc-500">({sourceLabel(resolvedTimezoneSource)})</span>
            </dd>
          </div>
        )}
        {!readOnly && (
          <TimezoneOverrideRow
            current={timezoneOverride}
            onCommit={onCommitTimezoneOverride}
            busy={timezoneOverrideBusy}
            error={timezoneOverrideError}
            disabled={!authenticated}
          />
        )}
      </dl>

      {readOnly ? (
        <div className="mt-2.5 border-t border-zinc-800 pt-2">
          <p className="text-[10px] leading-snug text-zinc-500">
            Display-only instance (`DUOLINGO_READ_ONLY=1`). Writes are
            disabled — no JWT, no polling, no nightly sync. The DB is
            opened read-only and shared with the writer process.
          </p>
        </div>
      ) : (
        authenticated && (
          <div className="mt-2.5 border-t border-zinc-800 pt-2">
            <button
              type="button"
              onClick={onTogglePaused}
              disabled={pauseBusy}
              className={`w-full whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                paused
                  ? "bg-green-700/60 text-green-100 hover:bg-green-600/70"
                  : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {pauseBusy
                ? paused
                  ? "Resuming…"
                  : "Pausing…"
                : paused
                  ? "Resume polling"
                  : "Pause polling"}
            </button>
            <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
              Pausing stops baseline XP checks, quiet-detector fast polls, and the nightly sync. Manual Refresh and Sync All still work. Resets on server restart.
            </p>
          </div>
        )
      )}
    </div>
  );
}

export function SyncBar() {
  const { sync, syncing } = useSync();
  const status = useStatus();
  const { setPaused, pending: pauseBusy } = usePollingControl();
  const { update: updateSettings, pending: settingsBusy } = useUpdateSettings();

  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [optimisticPaused, setOptimisticPaused] = useState<boolean | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!pinned) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setPinned(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPinned(false);
        setSuppressed(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  // Clear the post-unpin suppression flag once the user has fully disengaged.
  useEffect(() => {
    if (!hover && !focused && suppressed) setSuppressed(false);
  }, [hover, focused, suppressed]);

  const serverPaused = status?.paused === true;
  useEffect(() => {
    if (optimisticPaused == null) return;
    if (serverPaused === optimisticPaused) setOptimisticPaused(null);
  }, [serverPaused, optimisticPaused]);

  const paused = optimisticPaused ?? serverPaused;

  const handleTogglePaused = useCallback(async () => {
    const next = !paused;
    setOptimisticPaused(next);
    const res = await setPaused(next);
    if (res && "error" in res && res.error) {
      setOptimisticPaused(null);
    }
  }, [paused, setPaused]);

  const lastSync = status?.dbStatus
    ? (status.dbStatus as Record<string, unknown>).lastSync
    : null;

  const lastResult = status?.lastSyncResult as Record<string, unknown> | null;
  const hasError = lastResult?.error;

  const demoMode = status?.demoMode === true;
  const readOnly = status?.readOnly === true;
  const authenticated = status?.authenticated === true;
  const pollingOn = status?.polling === true;
  const currentlyRunning = status?.currentlyRunning === true || syncing;
  const msUntilNextXpCheck = (status?.msUntilNextXpCheck as number | null) ?? null;
  const msUntilNextNightlySync =
    (status?.msUntilNextNightlySync as number | null) ?? null;
  const resolvedTimezone =
    typeof status?.resolvedTimezone === "string" ? status.resolvedTimezone : null;
  const resolvedTimezoneSource =
    typeof status?.resolvedTimezoneSource === "string"
      ? status.resolvedTimezoneSource
      : null;
  const syncMode = ((status?.syncMode as SyncMode | undefined) ?? "baseline") as SyncMode;
  const fastIdleTicks = (status?.fastIdleTicks as number | undefined) ?? 0;
  const fastIdleTicksRequired = (status?.fastIdleTicksRequired as number | undefined) ?? 5;
  const serverNightlyHour = (status?.nightlyHour as number | undefined) ?? 2;
  // Optimistically reflect the user's selection so the dropdown doesn't
  // visually snap back during the ~1s round-trip; clears when the server
  // confirms (poll loop refreshes status every 5s, plus the post-update
  // refetch below).
  const [optimisticNightlyHour, setOptimisticNightlyHour] = useState<number | null>(null);
  useEffect(() => {
    if (optimisticNightlyHour == null) return;
    if (serverNightlyHour === optimisticNightlyHour) setOptimisticNightlyHour(null);
  }, [serverNightlyHour, optimisticNightlyHour]);
  const nightlyHour = optimisticNightlyHour ?? serverNightlyHour;

  const handleChangeNightlyHour = useCallback(
    async (h: number) => {
      if (h === nightlyHour) return;
      setOptimisticNightlyHour(h);
      const res = await updateSettings({ nightlyHour: h });
      if ("error" in res && res.error) setOptimisticNightlyHour(null);
    },
    [nightlyHour, updateSettings],
  );

  // Timezone override (UI's slot in the resolver chain). Optimistic
  // pattern with no clearing-effect: the display is computed during
  // render as "show in-flight value if it disagrees with server,
  // otherwise show server". Once the next /api/status poll lands and
  // serverTimezoneOverride catches up to optimisticTimezoneOverride,
  // the comparison falls through to server naturally — no need to
  // setState back to undefined (which the linter flags as a
  // cascading-render anti-pattern).
  const serverTimezoneOverride =
    typeof status?.timezoneOverride === "string"
      ? status.timezoneOverride
      : null;
  const [optimisticTimezoneOverride, setOptimisticTimezoneOverride] = useState<
    string | null | undefined
  >(undefined);
  const timezoneOverride =
    optimisticTimezoneOverride !== undefined
    && optimisticTimezoneOverride !== serverTimezoneOverride
      ? optimisticTimezoneOverride
      : serverTimezoneOverride;
  const [timezoneOverrideError, setTimezoneOverrideError] = useState<
    string | null
  >(null);

  const handleCommitTimezoneOverride = useCallback(
    async (value: string | null) => {
      setTimezoneOverrideError(null);
      setOptimisticTimezoneOverride(value);
      const res = await updateSettings({ timezoneOverride: value });
      if ("error" in res && res.error) {
        setOptimisticTimezoneOverride(undefined);
        setTimezoneOverrideError(res.error);
      }
    },
    [updateSettings],
  );

  const currentSync = (status?.currentSync as CurrentSync | null) ?? null;
  const expectedDurationMs = status?.expectedDurationMs as
    | { single: number | null; cycle: number | null }
    | undefined;
  const expectedMsForCurrent = currentSync
    ? currentSync.type === "cycle"
      ? expectedDurationMs?.cycle ?? null
      : expectedDurationMs?.single ?? null
    : null;

  const indicatorColor = readOnly
    ? "text-blue-300"
    : !status || !authenticated
      ? "text-red-500"
      : currentlyRunning
        ? "text-yellow-400"
        : paused || !pollingOn
          ? "text-red-500"
          : syncMode === "fast" || syncMode === "course_conflict"
            ? "text-yellow-400"
            : "text-green-500";

  const nextCheckMin =
    msUntilNextXpCheck != null ? Math.max(0, Math.ceil(msUntilNextXpCheck / 60_000)) : null;

  const indicatorLabel = !status
    ? "Initializing…"
    : readOnly
      ? "Read-only"
      : !authenticated
        ? "Not connected"
        : paused && currentlyRunning
          ? "Paused · Syncing…"
          : paused
            ? "Paused"
            : !pollingOn
              ? "Polling off"
              : currentlyRunning
                ? "Syncing…"
                : syncMode === "fast" || syncMode === "course_conflict"
                  ? "Watching account"
                  : nextCheckMin != null && nextCheckMin > 0
                    ? `Check in ~${nextCheckMin}m`
                    : "Polling";

  const panelVisible = pinned || ((hover || focused) && !suppressed);

  const handleIndicatorClick = useCallback(() => {
    setPinned((p) => {
      const next = !p;
      setSuppressed(!next);
      if (!next) {
        // Drop focus so the panel can reappear on next mouseenter once
        // focused also goes false and the suppression effect clears.
        buttonRef.current?.blur();
      }
      return next;
    });
  }, []);

  // Keep ALL hooks above any conditional return — when /api/status first
  // lands with `demoMode: true`, an early return here used to skip
  // `handleIndicatorClick` and tripped "Rendered fewer hooks than expected".
  if (demoMode) {
    return (
      <span className="text-xs text-zinc-500 border border-zinc-700 rounded px-2 py-1">
        Demo
      </span>
    );
  }

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-3 text-sm">
      <div
        ref={wrapperRef}
        className="relative shrink-0"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={handleIndicatorClick}
          aria-expanded={pinned}
          aria-haspopup="dialog"
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 ${indicatorColor}`}
        >
          ● {indicatorLabel}
        </button>
        <SyncStatusPanel
          lastSync={lastSync != null ? String(lastSync) : null}
          syncError={hasError != null ? String(hasError) : null}
          pollingOn={pollingOn}
          paused={paused}
          currentlyRunning={currentlyRunning}
          authenticated={authenticated}
          readOnly={readOnly}
          resolvedTimezone={resolvedTimezone}
          resolvedTimezoneSource={resolvedTimezoneSource}
          msUntilNextXpCheck={msUntilNextXpCheck}
          msUntilNextNightlySync={msUntilNextNightlySync}
          syncMode={syncMode}
          fastIdleTicks={fastIdleTicks}
          fastIdleTicksRequired={fastIdleTicksRequired}
          nightlyHour={nightlyHour}
          onChangeNightlyHour={handleChangeNightlyHour}
          nightlyHourBusy={settingsBusy}
          timezoneOverride={timezoneOverride}
          onCommitTimezoneOverride={handleCommitTimezoneOverride}
          timezoneOverrideBusy={settingsBusy}
          timezoneOverrideError={timezoneOverrideError}
          pinned={pinned}
          visible={panelVisible}
          onTogglePaused={handleTogglePaused}
          pauseBusy={pauseBusy}
          currentSync={currentSync}
          expectedMsForCurrent={expectedMsForCurrent}
        />
      </div>

      {readOnly ? (
        <span
          className="whitespace-nowrap rounded border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-200"
          title="Display-only instance. Writes are disabled."
        >
          Read-only
        </span>
      ) : (
        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          <button
            type="button"
            onClick={() => sync(true, false)}
            disabled={syncing}
            className="whitespace-nowrap px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-200 transition-colors"
          >
            {syncing ? "Syncing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  "This will temporarily switch your active Duolingo language to sync all courses. Only use when you're not actively using Duolingo.",
                )
              ) {
                sync(true, true);
              }
            }}
            disabled={syncing}
            className="whitespace-nowrap px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {syncing ? "Syncing…" : "Sync All Languages"}
          </button>
        </div>
      )}
    </div>
  );
}
