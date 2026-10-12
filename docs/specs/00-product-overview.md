# pokr: product overview

- Status: Draft
- Date: 2026-10-12

## Vision

A fast, friction-free planning poker app. Anyone can open a room link and vote within seconds,
without an account. Teams that sign in can pull stories from GitHub or Jira and write the
agreed estimates back.

## Users and roles

| Role            | Who                                       | Can                                                             |
| --------------- | ----------------------------------------- | --------------------------------------------------------------- |
| **Facilitator** | Room creator, or whoever it was handed to | Change room settings, manage stories, reveal/reset (see control mode), remove participants, hand over the role, export |
| **Voter**       | Default for everyone joining              | Vote; reveal/reset only if control mode is "everyone"           |
| **Observer**    | Opt-in when joining, or switched later    | See everything, never votes, not counted for "all voted"        |

Exactly one facilitator per room. The facilitator can also vote (on by default).

Identity is **optional**:
- **Guest**: enters a display name. Identity is a random token in the browser; clearing it
  means rejoining as a new participant.
- **Signed-in user** (GitHub or Google): name and avatar from the provider, "my rooms" across
  devices, and required for issue tracker integrations.

## Room settings

Chosen at creation; the facilitator can change them later unless noted.

| Setting          | Options                                                         | Default            |
| ---------------- | --------------------------------------------------------------- | ------------------ |
| Name             | Free text, max 80 chars                                         | "Planning session" |
| Deck             | Fibonacci, Modified Fibonacci, T-shirt, Powers of 2, Custom     | Fibonacci          |
| Control mode     | Facilitator only, Everyone                                      | Facilitator only   |
| Story source     | Free topic, Story list, Issue tracker                           | Free topic         |
| Auto-reveal      | On / Off (reveal as soon as all voters have voted)              | Off                |
| Facilitator votes| On / Off                                                        | On                 |

Deck values:
- **Fibonacci**: 0, ½, 1, 2, 3, 5, 8, 13, 21, ?, ☕
- **Modified Fibonacci**: 0, ½, 1, 2, 3, 5, 8, 13, 20, 40, 100, ?, ☕
- **T-shirt**: XS, S, M, L, XL, XXL, ?, ☕
- **Powers of 2**: 0, 1, 2, 4, 8, 16, 32, 64, ?, ☕
- **Custom**: 1–20 unique cards, each 1–4 characters. `?` and `☕` are added automatically ([F01-AC34](01-rooms-and-voting.md)).

Changing the deck while a round has votes resets that round (with confirmation).

## Story source modes

1. **Free topic**: each round has an optional free-text title. No agenda. ([F01](01-rooms-and-voting.md))
2. **Story list**: the facilitator maintains an ordered agenda; the room votes stories one by
   one and stores a final estimate per story. ([F02](02-story-list.md))
3. **Issue tracker**: like story list, but stories are imported from GitHub or Jira and final
   estimates can be written back after facilitator confirmation. ([F05](05-github-integration.md), [F06](06-jira-integration.md))

## Domain glossary

- **Room**: a session with settings, participants, and either a current topic or a story list.
  Identified by an unguessable ID in its URL.
- **Participant**: a person in a room (guest or signed-in) with a role and online status.
- **Round**: one voting pass. States: `voting` → `revealed`. Reset starts a new round.
- **Vote**: a participant's card in a round. Hidden from everyone, including the facilitator,
  until reveal.
- **Story**: an agenda item with title, optional description and link, optional tracker
  reference, and a final estimate once accepted.
- **Final estimate**: the value the facilitator accepts for a story after reveal. It may differ
  from every card played.

## Features and build order

| #   | Feature                                                   | Depends on |
| --- | --------------------------------------------------------- | ---------- |
| F01 | [Rooms and voting](01-rooms-and-voting.md)                 | none       |
| F02 | [Story list](02-story-list.md)                             | F01        |
| F03 | [Export and retention](03-export-and-retention.md)         | F02        |
| F04 | [Accounts](04-accounts.md)                                 | F01        |
| F05 | [GitHub integration](05-github-integration.md)             | F02, F04   |
| F06 | [Jira Cloud integration](06-jira-integration.md)           | F02, F04   |

Each feature ends with `/retro <feature>`.

## Non-functional requirements

- **Real-time**: WebSockets on one Durable Object per room ([ADR 0001](../decisions/0001-realtime-transport.md)).
  A vote or reveal is visible to other participants within 500 ms (p95) under normal network
  conditions (≤ 100 ms round-trip time, measured from server receive to client render on staging).
- **Room size**: up to 50 participants (observers included). Typical: 5–15.
- **Devices**: mobile-first, responsive. Many people vote from their phone during a call.
- **Browsers**: last two versions of Chrome, Edge, Firefox, Safari (macOS and iOS). Automated tests run Chromium, Firefox, WebKit and iPhone emulation; Edge and real iOS devices get a manual smoke test per release.
- **Accessibility**: WCAG 2.2 AA. Voting fully keyboard-operable; reveal announced to screen
  readers; color is never the only signal.
- **Language**: English UI in v1; all strings externalized so translations can be added.
- **Privacy**: collect the minimum. Guests: display name only. Accounts: provider ID, name,
  avatar URL, email. Room data is deleted after inactivity ([F03](03-export-and-retention.md)).
  Account deletion removes all account data and tracker tokens.
- **Security**:
  - Room IDs are unguessable (≥ 80 bits of entropy); the link is the access control.
  - All input is length-limited and validated server-side.
  - Tracker content is rendered as sanitized text/Markdown, never raw HTML.
  - Rate limits on room creation, joins, and messages per connection (numbers in [F01-AC37](01-rooms-and-voting.md)).
  - Tracker tokens encrypted at rest; never sent to the browser.
- **Cost**: a typical team's usage stays within Cloudflare's paid-plan included quotas.
  Idle rooms hibernate.

## Out of scope for v1

Round timer, chat, reactions/emoji, room passwords, multiple facilitators, linking several
sign-in providers to one account, trackers other than GitHub and Jira Cloud, native mobile apps,
analytics dashboards across rooms.

## Open decisions (ADRs needed before the feature that needs them)

| Topic                                                         | Needed by |
| ------------------------------------------------------------- | --------- |
| ~~Data residency~~: decided, EU jurisdiction ([ADR 0002](../decisions/0002-eu-data-residency.md)) | F01 |
| Account and session storage (D1 vs Durable Objects; KV ruled out by ADR 0002), session mechanism | F04 |
| GitHub App vs OAuth App                                        | F05       |
| Encryption of tracker tokens (key management)                  | F05       |
