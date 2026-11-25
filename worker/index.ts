import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  BILL_TYPES,
  CURRENT_CONGRESS,
  isListableCongress,
  makeBillId,
  makePackageId,
  normalizeBillType,
  parseBillQuery,
  type BillDetail,
  type BillSummary,
  type BillType,
  type CongressBillsResponse,
  type HomeFeed,
  type RecentBillsResponse,
  type SearchBillsResponse,
} from "../shared/bills";
import { matchLandmarkLaw, withLandmarkTitle } from "../shared/landmarkLaws";
import { NOTEWORTHY_BILLS } from "../shared/noteworthy";
import {
  fetchBillFromCongressApi,
  fetchCongressBillCount,
  fetchRecentlyPublishedBills,
  fetchOfficialBillSource,
  fetchLawsForCongress,
  fillMissingVersionDates,
  searchGovInfoBills,
} from "./congressApi";
import {
  getBillById,
  getBillsByIds,
  getSyncState,
  listRecentBills,
  searchLocalBills,
  upsertBill,
} from "./db";
import type { Env } from "./env";
import { renderBillSsr, renderCongressListSsr, renderHomeSsr } from "./ssr";
import { syncRecentBills, syncRecentLaws } from "./sync";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

const ACTIVE_CONGRESS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const HISTORICAL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getOrLazyLoadBill(
  env: Env,
  congress: number,
  rawType: string,
  number: number,
): Promise<BillDetail | null> {
  const type = normalizeBillType(rawType);
  if (!type || !Number.isInteger(congress) || congress < 93 || congress > 130) {
    return null;
  }
  if (!Number.isInteger(number) || number < 1 || number > 99999) {
    return null;
  }

  const id = makeBillId(congress, type, number);
  const cached = await getBillById(env.DB, id);
  const ttl =
    congress >= CURRENT_CONGRESS ? ACTIVE_CONGRESS_TTL_MS : HISTORICAL_TTL_MS;

  // Rows stored before law numbers were tracked: re-check enrolled bills once.
  const lawUnknown =
    cached != null &&
    cached.publicLaw == null &&
    cached.versions.some((v) => v.code === "enr" || v.code === "renr");

  if (cached && !lawUnknown && Date.now() - new Date(cached.fetchedAt).getTime() < ttl) {
    // Backfill version dates for rows stored before GovInfo date filling existed.
    if (env.CONGRESS_API_KEY && cached.versions.some((v) => !v.date)) {
      if (await fillMissingVersionDates(cached.versions, env.CONGRESS_API_KEY)) {
        const latest = [...cached.versions]
          .filter((v) => v.date)
          .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
          .pop();
        if (latest) {
          cached.latestVersionCode = latest.code;
          cached.latestVersionDate = latest.date;
        }
        await upsertBill(env.DB, cached);
      }
    }
    return withLandmarkTitle(cached);
  }

  if (!env.CONGRESS_API_KEY) {
    return cached && withLandmarkTitle(cached);
  }

  try {
    const fresh = await fetchBillFromCongressApi(
      congress,
      type,
      number,
      env.CONGRESS_API_KEY,
    );
    if (fresh) {
      const named = withLandmarkTitle(fresh);
      await upsertBill(env.DB, named);
      return named;
    }
  } catch (err) {
    console.error(`Error fetching ${id}:`, err);
    if (cached) return withLandmarkTitle(cached);
    throw err;
  }
  return cached && withLandmarkTitle(cached);
}

/**
 * Most recent laws (current Congress, topped up from the previous one early in a
 * new Congress). Congress.gov is the source of truth for which bills became law;
 * stored rows supply version history where we have it.
 */
async function recentLaws(
  env: Env,
  limit: number,
  offset: number,
  ctx?: BackgroundCtx,
): Promise<{ bills: BillSummary[]; total: number }> {
  const apiKey = env.CONGRESS_API_KEY!;
  let laws = await fetchLawsForCongress(CURRENT_CONGRESS, apiKey);
  if (laws.length < offset + limit) {
    laws = laws.concat(await fetchLawsForCongress(CURRENT_CONGRESS - 1, apiKey).catch(() => []));
  }
  const bills = await mergeStoredHistory(env, laws.slice(offset, offset + limit), ctx);
  return { bills, total: laws.length };
}

