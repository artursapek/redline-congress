import { withLandmarkTitle } from "../shared/landmarkLaws";
import {
  CURRENT_CONGRESS,
  getVersionStageInfo,
  type BillDetail,
  type BillSummary,
  type BillTextVersion,
  type BillType,
} from "../shared/bills";

interface BillRow {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  short_title: string | null;
  origin_chamber: string | null;
  sponsor_name: string | null;
  sponsor_party: string | null;
  sponsor_state: string | null;
  policy_area: string | null;
  introduced_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  latest_version_code: string | null;
  latest_version_date: string | null;
  version_count: number;
  has_markup_version: number;
  versions_json: string | null;
  summary_text: string | null;
  congress_url: string | null;
  updated_at: string;
  fetched_at: string;
  public_law: string | null;
}

let schemaInitialized = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitialized) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        congress INTEGER NOT NULL,
        bill_type TEXT NOT NULL,
        bill_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        short_title TEXT,
        origin_chamber TEXT,
        sponsor_name TEXT,
        sponsor_party TEXT,
        sponsor_state TEXT,
        policy_area TEXT,
        introduced_date TEXT,
        latest_action_date TEXT,
        latest_action_text TEXT,
        latest_version_code TEXT,
        latest_version_date TEXT,
        version_count INTEGER NOT NULL DEFAULT 0,
        has_markup_version INTEGER NOT NULL DEFAULT 0,
        versions_json TEXT,
        summary_text TEXT,
        congress_url TEXT,
        updated_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `),
  ]);
  // Columns added after the initial schema (see migrations/). ALTER fails once
  // the column exists, which is the normal case after the first run.
  try {
    await db.prepare("ALTER TABLE bills ADD COLUMN public_law TEXT").run();
  } catch {
    // already present
  }
  schemaInitialized = true;
}

function rowToBillDetail(row: BillRow): BillDetail & { fetchedAt: string } {
  let versions: BillTextVersion[] = [];
  if (row.versions_json) {
    try {
      versions = JSON.parse(row.versions_json) as BillTextVersion[];
      versions.sort((a, b) => {
        if (a.date && b.date && a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        return (
          getVersionStageInfo(a.code).order - getVersionStageInfo(b.code).order
        );
      });
    } catch {
      versions = [];
    }
  }
  return {
    id: row.id,
    congress: row.congress,
    type: row.bill_type as BillType,
    number: row.bill_number,
    title: row.title,
    shortTitle: row.short_title,
    originChamber: row.origin_chamber,
    sponsorName: row.sponsor_name,
    sponsorParty: row.sponsor_party,
    sponsorState: row.sponsor_state,
    policyArea: row.policy_area,
    introducedDate: row.introduced_date,
    latestActionDate: row.latest_action_date,
    latestActionText: row.latest_action_text,
    latestVersionCode: row.latest_version_code,
    latestVersionDate: row.latest_version_date,
    versionCount: row.version_count,
    hasMarkupVersion: row.has_markup_version === 1,
    versions,
    summaryText: row.summary_text,
    congressUrl: row.congress_url,
    updatedAt: row.updated_at,
    fetchedAt: row.fetched_at,
    publicLaw: row.public_law,
  };
}

export async function getBillById(
  db: D1Database,
  id: string,
): Promise<(BillDetail & { fetchedAt: string }) | null> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT * FROM bills WHERE id = ?")
    .bind(id)
    .first<BillRow>();
  return row ? rowToBillDetail(row) : null;
}

export async function upsertBill(
  db: D1Database,
  bill: BillDetail,
): Promise<void> {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO bills (
        id, congress, bill_type, bill_number, title, short_title,
        origin_chamber, sponsor_name, sponsor_party, sponsor_state, policy_area,
        introduced_date, latest_action_date, latest_action_text,
        latest_version_code, latest_version_date, version_count, has_markup_version,
        versions_json, summary_text, congress_url, updated_at, fetched_at, public_law
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        short_title = excluded.short_title,
        origin_chamber = excluded.origin_chamber,
        sponsor_name = excluded.sponsor_name,
        sponsor_party = excluded.sponsor_party,
        sponsor_state = excluded.sponsor_state,
        policy_area = excluded.policy_area,
        introduced_date = excluded.introduced_date,
        latest_action_date = excluded.latest_action_date,
        latest_action_text = excluded.latest_action_text,
        latest_version_code = excluded.latest_version_code,
        latest_version_date = excluded.latest_version_date,
        version_count = excluded.version_count,
        has_markup_version = excluded.has_markup_version,
        versions_json = excluded.versions_json,
        summary_text = COALESCE(excluded.summary_text, bills.summary_text),
        congress_url = excluded.congress_url,
        updated_at = excluded.updated_at,
        fetched_at = excluded.fetched_at,
        public_law = COALESCE(excluded.public_law, bills.public_law)`,
    )
    .bind(
      bill.id,
      bill.congress,
      bill.type,
      bill.number,
      bill.title,
      bill.shortTitle ?? null,
      bill.originChamber ?? null,
      bill.sponsorName ?? null,
      bill.sponsorParty ?? null,
      bill.sponsorState ?? null,
      bill.policyArea ?? null,
      bill.introducedDate ?? null,
      bill.latestActionDate ?? null,
      bill.latestActionText ?? null,
      bill.latestVersionCode ?? null,
      bill.latestVersionDate ?? null,
      bill.versionCount,
      bill.hasMarkupVersion ? 1 : 0,
      JSON.stringify(bill.versions),
      bill.summaryText ?? null,
      bill.congressUrl ?? null,
      bill.updatedAt,
      now,
      bill.publicLaw ?? null,
    )
    .run();
}

