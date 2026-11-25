import type {
  BillDetail,
  CongressBillsResponse,
  RecentBillsResponse,
} from "../../shared/bills";

/** Data the server already fetched for this page, so the first render matches the HTML. */
export interface InitialData {
  recent?: RecentBillsResponse;
  congressList?: CongressBillsResponse;
  bill?: BillDetail;
}

declare global {
  interface Window {
    __RC_INITIAL__?: InitialData;
  }
}

// Set only for the duration of a synchronous server render (renderToString),
// so concurrent requests in the same isolate can't see each other's data.
let serverData: InitialData | null = null;

export function withServerInitialData<T>(data: InitialData, render: () => T): T {
  serverData = data;
  try {
    return render();
  } finally {
    serverData = null;
  }
}

export function getInitialData(): InitialData {
  if (serverData) return serverData;
  if (typeof window !== "undefined") return window.__RC_INITIAL__ ?? {};
  return {};
}
