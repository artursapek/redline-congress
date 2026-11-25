import type {
  BillDetail,
  BillType,
  CongressBillsResponse,
  HomeFeed,
  RecentBillsResponse,
  SearchBillsResponse,
} from "../../shared/bills";

const xmlMemoryCache = new Map<string, string>();
const xmlInFlight = new Map<string, Promise<string>>();

export async function fetchRecentBills(
  filter: HomeFeed = "active",
  limit = 30,
): Promise<RecentBillsResponse> {
  const res = await fetch(
    `/api/bills/recent?filter=${encodeURIComponent(filter)}&limit=${limit}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to load recent bills (${res.status})`);
  }
  return (await res.json()) as RecentBillsResponse;
}

export async function searchBills(
  query: string,
  scope: { congress?: number; type?: BillType } = {},
): Promise<SearchBillsResponse> {
  const params = new URLSearchParams({ q: query.trim() });
  if (scope.congress) params.set("congress", String(scope.congress));
  if (scope.type) params.set("type", scope.type);
  const res = await fetch(`/api/bills/search?${params}`);
  if (!res.ok) {
    throw new Error(`Search failed (${res.status})`);
  }
  return (await res.json()) as SearchBillsResponse;
}

export async function fetchCongressBills(
  congress: number,
  type: BillType | null,
  after: string | null,
): Promise<CongressBillsResponse> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (after) params.set("after", after);
  const res = await fetch(`/api/congress/${congress}?${params}`);
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `Failed to load bills (${res.status})`);
  }
  return (await res.json()) as CongressBillsResponse;
}

export async function fetchBillDetail(
  congress: number,
  type: BillType,
  number: number,
): Promise<BillDetail> {
  const res = await fetch(
    `/api/bills/${congress}/${encodeURIComponent(type)}/${number}`,
  );
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error || `Bill not found (${res.status})`);
  }
  return (await res.json()) as BillDetail;
}

export async function fetchBillVersionXml(
  congress: number,
  type: BillType,
  number: number,
  versionCode: string,
): Promise<string> {
  const key = `${congress}/${type}/${number}/${versionCode.toLowerCase()}`;
  const cached = xmlMemoryCache.get(key);
  if (cached) return cached;

  const inflight = xmlInFlight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const res = await fetch(
      `/api/bills/${congress}/${encodeURIComponent(type)}/${number}/xml/${encodeURIComponent(versionCode.toLowerCase())}`,
    );
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(
        errBody?.error || `Official XML unavailable for ${versionCode.toUpperCase()} (${res.status})`,
      );
    }
    const xml = await res.text();
    xmlMemoryCache.set(key, xml);
    return xml;
  })();

  xmlInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    xmlInFlight.delete(key);
  }
}
