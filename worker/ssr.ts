import { CAPITOL_MARK_SVG_INNER } from "../shared/capitolMark";
import { renderAppHtml } from "../src/ssrEntry";
import {
  formatBillNumber,
  getVersionStageInfo,
  type BillDetail,
  BILL_TYPE_NAMES,
  congressOrdinal,
  congressYears,
  type CongressBillsResponse,
  type RecentBillsResponse,
} from "../shared/bills";

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function injectIntoTemplate(
  template: string,
  options: {
    title: string;
    description: string;
    canonicalUrl: string;
    bodyHtml: string;
    initialData?: Record<string, unknown>;
    jsonLd?: Record<string, unknown>;
  },
): string {
  const headAdditions = [
    `<link rel="canonical" href="${escHtml(options.canonicalUrl)}" />`,
    `<meta property="og:url" content="${escHtml(options.canonicalUrl)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escHtml(options.title)}" />`,
    `<meta name="twitter:description" content="${escHtml(options.description)}" />`,
    options.jsonLd
      ? `<script type="application/ld+json">${safeJsonForScript(options.jsonLd)}</script>`
      : "",
    options.initialData
      ? `<script>window.__RC_INITIAL__=${safeJsonForScript(options.initialData)};</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  let html = template;
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escHtml(options.title)}</title>`,
  );
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escHtml(options.description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escHtml(options.title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escHtml(options.description)}" />`,
  );
  html = html.replace("</head>", `    ${headAdditions}\n  </head>`);
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">${options.bodyHtml}</div>`,
  );
  return html;
}

const HOME_FEED_TITLES: Record<string, string> = {
  "/passed": "Recently passed bills",
  "/noteworthy": "Noteworthy bills",
};

/** Homepage and its tab permalinks (/recent, /passed, /noteworthy). */
export function renderHomeSsr(
  template: string,
  origin: string,
  path: string,
  feed: RecentBillsResponse,
): string {
  // /recent is the default tab, so it shares the homepage's canonical URL.
  const canonicalUrl = `${origin}${path === "/recent" ? "/" : path}`;
  const tabTitle = HOME_FEED_TITLES[path];
  const title = tabTitle
    ? `${tabTitle} | RedlineCongress.org`
    : "RedlineCongress.org — Track Every Word Changed in U.S. Legislation";
  const description =
    "Read and redline U.S. Congressional bills across every legislative stage in the House and Senate.";

  const initialData = { recent: feed };
  const bodyHtml = renderAppHtml(path, initialData);

  return injectIntoTemplate(template, {
    title,
    description,
    canonicalUrl,
    bodyHtml,
    initialData,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "RedlineCongress.org",
      url: canonicalUrl,
      description,
      creator: {
        "@type": "Organization",
        name: "Revise",
        url: "https://revise.io",
      },
    },
  });
}