/** Just the part of the execution context we need (Hono's and Workers' types differ). */
type BackgroundCtx = { waitUntil(promise: Promise<unknown>): void };

/**
 * Congress.gov list rows have no text versions. Swap in stored rows (which
 * have version history for stage badges) where we have them, keeping the
 * list's fresher latest action, and queue a few unknown bills for storage.
 */
async function mergeStoredHistory(
  env: Env,
  listed: BillSummary[],
  ctx?: BackgroundCtx,
  /** How many unknown bills to store in the background per call. */
  hydrate = 4,
): Promise<BillSummary[]> {
  const stored = await getBillsByIds(env.DB, listed.map((b) => b.id));
  const merged = listed.map((item) => {
    const known = stored.get(item.id);
    if (!known) return withLandmarkTitle(item);
    return {
      ...known,
      // Prefer the list's fresher latest action when it has one (the law list does).
      ...(item.latestActionText
        ? { latestActionDate: item.latestActionDate, latestActionText: item.latestActionText }
        : {}),
      // Older stored rows can lack a version date that the list knows.
      latestVersionDate: known.latestVersionDate ?? item.latestVersionDate ?? null,
      publicLaw: known.publicLaw || item.publicLaw || known.publicLaw,
    };
  });
  if (ctx) {
    const missing = merged.filter((b) => b.versions.length === 0).slice(0, hydrate);
    if (missing.length > 0) {
      ctx.waitUntil(
        Promise.all(
          missing.map((b) =>
            getOrLazyLoadBill(env, b.congress, b.type, b.number).catch(() => null),
          ),
        ),
      );
    }
  }
  return merged;
}

/** Parses /:congress[/:type] params; null when they don't name a listable page. */
function parseListScope(
  congressRaw: string,
  typeRaw?: string,
): { congress: number; type: BillType | null } | null {
  if (!/^\d{2,3}$/.test(congressRaw)) return null;
  const congress = Number(congressRaw);
  if (!isListableCongress(congress)) return null;
  if (typeRaw === undefined) return { congress, type: null };
  const type = normalizeBillType(typeRaw);
  return type && type === typeRaw.toLowerCase() ? { congress, type } : null;
}

async function congressBillsPage(
  env: Env,
  scope: { congress: number; type: BillType | null },
  after: string | null,
  ctx?: BackgroundCtx,
): Promise<CongressBillsResponse> {
  const apiKey = env.CONGRESS_API_KEY!;
  const [list, total] = await Promise.all([
    fetchRecentlyPublishedBills(scope.congress, scope.type, after, apiKey),
    fetchCongressBillCount(scope.congress, scope.type, apiKey).catch(() => null),
  ]);
  return {
    congress: scope.congress,
    type: scope.type,
    bills: await mergeStoredHistory(env, list.bills, ctx),
    after,
    nextAfter: list.nextAfter,
    total,
  };
}

/** GovInfo cursors are opaque base64-ish strings; reject anything else. */
function readCursor(raw: string | undefined): string | null {
  if (!raw || raw === "*" || raw.length > 512 || !/^[A-Za-z0-9+/=_\-]+$/.test(raw)) return null;
  return raw;
}

app.get("/api/congress/:congress", async (c) => {
  const scope = parseListScope(c.req.param("congress"), c.req.query("type") || undefined);
  if (!scope) return c.json({ error: "Unknown Congress or bill type" }, 404);
  if (!c.env.CONGRESS_API_KEY) return c.json({ error: "Congress.gov API key not configured" }, 503);
  try {
    const payload = await congressBillsPage(
      c.env,
      scope,
      readCursor(c.req.query("after")),
      c.executionCtx,
    );
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return c.json(payload);
  } catch (err) {
    console.error("Congress bill list failed:", err);
    return c.json({ error: "Could not load bills from Congress.gov" }, 502);
  }
});

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "redlinecongress",
    hasApiKey: Boolean(c.env.CONGRESS_API_KEY),
    time: new Date().toISOString(),
  });
});

