import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CURRENT_CONGRESS,
  congressOrdinal,
  type BillSummary,
  type HomeFeed,
} from "../../shared/bills";
import { fetchRecentBills } from "../lib/api";
import { getInitialData } from "../lib/initialData";
import { useUrlSearch } from "../lib/useUrlSearch";
import { BillSearchForm } from "../components/BillSearchForm";
import { BillListRow } from "../components/BillListRow";
import { HeroRedlineDemo } from "../components/HeroRedlineDemo";
import { SiteHeader } from "../components/SiteHeader";
import { SiteCredit } from "../components/SiteCredit";

/** Homepage feed tabs; each has a permalink that opens the page scrolled to the list. */
const FEED_TABS: ReadonlyArray<{ feed: HomeFeed; label: string; path: string }> = [
  { feed: "active", label: "Recently active", path: "/recent" },
  { feed: "law", label: "Recently passed", path: "/passed" },
  { feed: "noteworthy", label: "Noteworthy bills", path: "/noteworthy" },
];

function feedForPath(pathname: string): HomeFeed {
  return FEED_TABS.find((t) => t.path === pathname)?.feed ?? "active";
}

/** Header: the three feed tabs (they scroll down to the list), then recent Congresses. */
const HEADER_FEED_LINKS = [
  { label: "Active", to: "/recent", state: { scrollToFeed: true } },
  { label: "Passed", to: "/passed", state: { scrollToFeed: true } },
  { label: "Noteworthy", to: "/noteworthy", state: { scrollToFeed: true } },
];

const HEADER_CONGRESS_GROUP = {
  label: "Congress",
  items: [0, 1, 2].map((offset) => {
    const congress = CURRENT_CONGRESS - offset;
    return { label: congressOrdinal(congress), to: `/${congress}` };
  }),
};

const QUICK_EXAMPLES = [
  { label: "H.R. 3633 · CLARITY Act", path: "/119/hr/3633" },
  { label: "S. 919 · GENIUS Act", path: "/119/s/919" },
  { label: "Patriot Act", path: "/107/hr/3162" },
];

