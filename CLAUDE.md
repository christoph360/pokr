# pokr

Planning-poker style voting app. Start with `docs/specs/00-product-overview.md`; each feature
has its own spec in `docs/specs/`. Acceptance criteria have IDs (e.g. `F01-AC11`). Reference
them in test names so coverage is traceable.

## Team

The main Claude session acts as **tech lead / orchestrator**: it breaks features into tasks,
delegates to the specialist agents below, integrates their results, and runs the retrospective.

| Agent              | Owns                                              | File                               |
| ------------------ | ------------------------------------------------- | ---------------------------------- |
| `frontend-dev`     | `apps/web/` (Angular)                             | `.claude/agents/frontend-dev.md`   |
| `backend-dev`      | `apps/api/` (Cloudflare Workers), `packages/shared/` | `.claude/agents/backend-dev.md` |
| `devops-engineer`  | `infra/`, `.github/`, `wrangler.jsonc` env/binding config, root tooling | `.claude/agents/devops-engineer.md` |
| `qa-engineer`      | `e2e/` (Playwright), `docs/qa/` (test plans, reports) | `.claude/agents/qa-engineer.md` |

An agent may read anything but only edits files it owns. Cross-boundary changes are requested
through the orchestrator, not made directly.

## Planned layout (pnpm monorepo)

```
apps/web/          Angular SPA
apps/api/          Workers API + Durable Objects (one DO per voting room)
packages/shared/   API + WebSocket message types shared by web and api — the contract
infra/             deployment scripts, environment docs
e2e/               Playwright end-to-end tests
docs/specs/        feature specs
docs/qa/           test plans and verification reports per feature
docs/decisions/    architecture decision records (ADRs)
docs/retros/       retrospectives, one file per feature
```

## Architecture decisions

Accepted ADRs in `docs/decisions/` are binding for all agents. Don't propose alternatives to an
accepted decision unless one of its "Revisit when" triggers has happened; if one has, say so
and suggest a new ADR.

- 0001: real-time transport is WebSockets on Durable Objects with the Hibernation API.
- 0002: all personal data is stored in the EU jurisdiction (Durable Objects, D1, R2); KV never
  holds personal data; logs contain IDs, not personal data.

## Feature workflow

1. Spec the feature in `docs/specs/<feature>.md`, including acceptance criteria.
2. Backend defines/updates the contract in `packages/shared/` first. In parallel, QA writes the
   test plan from the spec. Spec issues QA finds are resolved before implementation starts.
3. Frontend and backend implement in parallel against that contract; DevOps handles bindings,
   environments, and CI changes the feature needs; QA writes the e2e tests.
4. Each agent finishes with: `pnpm format:check`, `pnpm lint`, typecheck and its tests passing
   at the repo root; any dev server it started stopped; and a short handoff note (what changed,
   what's left, anything surprising).
5. QA verifies the feature and writes the report. Defects go back to the owning agent; the
   feature is done only after QA sign-off.
   The orchestrator opens the PR when verification starts, so the push and PR CI runs both
   happen during verification. Sign-off needs both runs green on the final commit.
   While QA runs verification, nobody edits `apps/` or `packages/` (dev servers reload and drop
   connections).
6. Run `/retro <feature>` to capture learnings and improve the agent definitions.

## Branches and CI

- Each feature is built on `feature/<id>-<slug>`. CI runs on every push to it; `main` only gets
  the feature once CI on the branch is green.
- QA's e2e suite is pushed to the branch as soon as it typechecks, so CI runs every browser from
  the start (red e2e before the implementation lands is expected).
- The orchestrator runs `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` before
  every commit.
- CI cancels a running build when a newer push arrives. Don't push while you still need the
  result of a running build; batch commits instead.

## Shared conventions

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Package manager: pnpm. Node: current LTS.
- Don't commit secrets; Workers secrets go through `wrangler secret`.
