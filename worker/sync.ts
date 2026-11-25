import {
  CURRENT_CONGRESS,
  makeBillId,
  type BillType,
} from "../shared/bills";
import {
  fetchBillFromCongressApi,
  fetchLawsForCongress,
  fetchRecentGovInfoPackages,
} from "./congressApi";
import { getBillById, getBillsByIds, setSyncState, upsertBill } from "./db";
import type { Env } from "./env";

const NON_INITIAL_STAGES = new Set([
  "rh",
  "rs",
  "eh",
  "es",
  "eah",
  "eas",
  "rfs",
  "rfh",
  "enr",
  "pcs",
  "pch",
  "cps",
  "cph",
  "ath",
  "ats",
  "pp",
]);

/** High-interest active 119th Congress multi-version bills included on initial bootstrap. */
const FEATURED_SEED_BILLS: Array<{
  congress: number;
  type: BillType;
  number: number;
}> = [
  { congress: 119, type: "hr", number: 3633 }, // CLARITY Act (IH -> RH -> EH -> RFS -> RS with strike-all markup)
  { congress: 119, type: "s", number: 919 },   // GENIUS Act
  { congress: 119, type: "hr", number: 1 },    // Major reconciliation/flagship bill
];

/**
 * Polls GovInfo's recent BILLS publications and hydrates the most actively revised
 * bills into D1. Runs on Cloudflare's Cron Trigger (every 15m) and once on cold bootstrap.
 * Kept intentionally small (maxHydrate bills per run) to stay well within free-tier limits.
 */
export async function syncRecentBills(
  env: Env,
  options: { maxHydrate?: number; includeSeeds?: boolean } = {},
): Promise<{ hydrated: number; checked: number }> {
  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) return { hydrated: 0, checked: 0 };

  const maxHydrate = options.maxHydrate ?? 8;
  const candidates = new Map<
    string,
    { congress: number; type: BillType; number: number; priority: number }
  >();

  if (options.includeSeeds) {
    for (const seed of FEATURED_SEED_BILLS) {
      const id = makeBillId(seed.congress, seed.type, seed.number);
      candidates.set(id, { ...seed, priority: 100 });
    }
  }

  try {
    const packages = await fetchRecentGovInfoPackages(apiKey, 60, 100);
    for (const pkg of packages) {
      if (pkg.congress < CURRENT_CONGRESS - 1) continue;
      const id = makeBillId(pkg.congress, pkg.type, pkg.number);
      const isRevisedStage = NON_INITIAL_STAGES.has(pkg.versionCode);
      const existing = candidates.get(id);
      const bump = isRevisedStage ? 50 : 10;
      if (existing) {
        existing.priority += bump;
      } else {
        candidates.set(id, {
          congress: pkg.congress,
          type: pkg.type,
          number: pkg.number,
          priority: bump,
        });
      }
    }
  } catch (err) {
    console.error("GovInfo recent sync error:", err);
  }

  const ordered = Array.from(candidates.values()).sort(
    (a, b) => b.priority - a.priority,
  );

  const staleCutoffMs = Date.now() - 4 * 60 * 60 * 1000;
  let hydrated = 0;
  let checked = 0;

  // Hydrate sequentially in small parallel batches of 4 to be polite to Congress.gov API
  const toFetch: typeof ordered = [];
  for (const cand of ordered) {
    if (toFetch.length >= maxHydrate) break;
    checked++;
    const id = makeBillId(cand.congress, cand.type, cand.number);
    const existing = await getBillById(env.DB, id);
    if (existing && new Date(existing.fetchedAt).getTime() > staleCutoffMs) {
      continue;
    }
    toFetch.push(cand);
  }

  const batchSize = 4;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const chunk = toFetch.slice(i, i + batchSize);
    const results = await Promise.all(
      chunk.map((c) =>
        fetchBillFromCongressApi(c.congress, c.type, c.number, apiKey).catch(
          (err) => {
            console.error(`Failed to hydrate ${c.congress}/${c.type}/${c.number}:`, err);
            return null;
          },
        ),
      ),
    );
    for (const bill of results) {
      if (bill && bill.versionCount > 0) {
        await upsertBill(env.DB, bill);
        hydrated++;
      }
    }
  }

  await setSyncState(env.DB, "last_sync_at", new Date().toISOString());
  return { hydrated, checked };
}

/**
 * Stores the newest laws we don't have yet, so the "Recently passed" feed has
 * full version history (stage badges, redlines) for every row.
 */
export async function syncRecentLaws(
  env: Env,
  options: { maxHydrate?: number; window?: number } = {},
): Promise<{ hydrated: number }> {
  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) return { hydrated: 0 };
  const laws = (await fetchLawsForCongress(CURRENT_CONGRESS, apiKey)).slice(
    0,
    options.window ?? 60,
  );
  const stored = await getBillsByIds(env.DB, laws.map((l) => l.id));
  const missing = laws
    .filter((l) => !stored.get(l.id)?.versions.length)
    .slice(0, options.maxHydrate ?? 6);

  let hydrated = 0;
  for (const law of missing) {
    try {
      const bill = await fetchBillFromCongressApi(law.congress, law.type, law.number, apiKey);
      if (bill) {
        await upsertBill(env.DB, bill);
        hydrated++;
      }
    } catch (err) {
      console.error(`Law sync failed for ${law.id}:`, err);
    }
  }
  return { hydrated };
}
