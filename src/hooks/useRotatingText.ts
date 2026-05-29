import { useEffect, useState } from "react";

/**
 * Rotates through a list of phrases on a fixed interval. Returns the current
 * phrase, or null if `phrases` is null/empty (= rotation off; caller should
 * render its own fallback). Sequential, not random — the phrases are written
 * as the actual pipeline stages in order, so they read as a progress narration.
 *
 * Used on long loaders (1–2 min) so the user perceives ongoing work instead of
 * a frozen state. Marketer-authored copy, 10 phrases per screen.
 *
 * IMPORTANT: pass the phrases array via STATE (or a memoized reference) so its
 * identity is stable across renders. Calling `t.raw("loadingPhrases")` inline
 * on every render would re-trigger the effect and reset the rotation.
 */
export function useRotatingText(
  phrases: readonly string[] | null | undefined,
  intervalMs: number = 7000
): string | null {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!phrases || phrases.length <= 1) return;
    setI(0);
    const id = setInterval(() => {
      setI((n) => (n + 1) % phrases.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [phrases, intervalMs]);

  if (!phrases || phrases.length === 0) return null;
  return phrases[i] ?? phrases[0] ?? null;
}
