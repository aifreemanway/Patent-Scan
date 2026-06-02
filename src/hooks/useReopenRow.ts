"use client";

// Restores a saved report when the user re-opens it from /account/history.
//
// WHY: the report pages hydrate from sessionStorage (fast path, same tab right
// after a run). Re-opening from history lands on /report?id=<uuid> in a fresh
// session where sessionStorage is empty → the page showed "Нет данных". This
// hook fetches the persisted row from /api/search/[id] (RLS-scoped to the user)
// so the report rebuilds from search_requests.result. Callers pass `enabled`
// (typically `loaded && !sessionData`) so the fetch only fires when the fast
// path produced nothing AND an id is present in the URL.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export type ReopenState =
  | "idle"
  | "loading"
  | "processing" // row exists but status is pending/in_progress
  | "error"
  | "notfound"
  | "done";

export type ReopenRow = {
  id: string;
  type: "novelty" | "landscape" | "deep_analysis" | "literature_review";
  status: "pending" | "in_progress" | "completed" | "error" | "cancelled";
  topic: string;
  result: unknown;
  error_message: string | null;
};

export function useReopenRow(enabled: boolean): {
  row: ReopenRow | null;
  state: ReopenState;
  id: string | null;
} {
  const sp = useSearchParams();
  const id = sp.get("id");
  const [row, setRow] = useState<ReopenRow | null>(null);
  const [state, setState] = useState<ReopenState>("idle");

  useEffect(() => {
    if (!enabled || !id) return;
    let cancelled = false;

    // setState lives inside the async callback (never synchronously in the
    // effect body) — synchronous setState-in-effect triggers cascading renders
    // and is forbidden by react-hooks/set-state-in-effect.
    (async () => {
      setState("loading");
      try {
        const resp = await fetch(`/api/search/${id}`, { cache: "no-store" });
        if (cancelled) return;
        if (resp.status === 404) {
          setState("notfound");
          return;
        }
        if (!resp.ok) {
          setState("error");
          return;
        }
        const data = (await resp.json()) as ReopenRow;
        if (cancelled) return;
        setRow(data);
        if (data.status === "error") {
          setState("error");
        } else if (data.status === "completed" && data.result) {
          setState("done");
        } else if (data.status === "pending" || data.status === "in_progress") {
          setState("processing");
        } else {
          // cancelled, or completed-without-result → nothing to show
          setState("notfound");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, id]);

  return { row, state, id };
}
