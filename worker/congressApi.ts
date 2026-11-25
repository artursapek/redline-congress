import {
  CONGRESS_URL_SLUGS,
  CURRENT_CONGRESS,
  extractVersionCodeFromUrl,
  formatBillNumber,
  getVersionStageInfo,
  makeBillId,
  makePackageId,
  normalizeBillType,
  parseGovInfoPackageId,
  type BillDetail,
  type BillSummary,
  type BillTextVersion,
  type BillType,
} from "../shared/bills";

const CONGRESS_BASE = "https://api.congress.gov/v3";
const GOVINFO_BASE = "https://api.govinfo.gov";

function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const MARKUP_STAGE_CODES = new Set([
  "rh",
  "rs",
  "eah",
  "eas",
  "as",
  "pp",
  "rhuc",
]);

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function congressOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function buildCongressBillUrl(
  congress: number,
  type: BillType,
  number: number,
): string {
  return `https://www.congress.gov/bill/${congressOrdinal(congress)}-congress/${CONGRESS_URL_SLUGS[type]}/${number}`;
}

interface CongressBillApiResponse {
  bill?: {
    congress: number;
    type: string;
    number: string;
    title: string;
    originChamber?: string;
    introducedDate?: string;
    updateDate?: string;
    updateDateIncludingText?: string;
    policyArea?: { name?: string };
    latestAction?: { actionDate?: string; text?: string };
    laws?: Array<{ number?: string; type?: string }>;
    sponsors?: Array<{
      fullName?: string;
      firstName?: string;
      lastName?: string;
      party?: string;
      state?: string;
    }>;
  };
}

interface CongressTextVersionsResponse {
  textVersions?: Array<{
    type: string;
    date: string | null;
    formats?: Array<{ type: string; url: string }>;
  }>;
}

interface CongressSummariesResponse {
  summaries?: Array<{
    text?: string;
    actionDate?: string;
    actionDesc?: string;
  }>;
}

/**
 * Fills in null version dates from GovInfo package summaries (dateIssued).
 * Mutates the versions in place; returns true if any date was filled.
 * Failures are ignored: a missing date is cosmetic.
 */
