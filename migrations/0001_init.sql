-- Bills table: caches metadata for recently active and lazily visited bills.
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, -- e.g. "119:hr:3633"
  congress INTEGER NOT NULL,
  bill_type TEXT NOT NULL, -- hr, s, hres, sres, hjres, sjres, hconres, sconres
  bill_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  short_title TEXT,
  origin_chamber TEXT, -- House | Senate
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
  versions_json TEXT, -- JSON array of BillTextVersion
  summary_text TEXT,
  congress_url TEXT,
  updated_at TEXT NOT NULL, -- Upstream update date/timestamp
  fetched_at TEXT NOT NULL  -- When we last fetched full metadata
);

CREATE INDEX IF NOT EXISTS idx_bills_recent
  ON bills (version_count DESC, latest_version_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bills_activity
  ON bills (latest_version_date DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bills_congress_type_num
  ON bills (congress, bill_type, bill_number);

-- Sync metadata (tracks last GovInfo / Congress.gov sync cursor)
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