/** Noteworthy bills, most recently active first. Stored after the first load. */
async function noteworthyBills(env: Env): Promise<BillSummary[]> {
  const loaded = await Promise.all(
    NOTEWORTHY_BILLS.map((b) =>
      getOrLazyLoadBill(env, b.congress, b.type, b.number).catch(() => null),
    ),
  );
  const activity = (b: BillSummary) =>
    [b.latestActionDate, b.latestVersionDate].filter(Boolean).sort().pop() ?? "";
  return loaded
    .filter((b): b is BillDetail => b !== null)
    .map(({ summaryText: _s, ...summary }) => summary)
    .sort((a, b) => activity(b).localeCompare(activity(a)));
}

/**
 * Latest text versions that don't make a bill "active" for the homepage:
 * introduced-only stages, and simple resolutions agreed to as introduced
 * (commemorative S.Res./H.Res. with a single version and nothing to redline).
 */
const NOT_ACTIVE_STAGES = new Set(["ih", "is", "ihr", "isr", "ash", "rch", "rcs", "ats", "ath"]);

/**
 * JSON-serializable result cached in the Workers Cache API for `ttlSeconds`.
 * Used for GovInfo searches, which are POSTs and so skip Cloudflare's fetch cache.
 */
async function cachedJson<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const req = new Request(`https://cache.redlinecongress.internal/${encodeURIComponent(key)}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return (await hit.json()) as T;
  }
  const value = await load();
  if (cache) {
    await cache.put(
      req,
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttlSeconds}` },
      }),
    );
  }
  return value;
}

/**
 * "Recently active": bills whose newest published text is past introduction
 * (reported, passed, amended, enrolled…), newest first, straight from GovInfo.
 * Doesn't depend on what the sync job happened to store, so it's complete
 * everywhere (including local dev, where the cron never runs).
 */
async function recentlyActiveBills(
  env: Env,
  limit: number,
  ctx?: BackgroundCtx,
): Promise<BillSummary[]> {
  const apiKey = env.CONGRESS_API_KEY!;
  const listed = await cachedJson(`recently-active:v2:${CURRENT_CONGRESS}:${limit}`, 300, async () => {
    const out: BillSummary[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    // A batch of 100 text versions usually holds ~25–40 that are past introduction.
    for (let batch = 0; batch < 4 && out.length < limit; batch++) {
      const page = await fetchRecentlyPublishedBills(CURRENT_CONGRESS, null, after, apiKey, 100);
      for (const b of page.bills) {
        if (seen.has(b.id) || NOT_ACTIVE_STAGES.has(b.latestVersionCode ?? "")) continue;
        seen.add(b.id);
        out.push(b);
      }
      if (!page.nextAfter) break;
      after = page.nextAfter;
    }
    return out.slice(0, limit);
  });
  return mergeStoredHistory(env, listed, ctx, 10);
}

/** One homepage feed tab's bills (shared by the API and server rendering). */
async function homeFeed(
  env: Env,
  feed: HomeFeed,
  ctx?: BackgroundCtx,
  limit = 30,
  offset = 0,
): Promise<RecentBillsResponse> {
  if (feed === "noteworthy") {
    const bills = await noteworthyBills(env);
    return { bills, syncedAt: null, total: bills.length, source: "live", feed };
  }

  if (feed === "law" && env.CONGRESS_API_KEY) {
    try {
      const laws = await recentLaws(env, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0), ctx);
      return { bills: laws.bills, syncedAt: null, total: laws.total, source: "live", feed };
    } catch (err) {
      console.error("Congress.gov law list failed, using D1:", err);
    }
  }

  if (feed === "active" && env.CONGRESS_API_KEY && offset === 0) {
    try {
      const bills = await recentlyActiveBills(env, Math.min(Math.max(limit, 1), 60), ctx);
      if (bills.length > 0) {
        return { bills, syncedAt: null, total: bills.length, source: "live", feed };
      }
    } catch (err) {
      console.error("GovInfo recently-active list failed, using D1:", err);
    }
  }

  let { bills, total } = await listRecentBills(env.DB, { filter: feed, limit, offset });

  // Cold-start bootstrap: if D1 has no bills yet, hydrate an initial batch right away.
  if (total === 0 && feed === "active" && env.CONGRESS_API_KEY) {
    await syncRecentBills(env, { maxHydrate: 8, includeSeeds: true });
    ({ bills, total } = await listRecentBills(env.DB, { filter: feed, limit, offset }));
  }

  const syncedAt = await getSyncState(env.DB, "last_sync_at");
  return { bills, syncedAt, total, source: "d1", feed };
}

