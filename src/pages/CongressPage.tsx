import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  BILL_TYPE_LABELS,
  BILL_TYPE_NAMES,
  BILL_TYPES,
  congressOrdinal,
  congressYears,
  isListableCongress,
  normalizeBillType,
  type BillType,
  type CongressBillsResponse,
} from "../../shared/bills";
import { fetchCongressBills } from "../lib/api";
import { getInitialData } from "../lib/initialData";
import { useUrlSearch } from "../lib/useUrlSearch";
import { BillListRow } from "../components/BillListRow";
import { BillSearchForm } from "../components/BillSearchForm";
import { SiteCredit } from "../components/SiteCredit";
import { SiteHeader, type HeaderCrumb } from "../components/SiteHeader";
import { Tooltip } from "../components/Tooltip";
import { HomePage } from "./HomePage";

function pluralTypeName(type: BillType): string {
  return `${BILL_TYPE_NAMES[type]}s`;
}

/** /:congress and /:congress/:type — every bill in a Congress, with scoped search. */
export const CongressPage: React.FC = () => {
  const params = useParams<{ congress: string; type?: string }>();
  const congress = Number(params.congress);
  const type = params.type ? normalizeBillType(params.type) : null;
  const valid =
    /^\d{2,3}$/.test(params.congress ?? "") &&
    isListableCongress(congress) &&
    (params.type === undefined || (type !== null && type === params.type.toLowerCase()));

  // Unknown single-segment paths (/about, /999) fall back to the homepage, as before.
  if (!valid) return <HomePage />;
  return <CongressList congress={congress} type={type} />;
};

const CongressList: React.FC<{ congress: number; type: BillType | null }> = ({
  congress,
  type,
}) => {
  const [searchParams] = useSearchParams();
  const after = searchParams.get("after") || null;
  const search = useUrlSearch({ congress, type });

  const ssr = getInitialData().congressList;
  const ssrMatches =
    ssr && ssr.congress === congress && ssr.type === type && ssr.after === after;
  const [data, setData] = useState<CongressBillsResponse | null>(ssrMatches ? ssr : null);
  const [loading, setLoading] = useState(!ssrMatches);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data && data.congress === congress && data.type === type && data.after === after) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fetchCongressBills(congress, type, after)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load bills.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [congress, type, after]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [congress, type, after]);

  const ordinal = congressOrdinal(congress);
  const heading = type ? pluralTypeName(type) : `${ordinal} Congress`;
  useEffect(() => {
    document.title = type
      ? `${heading} · ${ordinal} Congress | RedlineCongress.org`
      : `${ordinal} Congress (${congressYears(congress)}) | RedlineCongress.org`;
  }, [heading, ordinal, congress, type]);

  const crumbs: HeaderCrumb[] = type
    ? [
        { label: `${ordinal} Congress`, to: `/${congress}` },
        { label: BILL_TYPE_LABELS[type], to: `/${congress}/${type}` },
      ]
    : [{ label: `${ordinal} Congress`, to: `/${congress}` }];

  const basePath = type ? `/${congress}/${type}` : `/${congress}`;
  const total = data?.total ?? null;

  return (
    <div className="rc-shell">
      <SiteHeader crumbs={crumbs} />

      <main className="rc-list-page">
        <div className="rc-container">
          <h1 className="rc-list-title">{heading}</h1>
          <p className="rc-list-sub">
            {type ? `${ordinal} Congress · ` : ""}
            {congressYears(congress)}
            {total !== null ? ` · ${total.toLocaleString("en-US")} total` : ""}
          </p>

          <nav className="rc-type-tabs" aria-label="Bill type">
            <Link
              to={`/${congress}`}
              className="rc-type-tab"
              aria-current={type ? undefined : "page"}
            >
              All
            </Link>
            {BILL_TYPES.map((t) => (
              <Tooltip key={t} content={pluralTypeName(t)}>
                <Link
                  to={`/${congress}/${t}`}
                  className="rc-type-tab"
                  aria-current={t === type ? "page" : undefined}
                >
                  {BILL_TYPE_LABELS[t]}
                </Link>
              </Tooltip>
            ))}
          </nav>

          <BillSearchForm
            query={search.query}
            onQueryChange={search.setQuery}
            onSubmit={search.submit}
            onClear={search.clear}
            searching={search.searching}
            placeholder={`Search ${type ? `${ordinal} Congress ${pluralTypeName(type).toLowerCase()}` : `the ${ordinal} Congress`}`}
          />

          <section className="rc-list-results rc-results-anchor" ref={search.resultsRef}>
            {search.results !== null ? (
              <>
                <div className="rc-list-results-head">
                  <span>
                    {search.results.length}{" "}
                    {search.results.length === 1 ? "result" : "results"} for “{search.urlQuery}”
                  </span>
                  <button type="button" className="rc-link-btn" onClick={search.clear}>
                    Show all
                  </button>
                </div>
                {search.error && <div className="rc-bill-list rc-list-message">{search.error}</div>}
                {search.results.length === 0 ? (
                  <div className="rc-bill-list rc-list-message">No matching bills.</div>
                ) : (
                  <div className="rc-bill-list">
                    {search.results.map((bill) => (
                      <BillListRow key={bill.id} bill={bill} />
                    ))}
                  </div>
                )}
              </>
            ) : loading && !data ? (
              <div className="rc-bill-list rc-list-message">
                <div className="rc-spinner" />
              </div>
            ) : error ? (
              <div className="rc-bill-list rc-list-message" style={{ color: "var(--diff-delete-text)" }}>
                {error}
              </div>
            ) : (
              <>
                <div className="rc-bill-list" aria-busy={loading}>
                  {data?.bills.map((bill) => <BillListRow key={bill.id} bill={bill} />)}
                </div>
                {(after || data?.nextAfter) && (
                  <nav className="rc-pager" aria-label="Pagination">
                    {after ? <Link to={basePath}>← Newest</Link> : <span />}
                    <span />
                    {data?.nextAfter ? (
                      <Link to={`${basePath}?after=${encodeURIComponent(data.nextAfter)}`}>
                        Older →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="rc-footer">
        <div className="rc-footer-inner">
          <SiteCredit />
        </div>
      </footer>
    </div>
  );
};
