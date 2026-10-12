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

An agent may read anything but only edits files it owns. Cross-boundary changes are requested
through the orchestrator, not made directly.

## Planned layout (pnpm monorepo)

```
apps/web/          Angular SPA
apps/api/          Workers API + Durable Objects (one DO per voting room)
packages/shared/   API + WebSocket message types shared by web and api — the contract
infra/             deployment scripts, environment docs
docs/specs/        feature specs
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
2. Backend defines/updates the contract in `packages/shared/` first.
3. Frontend and backend implement in parallel against that contract; DevOps handles bindings,
   environments, and CI changes the feature needs.
4. Each agent finishes with: tests passing, typecheck clean, and a short handoff note
   (what changed, what's left, anything surprising).
5. Run `/retro <feature>` to capture learnings and improve the agent definitions.

## Shared conventions

- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Package manager: pnpm. Node: current LTS.
- Don't commit secrets; Workers secrets go through `wrangler secret`.