function parseHomeFeed(raw: string | undefined): HomeFeed {
  return raw === "law" || raw === "noteworthy" ? raw : "active";
}

app.get("/api/bills/recent", async (c) => {
  const feed = parseHomeFeed(c.req.query("filter"));
  const payload = await homeFeed(
    c.env,
    feed,
    c.executionCtx,
    Number(c.req.query("limit") ?? 30),
    Number(c.req.query("offset") ?? 0),
  );
  c.header(
    "Cache-Control",
    feed === "active"
      ? "public, max-age=120, stale-while-revalidate=300"
      : "public, max-age=300, stale-while-revalidate=900",
  );
  return c.json(payload);
});

app.get("/api/bills/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) {
    const empty: SearchBillsResponse = { results: [], query: "", total: 0 };
    return c.json(empty);
  }
  // Optional scope from the /:congress and /:congress/:type list pages.
  const scopeCongress = Number(c.req.query("congress"));
  const scope = {
    congress: isListableCongress(scopeCongress) ? scopeCongress : undefined,
    type: normalizeBillType(c.req.query("type") ?? "") ?? undefined,
  };
  const inScope = (b: { congress: number; type: string }) =>
    (!scope.congress || b.congress === scope.congress) && (!scope.type || b.type === scope.type);

  // 1. Check if query is a direct bill reference ("hr 3633", "S. 919", Congress.gov URL)
  //    or the popular name of a landmark law ("Patriot Act", "Obamacare").
  let directMatch: BillDetail | null = null;
  const parsedRef = parseBillQuery(q);
  const landmark = parsedRef ? null : matchLandmarkLaw(q);
  if (parsedRef) {
    const targetCongress = parsedRef.congress ?? scope.congress ?? CURRENT_CONGRESS;
    directMatch = await getOrLazyLoadBill(
      c.env,
      targetCongress,
      parsedRef.type,
      parsedRef.number,
    );
  } else if (landmark) {
    try {
      directMatch = await getOrLazyLoadBill(
        c.env,
        landmark.congress,
        landmark.type,
        landmark.number,
      );
    } catch (err) {
      console.error("Landmark law lookup failed:", err);
    }
  }

  // 2. Full-text search via GovInfo API (with D1 fallback)
  if (directMatch && !parsedRef && !inScope(directMatch)) directMatch = null;
  let results = await searchLocalBills(c.env.DB, q, 10, scope);
  if (c.env.CONGRESS_API_KEY && (!parsedRef || q.includes(" "))) {
    try {
      const govResults = await searchGovInfoBills(q, c.env.CONGRESS_API_KEY, 20, scope);
      const seen = new Set<string>(directMatch ? [directMatch.id] : []);
      const merged = [...govResults, ...results].filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
      results = merged.slice(0, 20);
    } catch (err) {
      console.error("GovInfo search failed, using D1 fallback:", err);
    }
  }

  if (directMatch) {
    const pinnedId = directMatch.id;
    results = results.filter((b) => b.id !== pinnedId);
  }
  results = results.map(withLandmarkTitle);

  const payload: SearchBillsResponse = {
    directMatch,
    results,
    query: q,
    total: results.length + (directMatch ? 1 : 0),
  };
  c.header("Cache-Control", "public, max-age=180");
  return c.json(payload);
});

