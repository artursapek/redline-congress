export type BillType =
  | "hr"
  | "s"
  | "hres"
  | "sres"
  | "hjres"
  | "sjres"
  | "hconres"
  | "sconres";

export const BILL_TYPES: readonly BillType[] = [
  "hr",
  "s",
  "hjres",
  "sjres",
  "hconres",
  "sconres",
  "hres",
  "sres",
] as const;

export const BILL_TYPE_LABELS: Record<BillType, string> = {
  hr: "H.R.",
  s: "S.",
  hres: "H.Res.",
  sres: "S.Res.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
};

export const BILL_TYPE_NAMES: Record<BillType, string> = {
  hr: "House Bill",
  s: "Senate Bill",
  hres: "House Resolution",
  sres: "Senate Resolution",
  hjres: "House Joint Resolution",
  sjres: "Senate Joint Resolution",
  hconres: "House Concurrent Resolution",
  sconres: "Senate Concurrent Resolution",
};

export const CONGRESS_URL_SLUGS: Record<BillType, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hres: "house-resolution",
  sres: "senate-resolution",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
};

export const CURRENT_CONGRESS = 119;

export interface VersionStageInfo {
  code: string;
  label: string;
  shortLabel: string;
  order: number;
  oftenMarkedUp?: boolean;
}

/** Canonical stage metadata for GovInfo / Congress.gov bill text version codes. */
export const VERSION_STAGES: Record<string, VersionStageInfo> = {
  ih: { code: "ih", label: "Introduced in House", shortLabel: "Introduced", order: 10 },
  is: { code: "is", label: "Introduced in Senate", shortLabel: "Introduced", order: 10 },
  ihr: { code: "ihr", label: "Introduced in House (Reprint)", shortLabel: "Introduced", order: 11 },
  isr: { code: "isr", label: "Introduced in Senate (Reprint)", shortLabel: "Introduced", order: 11 },
  ash: { code: "ash", label: "Additional Sponsors House", shortLabel: "Sponsors", order: 15 },
  rch: { code: "rch", label: "Reference Change House", shortLabel: "Ref. Change", order: 25 },
  rcs: { code: "rcs", label: "Reference Change Senate", shortLabel: "Ref. Change", order: 25 },
  hdh: { code: "hdh", label: "Held at Desk House", shortLabel: "Held (H)", order: 26 },
  hds: { code: "hds", label: "Held at Desk Senate", shortLabel: "Held (S)", order: 26 },
  cdh: { code: "cdh", label: "Committee Discharged House", shortLabel: "Discharged (H)", order: 28 },
  cds: { code: "cds", label: "Committee Discharged Senate", shortLabel: "Discharged (S)", order: 28 },
  rh: { code: "rh", label: "Reported in House", shortLabel: "Reported (H)", order: 30, oftenMarkedUp: true },
  rs: { code: "rs", label: "Reported in Senate", shortLabel: "Reported (S)", order: 30, oftenMarkedUp: true },
  rhuc: { code: "rhuc", label: "Returned to House (Unanimous Consent)", shortLabel: "Returned (H)", order: 32 },
  pch: { code: "pch", label: "Placed on Calendar House", shortLabel: "Calendar (H)", order: 35 },
  pcs: { code: "pcs", label: "Placed on Calendar Senate", shortLabel: "Calendar (S)", order: 35 },
  cph: { code: "cph", label: "Considered and Passed House", shortLabel: "Passed (H)", order: 40 },
  cps: { code: "cps", label: "Considered and Passed Senate", shortLabel: "Passed (S)", order: 40 },
  eh: { code: "eh", label: "Engrossed in House", shortLabel: "Passed House", order: 50 },
  es: { code: "es", label: "Engrossed in Senate", shortLabel: "Passed Senate", order: 50 },
  rdh: { code: "rdh", label: "Received in House", shortLabel: "Received (H)", order: 51 },
  rds: { code: "rds", label: "Received in Senate", shortLabel: "Received (S)", order: 51 },
  rfh: { code: "rfh", label: "Referred in House", shortLabel: "Referred (H)", order: 52 },
  rfs: { code: "rfs", label: "Referred in Senate", shortLabel: "Referred (S)", order: 52 },
  ath: { code: "ath", label: "Agreed to House", shortLabel: "Agreed (H)", order: 52 },
  ats: { code: "ats", label: "Agreed to Senate", shortLabel: "Agreed (S)", order: 52 },
  as: { code: "as", label: "Amendment Ordered to be Printed (Senate)", shortLabel: "Amend. (S)", order: 55, oftenMarkedUp: true },
  oph: { code: "oph", label: "Ordered to be Printed House", shortLabel: "Printed (H)", order: 56 },
  ops: { code: "ops", label: "Ordered to be Printed Senate", shortLabel: "Printed (S)", order: 56 },
  eah: { code: "eah", label: "Engrossed Amendment House", shortLabel: "House Amend.", order: 65, oftenMarkedUp: true },
  eas: { code: "eas", label: "Engrossed Amendment Senate", shortLabel: "Senate Amend.", order: 65, oftenMarkedUp: true },
  reah: { code: "reah", label: "Re-engrossed Amendment House", shortLabel: "House Amend.", order: 68, oftenMarkedUp: true },
  reas: { code: "reas", label: "Re-engrossed Amendment Senate", shortLabel: "Senate Amend.", order: 68, oftenMarkedUp: true },
  pp: { code: "pp", label: "Public Print", shortLabel: "Public Print", order: 70, oftenMarkedUp: true },
  enr: { code: "enr", label: "Enrolled Bill", shortLabel: "Enrolled", order: 90 },
  renr: { code: "renr", label: "Re-enrolled Bill", shortLabel: "Re-enrolled", order: 92 },
  pl: { code: "pl", label: "Public Law", shortLabel: "Public Law", order: 100 },
};

