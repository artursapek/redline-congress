import { useCallback, useState } from "react";

/** "revise" = red deletions / green insertions; "word" = all red (Word redline). */
export type DiffStyle = "revise" | "word";

const STORAGE_KEY = "rc-diff-style";

/**
 * Reflect the style on <html data-diff-style> so CSS (e.g. the redlined brand
 * name) renders correctly. index.html sets the same attribute before first
 * paint, so there's no flash on load.
 */
function applyToDocument(style: DiffStyle) {
  if (typeof document === "undefined") return;
  if (style === "word") document.documentElement.setAttribute("data-diff-style", "word");
  else document.documentElement.removeAttribute("data-diff-style");
}

export function readDiffStyle(): DiffStyle {
  if (typeof window === "undefined") return "revise";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "word" ? "word" : "revise";
  } catch {
    return "revise";
  }
}

/** The user's diff style, persisted in localStorage across visits. */
export function useDiffStyle(): [DiffStyle, (style: DiffStyle) => void] {
  const [style, setStyle] = useState<DiffStyle>(readDiffStyle);
  const update = useCallback((next: DiffStyle) => {
    setStyle(next);
    applyToDocument(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page only.
    }
  }, []);
  return [style, update];
}
