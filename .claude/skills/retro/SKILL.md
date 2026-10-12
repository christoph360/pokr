---
name: retro
description: Run a retrospective after a feature is finished and turn the findings into concrete improvements to the agent definitions. Use when the user runs /retro or asks for a retrospective.
argument-hint: <feature-name>
---

Run a retrospective for the feature: $ARGUMENTS

## 1. Gather evidence
- The feature spec in `docs/specs/` and its acceptance criteria.
- What each agent was asked to do and what it handed back (from this conversation).
- Rework: where the orchestrator or the user had to correct an agent, retries, failed tests,
  contract mismatches between frontend and backend, boundary violations.
- The QA report in `docs/qa/<feature>-report.md`: defects found, which agent's work they
  came from, and defects that slipped past QA (found later by the user).
- `git log` / `git diff` for the feature if the repo has history.

## 2. Ask the user
Before concluding, ask the user (briefly) what went well and what frustrated them. Their view
outranks your own inference.

## 3. Write the retro
Create `docs/retros/YYYY-MM-DD-<feature>.md`:

```markdown
# Retro: <feature> (<date>)

## Outcome
Did it meet the acceptance criteria? What shipped, what didn't.

## Per agent
### frontend-dev / backend-dev / devops-engineer / qa-engineer / orchestrator
- Went well:
- Went wrong (with concrete example):
- Root cause: missing instruction | wrong instruction | missing tool | unclear handoff | other

## Changes applied
- `<agent file>`: <what changed and why>

## Deferred
- Ideas not applied yet, and why.
```

## 4. Improve the agents
For each root cause, propose the smallest change that would have prevented it:
- Recurring, general rule → edit the agent's main instructions.
- Specific gotcha → add one line under the agent's `## Learnings`, tagged with the feature.
- Shared convention → `CLAUDE.md`.
- Workflow problem → this skill or the workflow section of `CLAUDE.md`.

Show the proposed diffs to the user and apply only the ones they approve. Prefer editing or
removing existing lines over adding new ones; if a `## Learnings` section exceeds ~15 entries,
fold the durable ones into the main instructions and drop the stale ones.
