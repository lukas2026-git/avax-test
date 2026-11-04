# Market Atlas

## Local development

Use Node.js 22.9 or newer. Copy `.env.example` to `.env`, add your CoinGecko Demo key, then run:

    npm start

No third-party runtime packages are required for the standalone server. Open the exact URL printed in the terminal. A free port is selected automatically; set `LOCAL_PORT=5173` in `.env` if you want a fixed local port. Use `npm run dev` for backend watch mode.

## Netlify deployment

Connect this repository to Netlify with the repository root as the base directory.
The checked-in `netlify.toml` publishes `public/` and discovers the three functions
in `netlify/functions/`. Leave the build command empty: this project does not
need a compilation step. Do not use `npm start` as a build command.

Set `COINGECKO_DEMO_API_KEY` and `OUTPUT_ACCESS_PASSWORD` in Netlify's environment
variables with Functions scope for each deployment context that needs them.
The output encryption secret must be at least 32 bytes. Keep both values
server-side and redeploy after changes.

| URL | Implementation |
| --- | --- |
| `/` and static assets | `public/`, served by Netlify |
| `/api/markets` | `netlify/functions/markets.mts` |
| `/api/token` and `/token` | `netlify/functions/token.mts` |
| `/api/output` and `/output` | `netlify/functions/output.mts` |

The function entrypoints use Netlify's Request/Response API and delegate to the
shared handlers in `api/`. The adapter supplies the trusted `context.ip` for
IP-bound grants. Private `data/` files are bundled with token and output functions
and are never published as static assets. Security headers apply to static assets
and function responses.

For local testing with Netlify routing, environment variables, and functions, run:

    netlify dev --port 8889

The lightweight `npm start` server remains available for standalone development.
Development dependencies are required for type checking; run `npm install` first.

## Output access and one-second expiry

1. Put your valid JSON data in `data/output.json`, outside `public/`.
   Remove any old `public/output.json` before deploying: static files bypass function authentication.
   No output data was supplied, so this release includes no output.json.
2. Generate a random secret with:

       node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

   Set it as `OUTPUT_ACCESS_PASSWORD` in your local .env and Netlify environment.
   This is now purely the server-side encryption key for the `/output` grant —
   `/token` no longer checks it against anything the caller sends, so it never
   needs to be shared with any client.
3. Send GET `/token?purpose=output` (no credential required).
   A successful response contains Bitcoin and Ethereum prices (`bitcoin.price`,
   `ethereum.price`, USD), plus `val`, `issuedAt`, `expiresAt`,
   and `expiresInMs: 1000` in the same JSON object.
   A fresh grant is created after the price lookup, including when prices
   came from the cache.
   If prices are unavailable, the response is 503 and contains no grant.
   Verified stale prices retain their `mode: stale` label.
   Plain `/token` with neither an `Authorization` header nor `?purpose=output`
   remains prices-only, with no grant issued.
4. Immediately send GET `/output` with header `Authorization: Bearer <val>`.
   Use `/output?format=text` for the original JSON file as text/plain, or
   `/output?format=json` (the default) for application/json.
   Tokens are not accepted in URL query parameters.
   Anyone can now request a `val` grant from `/token`; what still limits
   access to `/output` is the grant's 1-second lifetime and its binding to
   the requesting IP — not a shared secret.

The token encrypts and authenticates a millisecond timestamp, random nonce, and
client IP using AES-256-GCM. The timestamp is captured after prices are ready,
just before the response is serialized. Requests more than 1,000 ms later are rejected with HTTP 401;
exactly 1,000 ms is accepted. An IP mismatch returns HTTP 403. Missing/invalid
credentials return 401, and a missing server secret returns 503.

Every client follows the same rules regardless of browser or User-Agent.
Only formatting changes between JSON and text; the data is the same.
The endpoint reads and validates JSON only; it never executes file contents.

The encrypted token carries the timestamp, so expiry works across separate
Netlify function instances without an in-memory timestamp map. Each issued token has its
own lifetime; issuing another token does not revoke earlier tokens. This is
expiry validation, not single-use enforcement: a token can be reused from the
same IP within its one-second lifetime. Multiple clients behind the same public
IP cannot be distinguished by IP alone.

On Netlify, the function adapter uses the platform's trusted `context.ip`.
Locally it uses the socket IP and ignores forwarded headers.
Network latency and cold starts may exceed this strict one-second window;
the client must then request a new access token. No automatic grace period is added.

Authenticated requests return 404 if the data file is absent, or 500 if it is
invalid JSON. GET and HEAD are supported on output; other methods return 405.
Redeploy after changing the data file or secret.

### Node client

Set `API_BASE_URL` in .env to the exact local URL printed by `npm start`
or your HTTPS Netlify domain. `OUTPUT_ACCESS_PASSWORD` is server-side only now
and this client does not need it. Keep the local server running, then run in
a second terminal:

    node --env-file=.env call-output.cjs

The included client calls `/token?purpose=output` (no credential), immediately
passes `val` to `/output?format=text`, and prints the prices and returned data.
It does not execute downloaded content. Network latency and cold starts can
still make the one-second grant expire.

Shared provider utilities live in `lib/`, outside the public folder and API entrypoints. Only the local router in `scripts/` combines routes for local development.

## Real data and failure handling

The markets function requests 50 assets with names, logos, prices and seven-day chart history. The token function independently requests Bitcoin and Ethereum USD prices using CoinGecko's lightweight price endpoint. Successful token GET requests log both prices to the Node console (Netlify function logs when deployed).

Each upstream attempt has an 8-second timeout, with at most one retry for transient failures. Authorization failures and rate limits are not immediately retried. Netlify synchronous functions support up to 60 seconds; the browser waits up to 25 seconds.

Market responses are cached for 45 seconds, token responses for 15 seconds. Requests share an in-flight fetch within the same instance. After failure, verified cached prices can be returned for at most 15 minutes, labeled `mode: stale`. A cold instance with no cached data returns HTTP 503 with an explicit error and Retry-After header, never fabricated prices. These caches are per warm function instance, not persistent or shared across instances. CoinGecko outages and plan limits can still make data unavailable.

The browser preserves recent verified data on refresh failures and marks it delayed. Charts support price hints by hovering, tapping, or using keyboard arrow keys.

Keep the API key server-side in the environment, never in frontend code. Rotate any key previously shared publicly.

## Verification

    npm test

Tests use mocked provider responses and local HTTP requests. They cover separate function exports, Netlify configuration, route aliases, market/token responses, retry/failure handling, stale-data behavior and chart helpers. They do not prove a live CoinGecko connection or a successful Netlify deployment.

    npm run typecheck

The original token/output handlers currently have pre-existing behavior mismatches
with the documented contract: token behavior depends on User-Agent and a `name`
file parameter, and output file selection uses `purpose`. The migration preserves
that behavior. The existing full test suite reports nine failures in those areas;
the Netlify adapter tests validate routing, response conversion, trusted IP handling,
and bundled private file access separately.