app.get("/api/bills/:congress/:type/:number", async (c) => {
  const congress = Number(c.req.param("congress"));
  const rawType = c.req.param("type");
  const number = Number(c.req.param("number"));

  const bill = await getOrLazyLoadBill(c.env, congress, rawType, number);
  if (!bill) {
    return c.json({ error: "Bill not found." }, 404);
  }

  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.json(bill);
});

app.get("/api/bills/:congress/:type/:number/xml/:version", async (c) => {
  const congress = Number(c.req.param("congress"));
  const type = normalizeBillType(c.req.param("type"));
  const number = Number(c.req.param("number"));
  const version = c.req.param("version").toLowerCase().replace(/[^a-z0-9]/g, "");

  if (!type || !Number.isInteger(congress) || !Number.isInteger(number) || !version) {
    return c.json({ error: "Invalid bill version parameters." }, 400);
  }

  const xmlR2Key = `xml/${congress}/${type}/${number}/${version}.xml`;
  const htmR2Key = `htm/${congress}/${type}/${number}/${version}.htm`;
  const packageId = makePackageId(congress, type, number, version);

  // 1. Check permanent R2 cache first (published Congressional versions are immutable)
  try {
    const cachedXml = await c.env.XML_BUCKET.get(xmlR2Key);
    if (cachedXml) {
      return new Response(cachedXml.body, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Redline-Cache": "HIT-R2",
          "X-Redline-Format": "xml",
        },
      });
    }
    const cachedHtm = await c.env.XML_BUCKET.get(htmR2Key);
    if (cachedHtm) {
      return new Response(cachedHtm.body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Redline-Cache": "HIT-R2",
          "X-Redline-Format": "htm",
        },
      });
    }
  } catch (err) {
    console.warn("R2 read failed, falling through to upstream:", err);
  }

  // 2. Look up bill version URLs if we have metadata cached in D1
  const bill = await getBillById(c.env.DB, makeBillId(congress, type, number));
  const versionMeta = bill?.versions.find((v) => v.code === version);

  // 3. Lazy-fetch official XML or historical GPO Formatted Text (.htm) from GovInfo / Congress.gov
  const source = await fetchOfficialBillSource(
    packageId,
    versionMeta?.xmlUrl ?? null,
    versionMeta?.htmlUrl ?? null,
    c.env.CONGRESS_API_KEY,
  );
  if (!source) {
    return c.json(
      {
        error: `Official bill text for ${packageId} is not available on GovInfo (digital text is available from the 103rd Congress / 1993 onward).`,
      },
      404,
    );
  }

  // 4. Store in R2 in background so subsequent reads are instant and $0 egress
  const r2Key = source.format === "xml" ? xmlR2Key : htmR2Key;
  c.executionCtx.waitUntil(
    c.env.XML_BUCKET.put(r2Key, source.body, {
      httpMetadata: { contentType: source.contentType },
      customMetadata: { packageId, format: source.format },
    }).catch((err) => console.error("R2 put failed:", err)),
  );

  return new Response(source.body, {
    headers: {
      "Content-Type": source.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Redline-Cache": "MISS-UPSTREAM",
      "X-Redline-Format": source.format,
    },
  });
});

app.post("/api/sync", async (c) => {
  if (!c.env.CONGRESS_API_KEY) {
    return c.json({ error: "CONGRESS_API_KEY is not configured." }, 400);
  }
  const force = c.req.query("seed") === "1";
  const result = await syncRecentBills(c.env, {
    maxHydrate: 10,
    includeSeeds: force,
  });
  return c.json({ ok: true, ...result });
});

// ── SEO: robots.txt & dynamic sitemap.xml ──────────────────────────────────

app.get("/robots.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return new Response(
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
});