export function getVersionStageInfo(code: string): VersionStageInfo {
  const normalized = code.toLowerCase();
  return (
    VERSION_STAGES[normalized] ?? {
      code: normalized,
      label: normalized.toUpperCase(),
      shortLabel: normalized.toUpperCase(),
      order: 60,
    }
  );
}

export function formatBillNumber(type: BillType, number: number | string): string {
  return `${BILL_TYPE_LABELS[type]} ${number}`;
}

export function makeBillId(congress: number, type: BillType, number: number): string {
  return `${congress}:${type}:${number}`;
}

export function makePackageId(
  congress: number,
  type: BillType,
  number: number,
  versionCode: string,
): string {
  return `BILLS-${congress}${type}${number}${versionCode.toLowerCase()}`;
}

export function isValidBillType(value: string): value is BillType {
  return (BILL_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function normalizeBillType(value: string): BillType | null {
  const clean = value.toLowerCase().replace(/[^a-z]/g, "");
  if (isValidBillType(clean)) return clean;
  const map: Record<string, BillType> = {
    housebill: "hr",
    senatebill: "s",
    houseresolution: "hres",
    senateresolution: "sres",
    housejointresolution: "hjres",
    senatejointresolution: "sjres",
    houseconcurrentresolution: "hconres",
    senateconcurrentresolution: "sconres",
  };
  return map[clean] ?? null;
}

export interface ParsedPackageId {
  congress: number;
  type: BillType;
  number: number;
  versionCode: string;
}

export function parseGovInfoPackageId(packageId: string): ParsedPackageId | null {
  const match = /^BILLS-(\d{2,3})(hr|hres|hjres|hconres|s|sres|sjres|sconres)(\d+)([a-z0-9]+)$/i.exec(
    packageId.trim(),
  );
  if (!match) return null;
  const type = normalizeBillType(match[2]);
  if (!type) return null;
  return {
    congress: Number(match[1]),
    type,
    number: Number(match[3]),
    versionCode: match[4].toLowerCase(),
  };
}

export interface ParsedBillReference {
  congress?: number;
  type: BillType;
  number: number;
  versionCode?: string;
}

/**
 * Parses direct bill references from user search input:
 * - "H.R. 3633", "hr3633", "119 hr 3633", "S. 919", "H.J.Res. 42"
 * - "BILLS-119hr3633rs"
 * - "https://www.congress.gov/bill/119th-congress/house-bill/3633"
 */
export function parseBillQuery(input: string): ParsedBillReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // GovInfo package ID
  const pkg = parseGovInfoPackageId(trimmed);
  if (pkg) return pkg;

  // Congress.gov URL
  const urlMatch =
    /congress\.gov\/bill\/(\d+)(?:st|nd|rd|th)-congress\/([a-z-]+)\/(\d+)/i.exec(trimmed);
  if (urlMatch) {
    const type = normalizeBillType(urlMatch[2]);
    if (type) {
      return {
        congress: Number(urlMatch[1]),
        type,
        number: Number(urlMatch[3]),
      };
    }
  }

  // Optional leading congress number, e.g. "119 hr 3633" or "118th H.R. 1"
  const directMatch =
    /^(?:(\d{2,3})(?:st|nd|rd|th)?\s*[-/\s]+)?(h\.?\s*r\.?|s\.?|h\.?\s*res\.?|s\.?\s*res\.?|h\.?\s*j\.?\s*res\.?|s\.?\s*j\.?\s*res\.?|h\.?\s*con\.?\s*res\.?|s\.?\s*con\.?\s*res\.?)\s*#?\s*(\d+)$/i.exec(
      trimmed,
    );
  if (directMatch) {
    const type = normalizeBillType(directMatch[2]);
    if (type) {
      return {
        ...(directMatch[1] ? { congress: Number(directMatch[1]) } : {}),
        type,
        number: Number(directMatch[3]),
      };
    }
  }

  return null;
}

export function extractVersionCodeFromUrl(url: string): string | null {
  const match = /BILLS-\d+(?:hr|hres|hjres|hconres|s|sres|sjres|sconres)\d+([a-z0-9]+)\.(?:xml|htm|pdf)/i.exec(
    url,
  );
  return match ? match[1].toLowerCase() : null;
}

