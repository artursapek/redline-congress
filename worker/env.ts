export interface Env {
  DB: D1Database;
  XML_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  CONGRESS_API_KEY?: string;
}