export function renderBillSsr(
  template: string,
  origin: string,
  bill: BillDetail,
  spec?: string,
): string {
  const numLabel = formatBillNumber(bill.type, bill.number);
  const basePath = `/${bill.congress}/${bill.type}/${bill.number}`;
  const canonicalPath = spec ? `${basePath}/${spec.toLowerCase()}` : basePath;
  const canonicalUrl = `${origin}${canonicalPath}`;

  let stageSummary = "";
  if (spec && spec.includes("..")) {
    const [from, to] = spec.toLowerCase().split("..");
    stageSummary = ` (${from.toUpperCase()} → ${to.toUpperCase()} redline)`;
  } else if (bill.versions.length >= 2) {
    const prev = bill.versions[bill.versions.length - 2];
    const latest = bill.versions[bill.versions.length - 1];
    stageSummary = ` (${prev.code.toUpperCase()} → ${latest.code.toUpperCase()} redline)`;
  }

  const title = `${numLabel} — ${bill.title}${stageSummary} | RedlineCongress.org`;
  const description = [
    `Compare word-level tracked changes in ${numLabel} (${bill.congress}th Congress): ${bill.title}.`,
    bill.sponsorName ? `Sponsored by ${bill.sponsorName}.` : "",
    bill.versions.length > 0
      ? `${bill.versions.length} legislative text ${bill.versions.length === 1 ? "stage" : "stages"} available.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const versionsHtml = bill.versions
    .map((v, idx) => {
      const info = getVersionStageInfo(v.code);
      const href =
        idx === 0
          ? `${basePath}/${v.code}`
          : `${basePath}/${bill.versions[idx - 1].code}..${v.code}`;
      return `<li><a href="${escHtml(href)}">${escHtml(v.type || info.label)} (${escHtml(v.code.toUpperCase())})${v.date ? ` — ${escHtml(v.date)}` : ""}</a></li>`;
    })
    .join("");

  const bodyHtml = `<div class="rc-workspace">
    <header class="rc-header rc-header--full">
      <div class="rc-header-inner">
        <div class="rc-header-left">
          <a href="/" class="rc-brand" aria-label="RedlineCongress.org"><svg class="rc-brand-mark" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${CAPITOL_MARK_SVG_INNER}</svg><span class="rc-brand-name rc-hide-sm" aria-hidden="true"><span class="rc-brand-del">Redline</span><span class="rc-brand-ins">Congress</span>.org</span></a>
          <span class="rc-header-sep rc-hide-sm" aria-hidden="true">/</span>
          <span class="rc-header-page-label">${escHtml(numLabel)}</span>
          <h1 class="rc-header-page-title" style="margin:0;font-weight:400">${escHtml(bill.title)}</h1>
        </div>
        <div class="rc-header-actions">
          ${bill.congressUrl ? `<a href="${escHtml(bill.congressUrl)}" class="rc-btn rc-btn-secondary rc-btn-sm rc-hide-sm" rel="noopener">Congress.gov</a>` : ""}
        </div>
      </div>
    </header>
    <main style="padding:24px;max-width:860px;margin:0 auto">
      <p>${escHtml(description)}</p>
      ${bill.latestActionText ? `<p><strong>Latest Action:</strong> ${escHtml(bill.latestActionText)}</p>` : ""}
      ${bill.summaryText ? `<p>${escHtml(bill.summaryText)}</p>` : ""}
      <h2>Version History</h2>
      <ul>${versionsHtml}</ul>
      <div class="rc-credit"><span>Data from <a href="https://www.congress.gov" rel="noopener">Congress.gov</a></span><span class="rc-credit-sep" aria-hidden="true">·</span><span>Documents diffed and rendered with <a href="https://revise.io/sdk" rel="noopener">Revise SDK</a></span></div>
    </main>
  </div>`;

  return injectIntoTemplate(template, {
    title,
    description,
    canonicalUrl,
    bodyHtml,
    initialData: {
      bill,
    },
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Legislation",
      name: `${numLabel}: ${bill.title}`,
      legislationIdentifier: `${bill.congress}-${bill.type.toUpperCase()}-${bill.number}`,
      url: canonicalUrl,
      ...(bill.introducedDate ? { datePublished: bill.introducedDate } : {}),
      ...(bill.congressUrl ? { sameAs: bill.congressUrl } : {}),
      isBasedOn: bill.congressUrl ?? "https://www.congress.gov",
    },
  });
}

/** Plural list heading for a bill type, e.g. "House Joint Resolutions". */
export function billTypeListName(type: string): string {
  const name = BILL_TYPE_NAMES[type as keyof typeof BILL_TYPE_NAMES] ?? type.toUpperCase();
  return `${name}s`;
}

/** /:congress and /:congress/:type list pages (crawlable links to every bill). */
export function renderCongressListSsr(
  template: string,
  origin: string,
  data: CongressBillsResponse,
): string {
  const { congress, type, total, after } = data;
  const ordinal = congressOrdinal(congress);
  const basePath = type ? `/${congress}/${type}` : `/${congress}`;
  const cursorHref = (cursor: string) => `${basePath}?after=${encodeURIComponent(cursor)}`;
  const canonicalUrl = `${origin}${after ? cursorHref(after) : basePath}`;
  const totalText = total !== null ? total.toLocaleString("en-US") : null;
  const title = type
    ? `${billTypeListName(type)} · ${ordinal} Congress | RedlineCongress.org`
    : `${ordinal} Congress (${congressYears(congress)}) | RedlineCongress.org`;
  const description = `${totalText ? `All ${totalText}` : "All"} ${
    type ? billTypeListName(type).toLowerCase() : "bills and resolutions"
  } from the ${ordinal} Congress (${congressYears(congress)}), newest activity first, with word-level redlines between every published version.`;

  const path = after ? `${basePath}?after=${encodeURIComponent(after)}` : basePath;
  const bodyHtml = renderAppHtml(path, { congressList: data });

  return injectIntoTemplate(template, {
    title,
    description,
    canonicalUrl,
    bodyHtml,
    initialData: { congressList: data },
  });
}
