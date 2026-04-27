"use client";

import { useCallback, useEffect, useState } from "react";

export type XpWindow = "1" | "3" | "7" | "30" | "90" | "all";
export type HistoryAllView = "all" | "total";

export const XP_WINDOW_OPTIONS: Array<{
  value: XpWindow;
  label: string;
  fullLabel: string;
  cardLabel: string;
}> = [
  { value: "1", label: "1d", fullLabel: "1 day", cardLabel: "1d" },
  { value: "3", label: "3d", fullLabel: "3 days", cardLabel: "3d" },
  { value: "7", label: "7d", fullLabel: "7 days", cardLabel: "7d" },
  { value: "30", label: "30d", fullLabel: "30 days", cardLabel: "30d" },
  { value: "90", label: "90d", fullLabel: "90 days", cardLabel: "90d" },
  { value: "all", label: "All", fullLabel: "All time", cardLabel: "All" },
];

const XP_WINDOW_STORAGE_KEY = "duolingo-dash.xpWindow";
const HISTORY_ALL_STORAGE_KEY = "duolingo-dash.historyAllView";
const XP_WINDOW_EVENT = "duolingo-dash-xp-window-change";
const HISTORY_ALL_EVENT = "duolingo-dash-history-all-change";

export function getXpWindowOption(value: XpWindow) {
  return XP_WINDOW_OPTIONS.find((option) => option.value === value);
}

export function isXpWindow(value: unknown): value is XpWindow {
  return (
    value === "1" ||
    value === "3" ||
    value === "7" ||
    value === "30" ||
    value === "90" ||
    value === "all"
  );
}

function isHistoryAllView(value: unknown): value is HistoryAllView {
  return value === "all" || value === "total";
}

export function useSharedXpWindow(defaultValue: XpWindow = "30") {
  const [xpWindow, setXpWindowState] = useState<XpWindow>(defaultValue);

  useEffect(() => {
    const stored = window.localStorage.getItem(XP_WINDOW_STORAGE_KEY);
    if (isXpWindow(stored)) {
      setXpWindowState(stored);
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === XP_WINDOW_STORAGE_KEY && isXpWindow(event.newValue)) {
        setXpWindowState(event.newValue);
      }
    };
    const onCustomEvent = (event: Event) => {
      const next = (event as CustomEvent<XpWindow>).detail;
      if (isXpWindow(next)) {
        setXpWindowState(next);
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(XP_WINDOW_EVENT, onCustomEvent);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(XP_WINDOW_EVENT, onCustomEvent);
    };
  }, []);

  const setXpWindow = useCallback((next: XpWindow) => {
    setXpWindowState(next);
    window.localStorage.setItem(XP_WINDOW_STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent<XpWindow>(XP_WINDOW_EVENT, { detail: next }));
  }, []);

  return [xpWindow, setXpWindow] as const;
}

export function useHistoryAllView(defaultValue: HistoryAllView = "total") {
  const [historyAllView, setHistoryAllViewState] = useState<HistoryAllView>(defaultValue);

  useEffect(() => {
    const stored = window.localStorage.getItem(HISTORY_ALL_STORAGE_KEY);
    if (isHistoryAllView(stored)) setHistoryAllViewState(stored);

    const onStorage = (event: StorageEvent) => {
      if (event.key === HISTORY_ALL_STORAGE_KEY && isHistoryAllView(event.newValue)) {
        setHistoryAllViewState(event.newValue);
      }
    };
    const onCustomEvent = (event: Event) => {
      const next = (event as CustomEvent<HistoryAllView>).detail;
      if (isHistoryAllView(next)) setHistoryAllViewState(next);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(HISTORY_ALL_EVENT, onCustomEvent);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HISTORY_ALL_EVENT, onCustomEvent);
    };
  }, []);

  const setHistoryAllView = useCallback((next: HistoryAllView) => {
    setHistoryAllViewState(next);
    window.localStorage.setItem(HISTORY_ALL_STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent<HistoryAllView>(HISTORY_ALL_EVENT, { detail: next }));
  }, []);

  return [historyAllView, setHistoryAllView] as const;
}
