# F02: Story list

- Status: Draft
- Depends on: F01
- Owners: backend-dev, frontend-dev

## Goal

Estimate an agenda of stories in one session: vote each story, accept a final estimate, move on.
Issue tracker imports (F05, F06) reuse this list.

## User stories

1. As a facilitator, I add stories (title, optional description and link) before or during the session.
2. As a facilitator, I reorder, edit, and delete stories.
3. As a facilitator, I start voting on a story, and everyone sees which story is active.
4. As a facilitator, after reveal I accept a final estimate for the story.
5. As a participant, I see the agenda with progress and estimates.

## Acceptance criteria

### Mode
- **F02-AC1** Given story source "Story list", the free-text topic is replaced by the active story.
  Switching between "Free topic" and "Story list" keeps the story list but resets the current round.

### Manage stories
- **F02-AC2** The facilitator can add a story with:
  - title: 1–200 chars, required
  - description: max 5,000 chars, Markdown, optional
  - link: http(s) URL, optional
- **F02-AC3** The facilitator can bulk-add stories by pasting lines (one title per line; max 100
  per paste).
- **F02-AC4** The facilitator can edit, delete (with confirmation if estimated), and reorder
  stories by drag-and-drop and by keyboard (move up/down).
- **F02-AC5** A room holds at most 200 stories.
- **F02-AC6** In control mode "everyone", voters may also start rounds and reveal. Only the
  facilitator can add, edit, delete, or reorder stories and accept estimates.

### Voting a story
- **F02-AC7** The facilitator selects a story to vote on. It becomes active for everyone, and a new
  round starts.
- **F02-AC8** The active story's title, description (rendered as sanitized Markdown) and link are
  shown above the cards.
- **F02-AC9** "Next story" makes the next unestimated story in agenda order active.

### Final estimate
- **F02-AC10** After reveal, the facilitator accepts a final estimate. Quick picks are offered:
  the consensus value, the median rounded up to the next deck card, and any card from the deck.
- **F02-AC11** The accepted estimate is stored on the story, shown in the agenda, and the story is
  marked estimated. The round history for the story keeps the final round's votes.
- **F02-AC12** The facilitator can re-vote an estimated story. Its estimate is kept until a new
  one is accepted.
- **F02-AC13** The facilitator can skip a story (marks it "skipped", no estimate).

### Agenda view
- **F02-AC14** Everyone sees the agenda with status (pending, active, estimated, skipped), the
  final estimates, and progress ("7 of 12 estimated").
- **F02-AC15** For numeric decks, the agenda shows the sum of accepted estimates.

## Out of scope for F02

Importing from trackers (F05, F06), export (F03).