const RECENT_ACTIVITY_DAYS = 90;

/**
 * active: bills with redlines and real activity in the last 90 days (homepage).
 * law: recently signed into law (homepage).
 * all: every stored bill (sitemap).
 */
export type RecentBillsFilter = "active" | "law" | "all";

/** Later of the latest text-version date and latest action date ('' if neither). */
const ACTIVITY_DATE_SQL =
  "MAX(COALESCE(latest_version_date, ''), COALESCE(latest_action_date, ''))";

export async function listRecentBills(
  db: D1Database,
  options: {
    filter?: RecentBillsFilter;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ bills: BillSummary[]; total: number }> {
  await ensureSchema(db);
  const filter = options.filter ?? "active";
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions: string[] = ["version_count >= 1"];
  let orderBy = `${ACTIVITY_DATE_SQL} DESC, version_count DESC, updated_at DESC`;

  if (filter === "active") {
    // "Recently active" means real legislative activity: a new text version or a
    // floor/committee action. updated_at is Congress.gov's record-edit timestamp,
    // which gets bumped by routine metadata fixes long after a bill is done
    // (and enrolled texts usually have no version date), so it's never used here.
    // The window also keeps out old bills that were stored only because someone
    // searched for or opened them. Single-version bills have nothing to redline.
    conditions.push(
      `${ACTIVITY_DATE_SQL} >= date('now', '-${RECENT_ACTIVITY_DAYS} days')`,
      "(version_count >= 2 OR has_markup_version = 1)",
    );
  } else if (filter === "law") {
    // Signed into law during the current or previous Congress, newest first.
    conditions.push(
      "(public_law <> '' OR latest_action_text LIKE 'Became Public Law%' OR latest_action_text LIKE 'Became Private Law%')",
      `congress >= ${CURRENT_CONGRESS - 1}`,
    );
    orderBy = "latest_action_date DESC, updated_at DESC";
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM bills ${where}`)
    .first<{ cnt: number }>();

  const rows = await db
    .prepare(
      `SELECT * FROM bills ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<BillRow>();

  return {
    bills: (rows.results ?? []).map((r) => {
      const { summaryText: _s, fetchedAt: _f, ...summary } = rowToBillDetail(r);
      return withLandmarkTitle(summary);
    }),
    total: countRow?.cnt ?? 0,
  };
}

/** Stored bills for the given ids (missing ids are simply absent). */
export async function getBillsByIds(
  db: D1Database,
  ids: string[],
): Promise<Map<string, BillSummary>> {
  await ensureSchema(db);
  const out = new Map<string, BillSummary>();
  if (ids.length === 0) return out;
  const rows = await db
    .prepare(`SELECT * FROM bills WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<BillRow>();
  for (const r of rows.results ?? []) {
    const { summaryText: _s, fetchedAt: _f, ...summary } = rowToBillDetail(r);
    out.set(summary.id, withLandmarkTitle(summary));
  }
  return out;
}

export async function searchLocalBills(
  db: D1Database,
  query: string,
  limit = 15,
  scope: { congress?: number; type?: BillType } = {},
): Promise<BillSummary[]> {
  await ensureSchema(db);
  const pattern = `%${query.trim()}%`;
  const scopeSql = [
    scope.congress ? "AND congress = ?" : "",
    scope.type ? "AND bill_type = ?" : "",
  ].join(" ");
  const scopeArgs = [scope.congress, scope.type].filter((v) => v !== undefined);
  const rows = await db
    .prepare(
      `SELECT * FROM bills
       WHERE (title LIKE ? OR policy_area LIKE ? OR sponsor_name LIKE ?) ${scopeSql}
       ORDER BY version_count DESC, COALESCE(latest_version_date, updated_at) DESC
       LIMIT ?`,
    )
    .bind(pattern, pattern, pattern, ...scopeArgs, limit)
    .all<BillRow>();

  return (rows.results ?? []).map((r) => {
    const { summaryText: _s, fetchedAt: _f, ...summary } = rowToBillDetail(r);
    return withLandmarkTitle(summary);
  });
}

export async function getSyncState(
  db: D1Database,
  key: string,
): Promise<string | null> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSyncState(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await ensureSchema(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, now)
    .run();
}
