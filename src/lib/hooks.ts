"use client";

import { useState, useEffect, useCallback } from "react";

export function useData<T>(query: string, params?: Record<string, string>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ q: query, ...params });
      const res = await fetch(`/api/data?${sp}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [query, params ? JSON.stringify(params) : ""]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    window.addEventListener(SYNC_COMPLETE_EVENT, fetchData);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, fetchData);
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

export function useStatus() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

    const interval = setInterval(() => {
      fetch("/api/status")
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => {});
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return status;
}
