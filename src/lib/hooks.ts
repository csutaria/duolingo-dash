"use client";

import { useState, useEffect, useCallback } from "react";

export function useData<T>(query: string, params?: Record<string, string>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // `params` changes on every render (object literal callers), but we
  // re-derive identity on JSON content so AbortController can replace
  // the in-flight request only when the request actually changes.
  // Stale fetches must be aborted, not just ignored: without abort, a
  // late-arriving response from the prior params (e.g. the default
  // `days=30` request kicked off before localStorage hydrates the
  // user's chosen window to `7`) would call `setData` after the new
  // request resolved and silently overwrite the correct data.
  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ q: query, ...params });
      const res = await fetch(`/api/data?${sp}`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (signal?.aborted) return;
      setData(json);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query, params ? JSON.stringify(params) : ""]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  useEffect(() => {
    const onSync = () => fetchData();
    window.addEventListener(SYNC_COMPLETE_EVENT, onSync);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, onSync);
  }, [fetchData]);

  return { data, error, loading, refetch: fetchData };
}

export const SYNC_COMPLETE_EVENT = "duolingo-sync-complete";

export function useSync() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const sync = useCallback(async (force = false, cycleAll = false) => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, cycleAll }),
      });
      const data = await res.json();
      setResult(data);
      window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT));
      return data;
    } catch (err) {
      const errData = { error: err instanceof Error ? err.message : "Sync failed" };
      setResult(errData);
      return errData;
    } finally {
      setSyncing(false);
    }
  }, []);

  return { sync, syncing, result };
}

export function usePollingControl() {
  const [pending, setPending] = useState(false);

  const setPaused = useCallback(async (paused: boolean) => {
    setPending(true);
    try {
      const res = await fetch("/api/polling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: paused ? "pause" : "resume" }),
      });
      const data = await res.json();
      return data as { paused?: boolean; polling?: boolean; error?: string };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed" };
    } finally {
      setPending(false);
    }
  }, []);

  return { setPaused, pending };
}

export function useUpdateSettings() {
  const [pending, setPending] = useState(false);

  const update = useCallback(
    async (
      patch: { nightlyHour?: number | null; timezoneOverride?: string | null },
    ): Promise<{ nightlyHour?: number; timezoneOverride?: string | null; error?: string }> => {
      setPending(true);
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        return data;
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Settings update failed" };
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { update, pending };
}

export function useStatus() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);

  const fetchStatus = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    window.addEventListener(SYNC_COMPLETE_EVENT, fetchStatus);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, fetchStatus);
  }, [fetchStatus]);

  return status;
}
