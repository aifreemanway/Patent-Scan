"use client";

import { useMemo, useSyncExternalStore } from "react";

// Hydrates a JSON blob from sessionStorage on the client without causing
// cascading useEffect renders (which ESLint's react-hooks/set-state-in-effect
// forbids starting Next 16). sessionStorage doesn't emit change events, so the
// no-op `subscribe` just satisfies useSyncExternalStore's contract.

function noopSubscribe() {
  return () => {};
}

function getRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(key);
}

export type SessionJSON<T> = {
  data: T | null;
  loaded: boolean;
};

export function useSessionJSON<T>(key: string): SessionJSON<T> {
  const raw = useSyncExternalStore(
    noopSubscribe,
    () => getRaw(key),
    () => null
  );
  // `loaded` is false during SSR and the very first client render, then flips
  // to true — lets callers show a spinner while hydration is in progress.
  const loaded = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  const data = useMemo<T | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw]);

  return { data, loaded };
}