export interface BillTextVersion {
  code: string; // e.g. "ih", "rh", "eh", "rfs", "rs", "enr"
  type: string; // e.g. "Reported to Senate"
  date: string | null; // ISO date string
  xmlUrl: string | null;
  pdfUrl?: string | null;
  htmlUrl?: string | null;
  packageId: string;
}

export interface BillSummary {
  id: string;
  congress: number;
  type: BillType;
  number: number;
  title: string;
  shortTitle?: string | null;
  originChamber?: string | null;
  sponsorName?: string | null;
  sponsorParty?: string | null;
  sponsorState?: string | null;
  policyArea?: string | null;
  introducedDate?: string | null;
  latestActionDate?: string | null;
  latestActionText?: string | null;
  latestVersionCode?: string | null;
  latestVersionDate?: string | null;
  versionCount: number;
  hasMarkupVersion: boolean;
  versions: BillTextVersion[];
  congressUrl?: string | null;
  updatedAt: string;
  /**
   * From Congress.gov's `laws` field, e.g. "Public Law 117-58". "" = checked,
   * not a law; null/undefined = not known (older stored rows).
   */
  publicLaw?: string | null;
}

export interface BillDetail extends BillSummary {
  summaryText?: string | null;
}

/** Homepage feed tabs: /recent, /passed, /noteworthy. */
export type HomeFeed = "active" | "law" | "noteworthy";

export interface RecentBillsResponse {
  bills: BillSummary[];
  syncedAt: string | null;
  total: number;
  source: "d1" | "live" | "fixture";
  /** Which homepage feed this is (set when server-rendered). */
  feed?: HomeFeed;
}

export interface SearchBillsResponse {
  directMatch?: BillSummary | null;
  results: BillSummary[];
  query: string;
  total: number;
}

/** Plain-English gloss for stage codes whose official label is jargon. */
const STAGE_HINTS: Record<string, string> = {
  rh: "approved by committee",
  rs: "approved by committee",
  rch: "moved to another committee",
  rcs: "moved to another committee",
  hdh: "held for a floor vote",
  hds: "held for a floor vote",
  cdh: "pulled from committee",
  cds: "pulled from committee",
  pch: "awaiting a floor vote",
  pcs: "awaiting a floor vote",
  cph: "passed the House",
  cps: "passed the Senate",
  eh: "passed the House",
  es: "passed the Senate",
  rdh: "arrived from the Senate",
  rds: "arrived from the House",
  rfh: "sent to a House committee",
  rfs: "sent to a Senate committee",
  ath: "adopted by the House",
  ats: "adopted by the Senate",
  eah: "House changes to a Senate bill",
  eas: "Senate changes to a House bill",
  reah: "House changes, re-passed",
  reas: "Senate changes, re-passed",
  enr: "passed both chambers, sent to the President",
  renr: "corrected final text",
};

/** Short tooltip text for a stage code, e.g. "Engrossed in House · passed the House". */
export function describeStage(code: string): string {
  const info = getVersionStageInfo(code);
  const hint = STAGE_HINTS[code.toLowerCase()];
  return hint ? `${info.label} · ${hint}` : info.label;
}

/**
 * Public/private law number (e.g. "Public Law 117-169") when the bill's latest
 * Congress.gov action says it became law; null otherwise. Bills that are
 * merely enrolled (ENR) may still be vetoed, so ENR alone isn't enough.
 */
export function getEnactedLaw(
  bill: Pick<BillSummary, "latestActionText" | "publicLaw">,
): string | null {
  // Prefer Congress.gov's structured laws field: the latest action isn't always
  // the signing (e.g. a hearing held after enactment, as with H.R. 3684 in the 117th).
  if (bill.publicLaw) return bill.publicLaw;
  const m = bill.latestActionText?.match(
    /Became (Public|Private) Law(?: No[.:]?)?\s*([\d]+-[\d]+)?/i,
  );
  if (!m) return null;
  const kind = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[2] ? `${kind} Law ${m[2]}` : `${kind} Law`;
}

/** Oldest Congress with bill data on Congress.gov (bill text starts at the 103rd). */
export const MIN_LIST_CONGRESS = 93;

/** 101 -> "101st", 112 -> "112th", 119 -> "119th". */
export function congressOrdinal(congress: number): string {
  const mod100 = congress % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[congress % 10] ?? "th";
  return `${congress}${suffix}`;
}

/** Calendar years a Congress spans, e.g. 119 -> "2025–2027". */
export function congressYears(congress: number): string {
  const start = 1789 + 2 * (congress - 1);
  return `${start}–${start + 2}`;
}

export function isListableCongress(congress: number): boolean {
  return Number.isInteger(congress) && congress >= MIN_LIST_CONGRESS && congress <= CURRENT_CONGRESS;
}

/** One page of a Congress (or Congress + bill type) listing. */
export interface CongressBillsResponse {
  congress: number;
  type: BillType | null;
  /** Bills ordered by most recently published text version (real activity). */
  bills: BillSummary[];
  /** Cursor this page started from (null = newest). */
  after: string | null;
  /** Cursor for the next (older) page, or null at the end. */
  nextAfter: string | null;
  /** Total bills in this Congress / type (from Congress.gov), if known. */
  total: number | null;
}
