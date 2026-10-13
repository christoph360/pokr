# pokr

A planning-poker voting app. Open a room link and vote within seconds, no account needed. It
runs on Cloudflare Workers with one Durable Object per room. The web app is Angular.

- Product and feature specs: [`docs/specs/`](docs/specs/00-product-overview.md)
- Architecture decisions: [`docs/decisions/`](docs/decisions/README.md)
- WebSocket protocol: [`packages/shared/README.md`](packages/shared/README.md)
- Environments, secrets and deployment: [`infra/README.md`](infra/README.md)
- Agent team and workflow: [`CLAUDE.md`](CLAUDE.md)

## Repository layout

```
apps/web/          Angular app
apps/api/          Workers API and room Durable Objects (also serves the built web app)
packages/shared/   message types and validation shared by web and api (the contract)
e2e/               Playwright end-to-end tests
infra/             environment and deployment docs
docs/              specs, ADRs, QA plans and reports, retros
```

## Local development

### Prerequisites

- Node 24 or later
- pnpm (`npm install -g pnpm`)

### Run the app

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts both servers, and Ctrl+C stops both:

| Name  | What                                                  | URL                   |
| ----- | ----------------------------------------------------- | --------------------- |
| `api` | `wrangler dev`: the Worker and room Durable Objects   | http://localhost:8787 |
| `web` | `ng serve`: forwards `/api` and WebSockets to the api | http://localhost:4200 |

Open http://localhost:4200 and create a room. To join as another person, open the room link in a
second browser or a private window. Both servers reload on code changes.

### Production-like setup (one server)

The deployed Worker serves the built web app itself. To run it that way:

```sh
pnpm --filter @pokr/web build
pnpm --filter @pokr/api dev
```

Then open http://localhost:8787.

### Checks and tests

```sh
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck
pnpm test           # unit tests: web, api (Workers runtime), shared
pnpm build
```

End-to-end tests (Playwright):

```sh
pnpm --filter @pokr/e2e exec playwright install   # once, downloads the browsers
pnpm test:e2e
```

- **Servers:** `pnpm test:e2e` starts its own servers with test mode on (`POKR_TEST_MODE:1`), and
  reuses servers already running on the default ports.
- **Stop `pnpm dev` first:** a dev server that isn't in test mode makes the suite stop at once with
  an error. Alternatively, set `E2E_API_PORT` and `E2E_WEB_PORT` to other ports.
- **One browser:** run a single browser with, for example, `pnpm test:e2e --project=chromium`.

### Good to know

- **Local data:** rooms are stored under `apps/api/.wrangler/`. Delete that folder to start fresh.
- **Rate limits** apply locally too: 5 room creations and 120 joins per minute per IP. They reset
  when `wrangler dev` restarts.
- **Port 8787 already in use:** usually a leftover `wrangler dev`. Find it with
  `lsof -i :8787`.
- **Test mode** is only for automated tests. Never set it in `wrangler.jsonc` or on a deployed
  Worker.
- **Local differences:** a few behaviours differ between local `wrangler dev` and Cloudflare (EU
  jurisdiction, some timing). These are checked on staging; see
  [`infra/README.md`](infra/README.md#staging-checks).
