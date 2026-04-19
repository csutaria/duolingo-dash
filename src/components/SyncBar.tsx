"use client";

import { useSync, useStatus } from "@/lib/hooks";
import { parseUtcDate } from "@/lib/utils";

function ceilMin(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60_000));
}

const tooltipPanel =
  "pointer-events-none invisible absolute top-full right-0 z-[200] mt-2 w-max max-w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(70vh,calc(100vh-6rem))] overflow-y-auto rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-left text-xs text-zinc-300 shadow-xl opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100";

function SyncStatusHover({
  lastSync,
  syncError,
  pollingOn,
  currentlyRunning,
  authenticated,
  msUntilNextPoll,
  msUntilNextAllCourseSync,
}: {
  lastSync: string | null;
  syncError: string | null;
  pollingOn: boolean;
  currentlyRunning: boolean;
  authenticated: boolean;
  msUntilNextPoll: number | null;
  msUntilNextAllCourseSync: number | null;
}) {
  const stateLabel = !authenticated
    ? { text: "Not connected", color: "text-red-400" }
    : !pollingOn
      ? { text: "Polling off", color: "text-red-400" }
      : currentlyRunning
        ? { text: "Syncing now…", color: "text-yellow-400" }
        : { text: "Idle — polls every 15m", color: "text-green-400" };

  const pollMin = msUntilNextPoll != null ? ceilMin(msUntilNextPoll) : null;
  const allCourseMin = msUntilNextAllCourseSync != null ? ceilMin(msUntilNextAllCourseSync) : null;

  return (
    <div className={tooltipPanel} role="tooltip">
      <div className="space-y-1.5 border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="font-medium text-zinc-100">Sync</span>
          <span className={stateLabel.color}>● {stateLabel.text}</span>
        </div>
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
        <div className="flex gap-2">
          <dt className="shrink-0 text-zinc-500">Next XP poll</dt>
          <dd className="tabular-nums text-zinc-300">
            {pollMin != null && pollMin > 0
              ? `~${pollMin}m`
              : pollMin === 0
                ? "imminent"
                : "— (pending first poll)"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-zinc-500">Next all-course sync</dt>
          <dd className="tabular-nums text-zinc-300">
            {allCourseMin != null && allCourseMin > 0
              ? `~${allCourseMin}m`
              : allCourseMin === 0
                ? "imminent"
                : "— (pending first sync)"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function SyncBar() {
  const { sync, syncing } = useSync();
  const status = useStatus();

  const lastSync = status?.dbStatus
    ? (status.dbStatus as Record<string, unknown>).lastSync
    : null;

  const lastResult = status?.lastSyncResult as Record<string, unknown> | null;
  const hasError = lastResult?.error;

  const demoMode = status?.demoMode === true;
  const authenticated = status?.authenticated === true;
  const pollingOn = status?.polling === true;
  const currentlyRunning = status?.currentlyRunning === true || syncing;
  const msUntilNextPoll = status?.msUntilNextPoll as number | null ?? null;
  const msUntilNextAllCourseSync = status?.msUntilNextAllCourseSync as number | null ?? null;

  const indicatorColor = !status || !authenticated || !pollingOn
    ? "text-red-500"
    : currentlyRunning
      ? "text-yellow-400"
      : "text-green-500";

  const nextPollMin = msUntilNextPoll != null ? Math.max(0, Math.ceil(msUntilNextPoll / 60_000)) : null;

  const indicatorLabel = !status
    ? "Initializing…"
    : !authenticated
      ? "Not connected"
      : !pollingOn
        ? "Polling off"
        : currentlyRunning
          ? "Syncing…"
          : nextPollMin != null && nextPollMin > 0
            ? `Poll in ~${nextPollMin}m`
            : "Polling";

  if (demoMode) {
    return (
      <span className="text-xs text-zinc-500 border border-zinc-700 rounded px-2 py-1">
        Demo
      </span>
    );
  }

  return (
    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-3 text-sm">
      <div className="group relative shrink-0">
        <span
          tabIndex={0}
          className={`cursor-help whitespace-nowrap rounded px-1.5 py-0.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-zinc-500/40 ${indicatorColor}`}
        >
          ● {indicatorLabel}
        </span>
        <SyncStatusHover
          lastSync={lastSync != null ? String(lastSync) : null}
          syncError={hasError != null ? String(hasError) : null}
          pollingOn={pollingOn}
          currentlyRunning={currentlyRunning}
          authenticated={authenticated}
          msUntilNextPoll={msUntilNextPoll}
          msUntilNextAllCourseSync={msUntilNextAllCourseSync}
        />
      </div>

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
            if (confirm("This will temporarily switch your active Duolingo language to sync all courses. Only use when you're not actively using Duolingo.")) {
              sync(true, true);
            }
          }}
          disabled={syncing}
          className="whitespace-nowrap px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {syncing ? "Syncing…" : "Sync All Languages"}
        </button>
      </div>
    </div>
  );
}