app.get("/sitemap.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const { bills } = await listRecentBills(c.env.DB, {
    filter: "all",
    limit: 500,
    offset: 0,
  });
  const urls = [
    `<url><loc>${origin}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${origin}/${CURRENT_CONGRESS}</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...BILL_TYPES.map(
      (t) =>
        `<url><loc>${origin}/${CURRENT_CONGRESS}/${t}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`,
    ),
    ...bills.map(
      (b) =>
        `<url><loc>${origin}/${b.congress}/${b.type}/${b.number}</loc>${b.updatedAt ? `<lastmod>${b.updatedAt.slice(0, 10)}</lastmod>` : ""}<priority>0.8</priority></url>`,
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
});

// ── Server-Side Rendered HTML Routes ───────────────────────────────────────

async function fetchIndexTemplate(env: Env, reqUrl: string): Promise<string> {
  const assetUrl = new URL("/index.html", reqUrl);
  const res = await env.ASSETS.fetch(assetUrl);
  if (!res.ok) {
    throw new Error(`Could not load index.html template (${res.status})`);
  }
  return await res.text();
}

/** Homepage tab permalinks; each server-renders that tab's feed. */
const HOME_FEED_PATHS: Record<string, HomeFeed> = {
  "/": "active",
  "/recent": "active",
  "/passed": "law",
  "/noteworthy": "noteworthy",
};

for (const [path, feed] of Object.entries(HOME_FEED_PATHS)) {
  app.get(path, async (c) => {
    const origin = new URL(c.req.url).origin;
    const [template, payload] = await Promise.all([
      fetchIndexTemplate(c.env, c.req.url),
      homeFeed(c.env, feed, c.executionCtx),
    ]);
    const html = renderHomeSsr(template, origin, path, payload);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  });
}

async function renderListPage(
  c: Context<{ Bindings: Env }>,
  scope: { congress: number; type: BillType | null },
): Promise<Response> {
  const template = await fetchIndexTemplate(c.env, c.req.url);
  if (!c.env.CONGRESS_API_KEY) {
    return new Response(template, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  try {
    const data = await congressBillsPage(
      c.env,
      scope,
      readCursor(c.req.query("after")),
      c.executionCtx,
    );
    const html = renderCongressListSsr(template, new URL(c.req.url).origin, data);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=900",
      },
    });
  } catch (err) {
    console.error("Congress list SSR failed:", err);
    // The client app will retry the fetch and show its own error state.
    return new Response(template, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

app.get("/:congress", async (c, next) => {
  const scope = parseListScope(c.req.param("congress"));
  if (!scope) return next();
  return renderListPage(c, scope);
});

app.get("/:congress/:type", async (c, next) => {
  const scope = parseListScope(c.req.param("congress"), c.req.param("type"));
  if (!scope) return next();
  return renderListPage(c, scope);
});

app.get("/:congress/:type/:number/:spec?", async (c) => {
  const congressRaw = c.req.param("congress");
  const rawType = c.req.param("type");
  const numberRaw = c.req.param("number");
  const spec = c.req.param("spec");

  // Don't intercept missing static asset requests (return real 404 instead of HTML!)
  if (congressRaw === "assets" || rawType.includes(".")) {
    return c.notFound();
  }

  const congress = Number(congressRaw);
  const number = Number(numberRaw);
  const [template, bill] = await Promise.all([
    fetchIndexTemplate(c.env, c.req.url),
    getOrLazyLoadBill(c.env, congress, rawType, number).catch(() => null),
  ]);

  if (!bill) {
    return new Response(template, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const origin = new URL(c.req.url).origin;
  const html = renderBillSsr(template, origin, bill, spec);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
    },
  });
});

// Fallback: pass unknown static files to ASSETS (404 for missing /assets/*), else SPA shell
app.all("*", async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith("/assets/") || /\.[a-z0-9]{2,6}$/i.test(pathname)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  const template = await fetchIndexTemplate(c.env, c.req.url);
  return new Response(template, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(syncRecentBills(env, { maxHydrate: 10, includeSeeds: false }));
    ctx.waitUntil(
      syncRecentLaws(env, { maxHydrate: 6 }).catch((err) =>
        console.error("Law sync failed:", err),
      ),
    );
  },
};
