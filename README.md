<a href="https://redlinecongress.org"><img src="logo.png" alt="RedlineCongress.org" width="240"></a>

What is changing in bills as they move through Congress? It's surprisingly hard to find out.

[RedlineCongress.org](https://redlinecongress.org) is a public mirror of legislation that lets you see redlines on bills between any two stages.

Bill text comes from [Congress.gov](https://www.congress.gov) &
[GovInfo](https://www.govinfo.gov) APIs. Documents are rendered with the
[Revise SDK](https://revise.io/sdk) (`revise` on npm). Hosted on
Cloudflare Workers with D1.

## Run locally

Requires Node 20+.

1. Get a free API key at [api.data.gov/signup](https://api.data.gov/signup/)
   (it works for both the Congress.gov and GovInfo APIs).
2. Configure it and install:

   ```bash
   cp .dev.vars.example .dev.vars   # then paste your key into .dev.vars
   npm install
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Open the URL Vite prints (usually http://localhost:5173). Bills are fetched
   on demand and cached in a local D1 database, so the first load of each bill
   is slower.

## Tests

```bash
npm test
npm run typecheck
```

## Project layout

- `src/`: React app. `src/lib/billXml/` parses bill XML and historical GPO
  text, computes the diff, and writes a `.docx` with tracked changes.
- `worker/`: Cloudflare Worker (API, server rendering, scheduled sync).
- `shared/`: code used by both.
- `migrations/`: D1 schema.

## License

[MIT](LICENSE). The `revise` SDK dependency is published on npm under its own license.
