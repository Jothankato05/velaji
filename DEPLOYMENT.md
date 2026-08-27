# Deploying Velaji / NCIHAP

This is a **prototype**. Before any real child's data touches it, work through
this checklist. Nothing here deploys automatically — it documents what a real
deployment needs.

> The API (`src/`, this repo root) and the web app (`web/`) deploy as two
> separate things: a Node service + a MongoDB database for the API, and a static
> site for the SPA.

## 1. Provision the database
- A real MongoDB (Atlas, self-hosted, or a managed instance). The in-memory
  fallback is **dev-only** and `env.ts` refuses to boot with it in production.
- Take `MONGODB_URI` from the provider (with credentials). Never commit it.

## 2. Generate real secrets
Two independent secrets, each ≥ 32 random chars — the app refuses to start in
production with the dev defaults:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CARD_SIGNING_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # AUTH_TOKEN_SECRET
```

## 3. Set the production environment
Set these on the host (never in a committed file):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your real Mongo connection string |
| `CARD_SIGNING_SECRET` | the generated value |
| `AUTH_TOKEN_SECRET` | the generated (different) value |
| `APP_BASE_URL` | the API's real public https URL (used to build QR links) |
| `CLIENT_URL` | the web app's real origin (CORS) |
| `PORT` | as the platform expects (default 4100) |

`src/config/env.ts` will refuse to start in production if `MONGODB_URI` is
missing, either secret is still a dev default, `ALLOW_IN_MEMORY_DB` is on, or
`APP_BASE_URL` points at localhost.

## 4. Terminate TLS in front
Run behind a TLS-terminating proxy/load balancer (the platform's, or nginx).
The app trusts the forwarded proto and sends HSTS in production. Traffic to the
API and the SPA must be **https**.

## 5. Build & run the API
```bash
npm ci
npm run build          # -> dist/
node dist/server.js    # or: docker build -t ncihap-api . && docker run ...
```
The provided `Dockerfile` builds a lean production image and its `HEALTHCHECK`
uses `/ready`.

- **Liveness:** `GET /health` → `{ ok: true }` (process up).
- **Readiness:** `GET /ready` → `200` only when the DB is connected; `503`
  otherwise. Point the load balancer's readiness probe here.

## 6. Build & host the web app
```bash
cd web
npm ci
npm run build          # -> web/dist (static)
```
Host `web/dist` on any static host/CDN. Point its API calls at the API origin
(the dev proxy in `web/vite.config.ts` is for local only; configure the deployed
origin per your host).

## 7. Create the first admin
There is no open registration. Create the initial account deliberately:
```bash
npx tsx src/scripts/createStaffUser.ts <username> "<password>" "<Full Name>" admin
```
(Run against the production `MONGODB_URI`.)

## 8. Before go-live — security & data
- Run the **pre-launch-security** review (headers, HTTPS/HSTS, login rate limit,
  body cap, dependency scan) — most items are already in place; verify against
  the deployed instance.
- **Encryption at rest** (§5) is a conscious decision for national child data —
  DB-level at minimum; field-level for the most sensitive fields is a follow-up.
- The routine immunization schedule (`src/data/`) is placeholder-grade — get
  **clinical sign-off** against current national guidance first.
- External integrations are honest stubs, not live: SMS (`SMS_PROVIDER=stub`),
  telephony, and NHIA (`nhiaIntegrationStatus: 'not_connected'`). Wire real
  providers behind their existing seams before relying on them.

## 9. Operate
- Back up MongoDB; test restores.
- Monitor `/ready`, error logs, and the login rate-limit 429s.
- Rotate `CARD_SIGNING_SECRET` / `AUTH_TOKEN_SECRET` on a schedule; rotating the
  auth secret invalidates live sessions (by design).