export async function fillMissingVersionDates(
  versions: BillTextVersion[],
  apiKey: string,
): Promise<boolean> {
  const missing = versions.filter((v) => !v.date && v.packageId);
  if (missing.length === 0) return false;
  const results = await Promise.all(
    missing.map(async (v) => {
      try {
        const res = await fetchWithTimeout(
          `${GOVINFO_BASE}/packages/${encodeURIComponent(v.packageId)}/summary?api_key=${encodeURIComponent(apiKey)}`,
          { headers: { Accept: "application/json" } },
          5000,
        );
        if (!res.ok) return false;
        const json = (await res.json()) as { dateIssued?: string };
        if (!json.dateIssued) return false;
        v.date = json.dateIssued.slice(0, 10);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

interface CongressLawListItem {
  congress: number;
  type: string;
  number: string;
  title?: string;
  originChamber?: string;
  latestAction?: { actionDate?: string; text?: string };
  laws?: Array<{ number?: string; type?: string }>;
  updateDate?: string;
}

/** Congress.gov `laws` -> "Public Law 117-58"; "" when the bill has none. */
function formatLaw(laws: Array<{ number?: string; type?: string }> | undefined): string {
  const law = laws?.find((l) => l.number);
  if (!law) return "";
  return `${law.type || "Public Law"} ${law.number}`;
}

/** "119-149" -> 149 (laws are numbered sequentially within a Congress). */
function lawSequence(item: CongressLawListItem): number {
  const n = item.laws?.[0]?.number?.split("-")[1];
  return n ? Number(n) : 0;
}

/**
 * Every bill that became law in a Congress, newest law first, from
 * Congress.gov's /law endpoint. The subrequest is edge-cached for 15 minutes.
 */
export async function fetchLawsForCongress(
  congress: number,
  apiKey: string,
): Promise<BillSummary[]> {
  const res = await fetchWithTimeout(
    `${CONGRESS_BASE}/law/${congress}?api_key=${encodeURIComponent(apiKey)}&format=json&limit=250`,
    {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 900, cacheEverything: true },
    } as RequestInit,
    10000,
  );
  if (!res.ok) throw new Error(`Congress.gov law list returned ${res.status}`);
  const json = (await res.json()) as { bills?: CongressLawListItem[] };

  return [...(json.bills ?? [])]
    .sort((a, b) => lawSequence(b) - lawSequence(a))
    .map(listItemToSummary)
    .filter((b): b is BillSummary => b !== null);
}

/**
 * Congress.gov list items (from /bill and /law) carry metadata but no text
 * versions; callers merge in stored version history where available.
 */
function listItemToSummary(item: CongressLawListItem): BillSummary | null {
  const type = normalizeBillType(item.type);
  const number = Number(item.number);
  if (!type || !Number.isInteger(number)) return null;
  return {
    id: makeBillId(item.congress, type, number),
    congress: item.congress,
    type,
    number,
    title: item.title || formatBillNumber(type, number),
    shortTitle: item.title ?? null,
    originChamber: item.originChamber ?? (type.startsWith("h") ? "House" : "Senate"),
    latestActionDate: item.latestAction?.actionDate ?? null,
    latestActionText: item.latestAction?.text ?? null,
    latestVersionCode: null,
    latestVersionDate: null,
    versionCount: 0,
    hasMarkupVersion: false,
    versions: [],
    congressUrl: buildCongressBillUrl(item.congress, type, number),
    updatedAt: item.updateDate ?? item.latestAction?.actionDate ?? "",
    // The /law list only contains laws; the /bill list omits `laws`, so leave unknown.
    publicLaw: item.laws?.length ? formatLaw(item.laws) : null,
  };
}

/** Number of bills in a Congress (optionally one type). Edge-cached for an hour. */
export async function fetchCongressBillCount(
  congress: number,
  type: BillType | null,
  apiKey: string,
): Promise<number | null> {
  const path = type ? `bill/${congress}/${type}` : `bill/${congress}`;
  const res = await fetchWithTimeout(
    `${CONGRESS_BASE}/${path}?api_key=${encodeURIComponent(apiKey)}&format=json&limit=1`,
    {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit,
    8000,
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { pagination?: { count?: number } };
  return json.pagination?.count ?? null;
}

/**
 * Bills in a Congress (optionally one type) ordered by their most recently
 * published text version — a real activity signal, unlike Congress.gov's
 * updateDate, which bulk re-saves thousands of records a day. Pages with
 * GovInfo's opaque offsetMark cursor; each page is one batch of text
 * versions collapsed to unique bills (newest version per bill).
 */
export async function fetchRecentlyPublishedBills(
  congress: number,
  type: BillType | null,
  after: string | null,
  apiKey: string,
  batchSize = 50,
): Promise<{ bills: BillSummary[]; nextAfter: string | null }> {
  const res = await fetchWithTimeout(
    `${GOVINFO_BASE}/search?api_key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `collection:BILLS congress:${congress}${type ? ` billtype:${type}` : ""}`,
        sorts: [{ field: "publishdate", sortOrder: "DESC" }],
        pageSize: batchSize,
        offsetMark: after || "*",
      }),
    },
    10000,
  );
  if (!res.ok) throw new Error(`GovInfo search API returned ${res.status}`);
  const data = (await res.json()) as {
    offsetMark?: string;
    results?: Array<{ packageId?: string; title?: string; dateIssued?: string }>;
  };

  const seen = new Set<string>();
  const bills: BillSummary[] = [];
  for (const r of data.results ?? []) {
    const parsed = r.packageId ? parseGovInfoPackageId(r.packageId) : null;
    if (!parsed) continue;
    const id = makeBillId(parsed.congress, parsed.type, parsed.number);
    if (seen.has(id)) continue; // results are newest-first, so the first hit is the latest version
    seen.add(id);
    const date = r.dateIssued ? r.dateIssued.slice(0, 10) : null;
    bills.push({
      id,
      congress: parsed.congress,
      type: parsed.type,
      number: parsed.number,
      title: r.title || formatBillNumber(parsed.type, parsed.number),
      shortTitle: r.title ?? null,
      originChamber: parsed.type.startsWith("h") ? "House" : "Senate",
      latestVersionCode: parsed.versionCode,
      latestVersionDate: date,
      versionCount: 0,
      hasMarkupVersion: false,
      versions: [],
      congressUrl: buildCongressBillUrl(parsed.congress, parsed.type, parsed.number),
      updatedAt: date ?? "",
    });
  }
  const more = (data.results?.length ?? 0) >= batchSize && data.offsetMark;
  return { bills, nextAfter: more ? data.offsetMark! : null };
}

export async function fetchBillFromCongressApi(
  congress: number,
  type: BillType,
  number: number,
  apiKey: string,
  options: { includeSummary?: boolean } = {},
): Promise<BillDetail | null> {
  const keyParam = `api_key=${encodeURIComponent(apiKey)}&format=json`;
  const billUrl = `${CONGRESS_BASE}/bill/${congress}/${type}/${number}?${keyParam}`;
  const textUrl = `${CONGRESS_BASE}/bill/${congress}/${type}/${number}/text?${keyParam}`;
  const summariesUrl = `${CONGRESS_BASE}/bill/${congress}/${type}/${number}/summaries?${keyParam}`;

  const [billRes, textRes, summaryRes] = await Promise.all([
    fetchWithTimeout(billUrl, { headers: { Accept: "application/json" } }, 8000),
    fetchWithTimeout(textUrl, { headers: { Accept: "application/json" } }, 8000),
    options.includeSummary
      ? fetchWithTimeout(
          summariesUrl,
          { headers: { Accept: "application/json" } },
          6000,
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (billRes.status === 404) return null;
  if (!billRes.ok) {
    throw new Error(`Congress.gov API returned ${billRes.status} for ${congress}/${type}/${number}`);
  }

  const billJson = (await billRes.json()) as CongressBillApiResponse;
  const b = billJson.bill;
  if (!b) return null;

  const textJson = textRes.ok
    ? ((await textRes.json()) as CongressTextVersionsResponse)
    : { textVersions: [] };

  const summaryJson =
    summaryRes && summaryRes.ok
      ? ((await summaryRes.json()) as CongressSummariesResponse)
      : { summaries: [] };

  const rawVersions = textJson.textVersions ?? [];
  const versions: BillTextVersion[] = [];
  const seenCodes = new Set<string>();

  for (const v of rawVersions) {
    const formats = v.formats ?? [];
    const xmlFmt = formats.find((f) => /xml/i.test(f.type));
    const pdfFmt = formats.find((f) => /pdf/i.test(f.type));
    const htmFmt = formats.find((f) => /text|htm/i.test(f.type));
    const anyUrl = xmlFmt?.url ?? pdfFmt?.url ?? htmFmt?.url ?? "";
    const code = extractVersionCodeFromUrl(anyUrl);
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    versions.push({
      code,
      type: v.type || getVersionStageInfo(code).label,
      date: v.date ? v.date.slice(0, 10) : null,
      xmlUrl: xmlFmt?.url ?? null,
      pdfUrl: pdfFmt?.url ?? null,
      htmlUrl: htmFmt?.url ?? null,
      packageId: makePackageId(congress, type, number, code),
    });
  }

  // Congress.gov omits the date on some text versions (almost always the
  // enrolled bill); GovInfo's package metadata has the publication date.
  await fillMissingVersionDates(versions, apiKey);

  // Sort chronologically (oldest -> newest), breaking ties by legislative stage order
  versions.sort((a, bVer) => {
    if (a.date && bVer.date && a.date !== bVer.date) {
      return a.date.localeCompare(bVer.date);
    }
    return getVersionStageInfo(a.code).order - getVersionStageInfo(bVer.code).order;
  });

  const latestVersion = versions[versions.length - 1] ?? null;
  const sponsor = b.sponsors?.[0];
  const sponsorName =
    sponsor?.fullName ||
    [sponsor?.firstName, sponsor?.lastName].filter(Boolean).join(" ") ||
    null;

  const latestSummaryRaw = summaryJson.summaries?.[summaryJson.summaries.length - 1]?.text;
  const summaryText = latestSummaryRaw ? stripHtml(latestSummaryRaw).slice(0, 1200) : null;

  const hasMarkupVersion = versions.some((v) => MARKUP_STAGE_CODES.has(v.code));

  return {
    id: makeBillId(congress, type, number),
    congress,
    type,
    number,
    title: b.title || formatBillNumber(type, number),
    shortTitle: b.title && b.title.length <= 160 ? b.title : null,
    originChamber: b.originChamber ?? (type.startsWith("h") ? "House" : "Senate"),
    sponsorName,
    sponsorParty: sponsor?.party ?? null,
    sponsorState: sponsor?.state ?? null,
    policyArea: b.policyArea?.name ?? null,
    introducedDate: b.introducedDate ?? null,
    latestActionDate: b.latestAction?.actionDate ?? null,
    latestActionText: b.latestAction?.text ?? null,
    latestVersionCode: latestVersion?.code ?? null,
    latestVersionDate: latestVersion?.date ?? null,
    versionCount: versions.length,
    hasMarkupVersion,
    versions,
    summaryText,
    congressUrl: buildCongressBillUrl(congress, type, number),
    updatedAt: b.updateDateIncludingText || b.updateDate || new Date().toISOString().slice(0, 10),
    publicLaw: formatLaw(b.laws),
  };
}

export interface GovInfoPackageCandidate {
  congress: number;
  type: BillType;
  number: number;
  versionCode: string;
  packageId: string;
  title: string;
  dateIssued: string;
  lastModified: string;
}

/**
 * Fetches recently published XML bill text packages from GovInfo's BILLS collection.
 * This surfaces bills that actually received a new version (RH, EH, RS, ENR, etc.)
 * with a single API call.
 */
export async function fetchRecentGovInfoPackages(
  apiKey: string,
  daysBack = 45,
  pageSize = 100,
): Promise<GovInfoPackageCandidate[]> {
  const start = new Date(Date.now() - daysBack * 86400 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const url = `${GOVINFO_BASE}/collections/BILLS/${start}?pageSize=${pageSize}&offsetMark=*&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/json" } },
    10000,
  );
  if (!res.ok) {
    throw new Error(`GovInfo collections API returned ${res.status}`);
  }
  const data = (await res.json()) as {
    packages?: Array<{
      packageId: string;
      title?: string;
      dateIssued?: string;
      lastModified?: string;
    }>;
  };

  const out: GovInfoPackageCandidate[] = [];
  for (const pkg of data.packages ?? []) {
    const parsed = parseGovInfoPackageId(pkg.packageId);
    if (!parsed) continue;
    out.push({
      ...parsed,
      packageId: pkg.packageId,
      title: pkg.title || formatBillNumber(parsed.type, parsed.number),
      dateIssued: pkg.dateIssued || "",
      lastModified: pkg.lastModified || "",
    });
  }
  return out;
}

const SEARCH_STOPWORDS = new Set(["a", "an", "and", "act", "for", "in", "of", "on", "the", "to"]);

/** Lowercased, regex-safe query words minus filler like "act" / "the". */
function searchTerms(query: string): string[] {
  return (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => !SEARCH_STOPWORDS.has(t),
  );
}

/**
 * Searches all Congressional bills via GovInfo Search API and deduplicates
 * matching text packages down to unique bills.
 */
export async function searchGovInfoBills(
  query: string,
  apiKey: string,
  limit = 20,
  scope: { congress?: number; type?: BillType } = {},
): Promise<BillSummary[]> {
  const sanitized = query.replace(/["\\]/g, " ").trim();
  if (!sanitized) return [];
  const scopeTerms = [
    scope.congress ? `congress:${scope.congress}` : "",
    scope.type ? `billtype:${scope.type}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const res = await fetchWithTimeout(
    `${GOVINFO_BASE}/search?api_key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `collection:BILLS ${scopeTerms ? `${scopeTerms} ` : ""}${sanitized}`,
        // GovInfo defaults to newest-first; ask for relevance instead, and pull
        // enough text versions to re-rank at the bill level below.
        sorts: [{ field: "score", sortOrder: "DESC" }],
        pageSize: 100,
        offsetMark: "*",
      }),
    },
    10000,
  );

  if (!res.ok) {
    throw new Error(`GovInfo search API returned ${res.status}`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      packageId?: string;
      title?: string;
      dateIssued?: string;
      lastModified?: string;
      governmentAuthor?: string[];
    }>;
  };

  const byBill = new Map<string, BillSummary>();
  // Best (lowest) GovInfo relevance rank among each bill's text versions.
  const bestRank = new Map<string, number>();

  for (const [rank, r] of (data.results ?? []).entries()) {
    if (!r.packageId) continue;
    const parsed = parseGovInfoPackageId(r.packageId);
    if (!parsed) continue;
    const id = makeBillId(parsed.congress, parsed.type, parsed.number);
    if (!bestRank.has(id)) bestRank.set(id, rank);
    const stageInfo = getVersionStageInfo(parsed.versionCode);
    const version: BillTextVersion = {
      code: parsed.versionCode,
      type: stageInfo.label,
      date: r.dateIssued ?? null,
      xmlUrl: `https://www.govinfo.gov/content/pkg/${r.packageId}/xml/${r.packageId}.xml`,
      pdfUrl: `https://www.govinfo.gov/content/pkg/${r.packageId}/pdf/${r.packageId}.pdf`,
      packageId: r.packageId,
    };

    const existing = byBill.get(id);
    if (existing) {
      if (!existing.versions.some((v) => v.code === version.code)) {
        existing.versions.push(version);
        existing.versions.sort(
          (a, b) =>
            getVersionStageInfo(a.code).order - getVersionStageInfo(b.code).order,
        );
        existing.versionCount = existing.versions.length;
        const latest = existing.versions[existing.versions.length - 1];
        existing.latestVersionCode = latest.code;
        existing.latestVersionDate = latest.date;
        if (MARKUP_STAGE_CODES.has(version.code)) {
          existing.hasMarkupVersion = true;
        }
      }
    } else {
      byBill.set(id, {
        id,
        congress: parsed.congress,
        type: parsed.type,
        number: parsed.number,
        title: r.title || formatBillNumber(parsed.type, parsed.number),
        shortTitle: r.title || null,
        originChamber: parsed.type.startsWith("h") ? "House" : "Senate",
        latestVersionCode: version.code,
        latestVersionDate: version.date,
        versionCount: 1,
        hasMarkupVersion: MARKUP_STAGE_CODES.has(version.code),
        versions: [version],
        congressUrl: buildCongressBillUrl(
          parsed.congress,
          parsed.type,
          parsed.number,
        ),
        updatedAt: (r.lastModified || r.dateIssued || "").slice(0, 10),
      });
    }
  }

  const terms = searchTerms(sanitized);
  const newestCongress = Math.max(0, ...Array.from(byBill.values(), (b) => b.congress));
  const score = (bill: BillSummary): number => {
    // GovInfo relevance, decaying with rank.
    let s = 1 / (1 + (bestRank.get(bill.id) ?? 100) / 8);
    // Enacted laws are what people are usually looking for.
    if (bill.versions.some((v) => v.code === "enr")) s *= 2.5;
    // Every meaningful query word appears in the title (word-prefix match).
    const title = bill.title.toLowerCase();
    if (terms.length > 0 && terms.every((t) => new RegExp(`\\b${t}`).test(title))) {
      s *= 2;
    }
    // Preference for current legislation, fading out over ~12 years.
    s *= 1 + 0.5 * Math.max(0, 1 - (newestCongress - bill.congress) / 6);
    return s;
  };

  return Array.from(byBill.values())
    .map((bill) => ({ bill, s: score(bill) }))
    .sort((a, b) => b.s - a.s)
    .map(({ bill }) => bill)
    .slice(0, limit);
}

export interface OfficialBillSource {
  body: string;
  format: "xml" | "htm";
  contentType: string;
}

/**
 * Fetches official bill text from GovInfo / Congress.gov:
 * 1. Prefers official Congressional XML (available for 113th Congress–present and some 110th–112th bills).
 * 2. Falls back seamlessly to official GPO Formatted Text (`.htm`, available back to the 103rd Congress / 1993)
 *    so historic bills like the USA PATRIOT Act (107th) or ACA (111th) render and diff cleanly.
 */
export async function fetchOfficialBillSource(
  packageId: string,
  xmlUrl: string | null,
  htmlUrl: string | null,
  apiKey?: string,
): Promise<OfficialBillSource | null> {
  const xmlCandidates: string[] = [];
  if (apiKey) {
    xmlCandidates.push(
      `${GOVINFO_BASE}/packages/${encodeURIComponent(packageId)}/xml?api_key=${encodeURIComponent(apiKey)}`,
    );
  }
  xmlCandidates.push(
    `https://www.govinfo.gov/content/pkg/${encodeURIComponent(packageId)}/xml/${encodeURIComponent(packageId)}.xml`,
  );
  if (xmlUrl) xmlCandidates.push(xmlUrl);

  for (const url of xmlCandidates) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: "application/xml, text/xml, */*",
            "User-Agent": "RedlineCongress/1.0 (+https://redlinecongress.org)",
          },
        },
        15000,
      );
      if (!res.ok) continue;
      const text = await res.text();
      if (
        text.includes("<bill") ||
        text.includes("<resolution") ||
        text.includes("<amendment-doc")
      ) {
        return {
          body: text,
          format: "xml",
          contentType: "application/xml; charset=utf-8",
        };
      }
    } catch {
      // Try next upstream mirror
    }
  }

  // Fallback: Official GPO Formatted Text (.htm) — covers 103rd Congress (1993) to present
  const htmCandidates: string[] = [];
  if (apiKey) {
    htmCandidates.push(
      `${GOVINFO_BASE}/packages/${encodeURIComponent(packageId)}/htm?api_key=${encodeURIComponent(apiKey)}`,
    );
  }
  htmCandidates.push(
    `https://www.govinfo.gov/content/pkg/${encodeURIComponent(packageId)}/html/${encodeURIComponent(packageId)}.htm`,
  );
  if (htmlUrl) htmCandidates.push(htmlUrl);

  for (const url of htmCandidates) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            Accept: "text/html, text/plain, */*",
            "User-Agent": "RedlineCongress/1.0 (+https://redlinecongress.org)",
          },
        },
        15000,
      );
      if (!res.ok) continue;
      const text = await res.text();
      if (
        /<pre\b/i.test(text) &&
        (/CONGRESS|Be it enacted|Resolved|SECTION\s+\d|SEC\.\s+\d/i.test(text) ||
          text.length > 400)
      ) {
        return {
          body: text,
          format: "htm",
          contentType: "text/html; charset=utf-8",
        };
      }
    } catch {
      // Try next upstream mirror
    }
  }

  return null;
}

export async function fetchOfficialBillXml(
  packageId: string,
  xmlUrl: string | null,
  apiKey?: string,
): Promise<string | null> {
  const result = await fetchOfficialBillSource(packageId, xmlUrl, null, apiKey);
  return result?.body ?? null;
}

export async function fetchRecentCongressBillsList(
  apiKey: string,
  congress = CURRENT_CONGRESS,
  limit = 40,
): Promise<Array<{ congress: number; type: BillType; number: number; title: string }>> {
  const url = `${CONGRESS_BASE}/bill/${congress}?limit=${limit}&sort=updateDate+desc&api_key=${encodeURIComponent(apiKey)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    bills?: Array<{
      congress: number;
      type: string;
      number: string;
      title?: string;
    }>;
  };
  const out: Array<{ congress: number; type: BillType; number: number; title: string }> = [];
  for (const b of data.bills ?? []) {
    const type = normalizeBillType(b.type);
    const num = Number(b.number);
    if (!type || !Number.isFinite(num)) continue;
    out.push({
      congress: b.congress || congress,
      type,
      number: num,
      title: b.title || formatBillNumber(type, num),
    });
  }
  return out;
}
