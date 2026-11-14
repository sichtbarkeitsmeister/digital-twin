"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A true/false setting the person made in the browser (a collapsed panel), remembered per browser.
 * Starts as `false` on the server and in the first render, then takes the stored value, so the
 * page renders the same on both sides. Storage that is blocked or missing only means: not remembered.
 */
export function usePersistedFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1" || stored === "0") setValue(stored === "1");
    } catch {
      // Not remembered, still works.
    }
  }, [key]);

  const set = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not remembered, still switched.
      }
    },
    [key],
  );

  return [value, set];
}
