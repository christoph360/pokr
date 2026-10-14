# F02: Story list

- Status: Ready for implementation (rev 2, spec issues SI-01 to SI-28 from `docs/qa/F02-test-plan.md` resolved)
- Depends on: F01
- Owners: backend-dev (room Durable Object, contract), frontend-dev (UI), qa-engineer (test plan, e2e, sign-off)

## Goal

Estimate an agenda of stories in one session: vote each story, accept a final estimate, move on.
Issue tracker imports (F05, F06) reuse this list.

## User stories

1. As a facilitator, I add stories (title, optional description and link) before or during the session.
2. As a facilitator, I reorder, edit, and delete stories.
3. As a facilitator, I start voting on a story, and everyone sees which story is active.
4. As a facilitator, after reveal I accept a final estimate for the story.
5. As a participant, I see the agenda with progress and estimates.

## Definitions

- **Story source**: a room setting, `Free topic` (default) or `Story list`. It is chosen on the
  start page (extends F01-AC1) and changed by the facilitator in settings (extends F01-AC27).
  `Issue tracker` is not offered until F05 and the server rejects it.
- **Active story**: at most one story per room. Story list mode with no active story is **idle**:
  there is no round to vote on, cards are disabled with "No story selected", and vote, reveal,
  reset and accept are rejected with `no_active_story`. Auto-reveal never fires while idle.
- **Story status**: the stored status is `pending`, `estimated` or `skipped`. "Active" is derived
  from the active story, so a story being re-voted shows both "active" and its old estimate.
  Leaving the active story without accepting doesn't change its stored status.
- **Round id**: a strictly increasing number that changes with every new round. Accept, Next and
  Skip carry the round id they were based on; a mismatch is rejected with `stale_round` and the
  client resyncs.
- **Unsaved round**: the current round has at least one vote and is either in `voting`, or
  `revealed` with no estimate accepted in this round. Every command that would discard an unsaved
  round (select, Next, Skip or delete of the active story, mode switch) needs confirmation,
  enforced by the server with `confirmReset` / `confirmation_required` as in F01-AC28. Every
  command that starts a new round counts as a reset for the F01-AC21 purge rule.
- **Story text rules** (shared schemas, client and server identical):
  - **Title**: F01 text normalization, 1–200 graphemes, at most 1,000 UTF-8 bytes. Plain text,
    never Markdown. Duplicate titles are allowed.
  - **Description**: optional Markdown, 0–5,000 graphemes, at most 20,000 UTF-8 bytes. CRLF and CR
    become LF; leading blank lines and trailing whitespace are trimmed; internal whitespace,
    newlines and tabs are kept; other control characters are rejected.
  - **Link**: optional, trimmed, absolute `http:` or `https:` with a host, no whitespace, no
    embedded credentials (`user:pass@`), at most 2,048 characters.
  - An empty optional field clears it.

## Acceptance criteria

### Mode
- **F02-AC1** Given story source "Story list", the free-text topic is replaced by the active story.
  - Switching between "Free topic" and "Story list" keeps the story list and all estimates, clears
    the active story and resets the current round (confirmation per "unsaved round").
  - The free-text topic is kept and shown again when switching back. In Story list mode, setting
    the topic or resetting with a topic is rejected with `wrong_story_source`.
  - Select, Next, accept and skip need Story list mode. Adding, editing, deleting and reordering
    work in both modes, so the agenda can be prepared before switching.

### Manage stories
- **F02-AC2** The facilitator can add a story with a title, an optional description and an
  optional link (text rules above). New stories are appended to the end of the agenda.
- **F02-AC3** The facilitator can bulk-add stories by pasting lines into an "Add several" field
  (one title per line).
  - Blank and whitespace-only lines are dropped; each line is normalized as a title. List
    markers such as `- ` are kept.
  - The paste is all-or-nothing: more than 100 lines, any invalid line (reported with its
    1-based line number, without echoing content), or exceeding 200 stories in total rejects the
    whole paste. The client previews the count and errors and keeps the text on failure.
- **F02-AC4** The facilitator can edit, delete, and reorder stories.
  - **Edit** changes only the given fields, last write wins, and never touches rounds or votes,
    including for the active story.
  - **Delete** needs confirmation (enforced by the server) when the story is estimated, or is the
    active story with an unsaved round. Deleting the active story discards its round and leaves
    the room idle. There is no undo.
  - **Reorder** by drag-and-drop and by keyboard (move up, down, to top, to bottom). A move is
    relative ("move story X before story Y" or "to the end"); if either story no longer exists
    the server rejects it and never applies it to another story. Reordering doesn't affect the
    active story or the round.
- **F02-AC5** A room holds at most 200 stories; adding beyond that is rejected with
  `story_limit_reached`.
- **F02-AC6** In control mode "everyone", voters (not observers) may also reveal and reset the
  active story's round. Only the facilitator can add, edit, delete, reorder, select, skip, restore,
  use Next and accept estimates, in both control modes. The server enforces this with
  `not_allowed`, checked when the command is processed (a command sent just before a handover is
  rejected; the client keeps any draft text).

### Voting a story
- **F02-AC7** The facilitator selects a story to vote on. It becomes active for everyone, and a new
  round starts (atomically). Selecting the already active story is a no-op; use reset to re-vote it.
