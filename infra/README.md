# Infrastructure

pokr runs as **one Cloudflare Worker per environment** that serves both the API (`/api/*`, Hono +
Durable Objects) and the Angular SPA (Workers static assets). Same origin means cookies and
WebSockets work without CORS. Config lives in `apps/api/wrangler.jsonc`.

## Environments

| Environment | Worker name       | Deployed by                                          | Config           |
| ----------- | ----------------- | ---------------------------------------------------- | ---------------- |
| dev         | `pokr-dev`        | local `wrangler dev` (never deployed by CI)          | top level        |
| staging     | `pokr-staging`    | `deploy.yml` on every push to `main`                 | `env.staging`    |
| production  | `pokr-production` | `deploy.yml` via `workflow_dispatch`, needs approval | `env.production` |

Wrangler does not inherit `durable_objects`, `migrations` or `vars` into environments, so they are
repeated in each block. When you add a binding or migration, add it to all three.

Durable Object migrations: `v1` creates `RoomDurableObject` as a SQLite-backed class. Any class
rename, delete, or new class needs a new migration tag appended to `migrations` (never edit old ones).

## Data residency (ADR 0002)

- Durable Objects: obtain stubs only via `env.ROOM.jurisdiction("eu")`.
- D1 and R2: create with `--jurisdiction eu` in every environment, e.g.
  `wrangler d1 create pokr-staging --jurisdiction eu`. It cannot be changed afterwards.
- KV never holds personal data.

## Local development

```
pnpm install
pnpm dev          # wrangler dev on :8787 + ng serve on :4200 (proxies /api incl. WebSockets)
```

Open http://localhost:4200. `pnpm build` builds the web app first, then dry-runs the Worker bundle.

## Secrets and tokens

| Where                                                    | Name                                                                  | Purpose                   |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| GitHub repo (or environment) secret                      | `CLOUDFLARE_API_TOKEN`                                                | Deploy from CI            |
| GitHub repo (or environment) secret                      | `CLOUDFLARE_ACCOUNT_ID`                                               | Target account            |
| Worker secret (`wrangler secret put <NAME> --env <env>`) | per feature (OAuth client secrets, tracker token encryption key, ...) | Runtime secrets, none yet |

Never commit secrets or print them in logs. Local secrets go in `apps/api/.dev.vars` (git-ignored).

## One-time manual steps

1. **Cloudflare account**: create one, and subscribe to the **Workers Paid** plan (required for
   Durable Objects with SQLite storage beyond the free quota and for production use).
2. **API token** (dash.cloudflare.com > My Profile > API Tokens > Create Custom Token):
   - Account > Workers Scripts: Edit
   - Account > Account Settings: Read
   - Add later as features need them: D1: Edit, Workers R2 Storage: Edit
   - Zone > Workers Routes: Edit, only if a custom domain route is used
     Scope it to the pokr account only. Note the **Account ID** (Workers & Pages overview sidebar).
3. **GitHub secrets**: repo Settings > Secrets and variables > Actions: add `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. Optionally use a separate token per environment by storing them as
   environment secrets instead.
4. **GitHub environments** (Settings > Environments): create `staging` (no rules) and `production`
   with **Required reviewers** (and optionally restrict to the `main` branch). The production job
   will wait for approval.
5. **Workers subdomain**: first deploy needs a `workers.dev` subdomain registered on the account
   (the dashboard prompts for it). Custom domains/DNS are not configured yet; add `routes` to the
   env blocks when a domain exists.
6. **First deploy**: the first staging deploy runs when this lands on `main`. Production is run from
   the GitHub Actions tab (Deploy > Run workflow).
7. **Branch protection** on `main`: require the `verify` and `e2e` CI jobs.
8. **Local browsers**: `pnpm --filter @pokr/e2e exec playwright install` for firefox/webkit.