export const HomePage: React.FC = () => {
  const location = useLocation();
  const { pathname, search: locationSearch } = location;
  const filter = feedForPath(pathname);
  const initial = getInitialData().recent;
  // Server data is only usable if it was rendered for this same tab.
  const ssrRecent = initial && (initial.feed ?? "active") === filter ? initial : undefined;
  const [bills, setBills] = useState<BillSummary[]>(ssrRecent?.bills ?? []);
  const [loading, setLoading] = useState(!ssrRecent?.bills?.length);
  const [error, setError] = useState<string | null>(null);

  const search = useUrlSearch();
  const searchResults = search.results;

  // The server already rendered this tab's feed; don't swap it for a spinner
  // and refetch on mount (that was a visible layout shift).
  const skipFirstFetch = useRef(Boolean(ssrRecent?.bills?.length));

  // Landing on /recent, /passed or /noteworthy: jump down to the list once.
  // (A ?q= search scrolls to its own results instead.)
  const landedOnTab = useRef(
    FEED_TABS.some((t) => t.path === pathname) && !new URLSearchParams(locationSearch).get("q"),
  );
  useEffect(() => {
    if (!landedOnTab.current) return;
    landedOnTab.current = false;
    search.resultsRef.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Header feed links (Active / Passed / Noteworthy) also scroll down when
  // already on the homepage; the in-list tabs don't, so switching tabs doesn't jump.
  useEffect(() => {
    if ((location.state as { scrollToFeed?: boolean } | null)?.scrollToFeed) {
      search.resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    skipFirstFetch.current = false;
    let active = true;
    setLoading(true);
    setError(null);
    fetchRecentBills(filter, 30)
      .then((data) => {
        if (!active) return;
        setBills(data.bills);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load bills.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter]);

  return (
    <div className="rc-shell">
      <SiteHeader nav={HEADER_FEED_LINKS} navGroup={HEADER_CONGRESS_GROUP} />

      <main>
        {/* Hero */}
        <section className="rc-hero">
          <div className="rc-hero-container">
            <div className="rc-hero-grid">
              <div>
                <h1 className="rc-hero-title">
                  Tracked changes for U.S. legislation
                </h1>

                <p className="rc-hero-subtitle">
                  A public mirror of bills going through the
                  U.S. House and Senate, showing how they change
                  at every stage.
                </p>

                <BillSearchForm
                  query={search.query}
                  onQueryChange={search.setQuery}
                  onSubmit={search.submit}
                  onClear={search.clear}
                  searching={search.searching}
                />

                <div className="rc-quick-chips">
                  <span>Try:</span>
                  {QUICK_EXAMPLES.map((ex) => (
                    <a
                      key={ex.path}
                      type="button"
                      className="rc-chip"
                      href={ex.path}
                    >
                      {ex.label}
                    </a>
                  ))}
                </div>
              </div>

              <HeroRedlineDemo />
            </div>
          </div>
        </section>

        {/* Search results or Recently Revised Feed */}
        <section className="rc-band-warm rc-results-anchor" ref={search.resultsRef}>
          <div className="rc-container">
            {searchResults !== null ? (
              <>
                <div className="rc-section-head">
                  <div>
                    <h2 className="rc-section-title">
                      Results for “{search.urlQuery}”
                    </h2>
                    <p className="rc-section-sub">
                      {searchResults.length} matching{" "}
                      {searchResults.length === 1 ? "bill" : "bills"} across
                      Congressional XML archives
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rc-btn rc-btn-secondary rc-btn-sm"
                    onClick={search.clear}
                  >
                    Back to recent bills
                  </button>
                </div>

                {search.error && (
                  <div className="rc-bill-list" style={{ padding: 20 }}>
                    {search.error}
                  </div>
                )}

                {searchResults.length === 0 ? (
                  <div
                    className="rc-bill-list"
                    style={{ padding: 28, color: "var(--content-muted)" }}
                  >
                    No matching bills found. You can jump directly to any bill
                    by entering its number (for example, <strong>H.R. 3633</strong>{" "}
                    or <strong>118 S. 4638</strong>).
                  </div>
                ) : (
                  <div className="rc-bill-list">
                    {searchResults.map((bill) => (
                      <BillListRow key={bill.id} bill={bill} />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="rc-feed-tabs" role="tablist" aria-label="Bill feed">
                  {FEED_TABS.map((tab) => (
                    <Link
                      key={tab.feed}
                      to={tab.path}
                      role="tab"
                      className="rc-feed-tab"
                      aria-selected={filter === tab.feed}
                    >
                      {tab.label}
                    </Link>
                  ))}
                </div>

                {loading ? (
                  <div
                    className="rc-bill-list"
                    style={{
                      padding: 40,
                      alignItems: "center",
                      gap: 10,
                      color: "var(--content-muted)",
                    }}
                  >
                    <div className="rc-spinner" />
                    <span>Loading recent Congressional bills…</span>
                  </div>
                ) : error ? (
                  <div
                    className="rc-bill-list"
                    style={{ padding: 24, color: "var(--diff-delete-text)" }}
                  >
                    {error}
                  </div>
                ) : bills.length === 0 ? (
                  <div
                    className="rc-bill-list"
                    style={{ padding: 28, color: "var(--content-muted)" }}
                  >
                    {filter === "law"
                      ? "No bills have become law recently."
                      : "No recently active bills yet."}
                  </div>
                ) : (
                  <div className="rc-bill-list">
                    {bills.map((bill) => (
                      <BillListRow key={bill.id} bill={bill} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

      </main>

      <footer className="rc-footer">
        <div className="rc-footer-inner">
          <SiteCredit />
        </div>
      </footer>
    </div>
  );
};