- **F02-AC8** The active story's title, description and link are shown above the cards.
  - The description is rendered as sanitized Markdown, client-side, from the stored raw text:
    paragraphs, line breaks, emphasis, strong, strikethrough, inline and fenced code, ordered and
    unordered lists, blockquotes, thematic breaks. Headings render as styled text at most `h4`.
  - No images (alt text only, never fetched), no tables, no raw HTML (escaped and shown as text).
  - Links only `http:`/`https:` (others render as plain text), with
    `rel="noopener noreferrer nofollow"`, `target="_blank"` and a visually hidden "(opens in new
    tab)". The same rules apply to the story link.
  - Long descriptions are limited to about 8 lines with a "Show more" toggle (`aria-expanded`), so
    the cards stay reachable.
- **F02-AC9** "Next story" makes the first `pending` story after the active one in agenda order
  active, wrapping to the first `pending` story before it; with no active story, the first
  `pending` story. Skipped stories are never picked by Next. When no pending story remains, Next is
  disabled with "All stories are estimated or skipped", and the server rejects it with
  `no_next_story`.

### Final estimate
- **F02-AC10** After reveal, the facilitator accepts a final estimate for the active story.
  - Only value cards of the current deck can be accepted (`?` and `☕` can't; use Skip).
  - Quick picks:
    - **Consensus**: the F01-AC15 consensus card, if there is one.
    - **Median**: on numeric decks, the lowest value card at or above the F01-AC15 median (median
      4 gives 5; median 5 gives 5), with the deck ordered by value. On non-numeric decks, the upper
      median of the value votes by deck position (S and M give M). With one value vote, that card.
      Special cards are ignored; with no value votes there is no median pick.
    - If both picks are the same card it is shown once. Any value card of the deck can be picked
      as well.
  - The picker is shown to the facilitator only. A revealed round with no votes can be accepted.
- **F02-AC11** The accepted estimate is stored on the story, shown in the agenda, and the story is
  marked estimated.
  - Accepting again in the same revealed round overwrites the estimate. Accept doesn't change the
    round (F01-AC18) and doesn't advance to the next story.
  - The story keeps one **final round** snapshot, taken at accept time and replaced on re-accept:
    for each voter with a vote, the participant ID, the display name at that time, and the card.
  - Everyone can open an estimated story's "Last round" detail.
  - When a participant is removed (F01-AC23), their name in every snapshot becomes "Removed
    participant" and their vote is kept. Renames don't change snapshots.
- **F02-AC12** The facilitator can re-vote an estimated story by selecting it (or resetting it while
  active). Its estimate and final round are kept until a new estimate is accepted.
- **F02-AC13** The facilitator can skip a pending story (marks it "skipped", no estimate) and
  restore a skipped story to pending. Skipping an estimated story is rejected. Skipping the active
  story discards its round and leaves the room idle, or with "skip and next" makes the next story
  active in one step. A skipped story can still be selected and estimated.

### Agenda view
- **F02-AC14** Everyone sees the agenda with each story's status in text (pending, active,
  estimated, skipped), its final estimate, and progress.
  - Progress counts non-skipped stories: "7 of 10 estimated, 2 skipped". With no stories: "No
    stories yet".
- **F02-AC15** For numeric decks, the agenda shows the sum of accepted estimates.
  - Exact decimal arithmetic (`0.1 + 0.2` is `0.3`), no trailing zeros, `.` as separator; `½`
    counts as 0.5.
  - After a deck change, estimates are kept as text. The sum counts the ones that are numbers;
    others are excluded and flagged ("2 estimates not counted"). No sum on a non-numeric deck, or
    when there are no estimates.

### Cross-cutting
- **F02-AC16** Size: the join and resync snapshot carries the agenda (titles, links, status,
  estimate, a has-description flag) and the full text of the active story only; other
  descriptions and final rounds are loaded on demand. One story per storage row. Budgets, tested
  with 200 maximum-length stories: the snapshot is at most 1 MiB, and a broadcast caused by a vote,
  reveal or presence change doesn't carry the agenda.
- **F02-AC17** Persistence: F01-AC30 extends to the agenda (order, fields, statuses, estimates),
  the active story, the round id and final-round snapshots. Stories live only in the room's
  EU-jurisdiction Durable Object (ADR 0002).
- **F02-AC18** Logging: F01-AC32 extends to story titles, descriptions, links, estimates and
  final-round snapshots. Validation errors don't echo submitted text.
- **F02-AC19** Accessibility: F01-AC33 extends to all F02 screens.
  - Keyboard-only users can add, bulk add, edit, reorder, delete, select, vote, reveal, accept,
    skip and use Next.
  - Keyboard reorder announces the new position, and focus stays on the moved story. Move
    buttons are always visible (pointer alternative to dragging, WCAG 2.5.7).
  - The agenda doesn't need a tab stop per action per row (roving focus or a per-row menu).
  - A change of active story and an accepted estimate are announced once in a polite live region.
- **F02-AC20** Rate limits: each story command, including a bulk add, counts as one message
  (F01-AC37). The largest valid message (a 100-line bulk add) must fit the frame limit. The
  client coalesces repeated keyboard moves.

## Notes for later features

- The story model reserves a nullable tracker reference (F05, F06); not editable in F02.
- The final-round snapshot (AC11) is the data source for F03's per-participant export. F03-AC7
  (free-topic rounds) needs data neither F01 nor F02 stores; flagged for the F03 spec review.
- Room deletion (F03) must include stories and snapshots.

## Out of scope for F02

Importing from trackers (F05, F06), export (F03), undo, collaborative editing, a "clear all"
action, free-form estimates outside the deck.
