import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CURRENT_CONGRESS,
  parseBillQuery,
  type BillSummary,
  type BillType,
} from "../../shared/bills";
import { searchBills } from "./api";

/**
 * Bill search driven by the ?q= URL parameter, so searches are permalinkable
 * and back/forward restores them. Optionally scoped to a Congress / bill type.
 * Typing a bill number ("H.R. 3633") jumps straight to the bill instead.
 */
export function useUrlSearch(scope: { congress?: number; type?: BillType | null } = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = (searchParams.get("q") ?? "").trim();
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<BillSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const pendingScrollRef = useRef(Boolean(urlQuery));
  const { congress, type } = scope;

  useEffect(() => {
    setQuery(urlQuery);
    if (!urlQuery) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }

    let active = true;
    setSearching(true);
    setError(null);
    searchBills(urlQuery, { congress, type: type ?? undefined })
      .then((res) => {
        if (!active) return;
        setResults(res.directMatch ? [res.directMatch, ...res.results] : res.results);
      })
      .catch((err) => {
        if (!active) return;
        setResults([]);
        setError(
          err instanceof Error ? err.message : "Search failed. Try a bill number like H.R. 3633.",
        );
      })
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
    };
  }, [urlQuery, congress, type]);

  // Scroll the results into view once a search (typed or permalinked) settles.
  useEffect(() => {
    if (searching || results === null || !pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [searching, results]);

  const clear = () => {
    setQuery("");
    if (urlQuery) setSearchParams({});
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      clear();
      return;
    }

    const direct = parseBillQuery(trimmed);
    if (direct) {
      const target = direct.congress ?? congress ?? CURRENT_CONGRESS;
      const suffix = direct.versionCode ? `/${direct.versionCode}` : "";
      navigate(`/${target}/${direct.type}/${direct.number}${suffix}`);
      return;
    }

    pendingScrollRef.current = true;
    if (trimmed === urlQuery) {
      // Same query re-submitted: results are already loaded, just scroll.
      if (results !== null && !searching) {
        pendingScrollRef.current = false;
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    // A new search replaces any ?page= — results aren't paginated.
    setSearchParams({ q: trimmed });
  };

  return { query, setQuery, urlQuery, results, searching, error, resultsRef, submit, clear };
}
