# F02 test plan: Story list

- Spec: `docs/specs/02-story-list.md` (Draft), `docs/specs/00-product-overview.md`, `docs/specs/01-rooms-and-voting.md` (rev 2)
- ADRs: 0001 (WebSockets + Hibernation), 0002 (EU jurisdiction, no personal data in logs)
- Inputs: F01 test plan and report, F01 retro (`docs/retros/2026-10-13-f01.md`)
- Author: qa-engineer
- Status: v1, written from the Draft spec before the contract exists. Message and field names are
  placeholders until `packages/shared` is published. **Section 6 (spec issues) must be resolved
  before implementation starts.** E2E tests are not written yet.

## 1. Approach and levels

Levels, principles and conventions are inherited from `F01-test-plan.md` section 1. Differences
and additions for F02:

- Test names start with the criterion ID: `F02-AC10: ...`. Extra scenarios use `F02-X-...` and
  are mapped to the nearest AC in the report.
- New spec files under `e2e/tests/`: `stories-manage.spec.ts` (AC2-AC5), `stories-voting.spec.ts`
  (AC1, AC6-AC9, AC12-AC13), `stories-estimate.spec.ts` (AC10-AC11, AC15), `stories-agenda.spec.ts`
  (AC14, progress), `stories-protocol.spec.ts` (raw WS: validation, authorization, races),
  `stories-a11y.spec.ts`, `stories-markdown.spec.ts` (AC8 XSS corpus). Tags as in F01
  (`@cross-browser`, `@chromium-only`).
- Pure logic with many cases is tested as a table, with an **independent oracle** in
  `e2e/helpers/` (not imported from the app): quick picks (AC10), sum (AC15), progress (AC14).
  The app's own unit tests (frontend-dev) cover the same functions; QA reviews that their tables
  include the cases in section 2.
- Raw WS clients (built on `packages/shared`, ping on by default per the F01 learning) carry
  races, authorization, validation limits and seeding. Browser contexts carry what a user sees.
  Max 4 contexts per test (WebKit limit, `BrowserPool` stays).
- Locators: role, label, `data-testid`. `<dialog>` that is closed stays in the DOM: assert
  hidden, not count 0 (F01 learning).
- Before filing a defect, rule out the harness: raw clients ping, state-version waits instead of
  timing, CI-like worker count (F01 learning).
- Final runs under `CI=1` with 2 workers; three consecutive green runs, one of them the CI run.
- Firefox cannot launch on the QA machine; Firefox coverage comes from CI.

## 2. Coverage table (F02-AC1 to F02-AC15)

"Ctx" = browser contexts for the e2e part; "+raw" = additional raw WS clients. "SI-nn" means the
row depends on the resolution of that spec issue (section 6); the proposed resolution is assumed
and marked in the test plan so tests can be adjusted if the user decides otherwise.

| AC | Level | Scenarios | Ctx |
| --- | --- | --- | --- |
| AC1 | e2e; backend; frontend unit | Change story source Free topic -> Story list in settings: topic input/display is replaced by the active-story area (SI-03: empty state "no story selected" until one is chosen) for all contexts without reload. Stories added in story mode survive Story list -> Free topic -> Story list (same ids, order, estimates, history). Round is reset on each switch (votes cleared everywhere, state `voting`/idle, own card deselected). With votes cast or revealed: confirmation dialog (SI-01); Cancel changes nothing; Confirm switches and clears. Raw: switch without `confirmReset` with votes present gets `confirmation_required`; non-facilitator switch rejected `not_allowed` in both control modes. Free-topic text after round trip (SI-01). Issue-tracker value is not offered / rejected (SI-02). Switch while a story is active: active cleared on both switches (SI-01). Switch to the same source is not a change. Late joiner and reload see the correct mode. | 3 |
| AC2 | e2e; backend (validation); frontend unit (form) | Add with title only; with title+description+link; all visible to all contexts. Title boundaries 0 (blocked), whitespace-only (blocked), 1, 200 ok, 201 blocked client and server (raw). Emoji/ZWJ/combining titles counted in graphemes (SI-05). Description 0 (optional), 5,000 ok, 5,001 rejected, multi-line allowed with line breaks preserved (SI-05). Link: `https://a.example/x`, `http://a.example`, uppercase scheme ok; rejected: `javascript:alert(1)`, `data:`, `ftp:`, `//host`, `example.com`, `http://`, whitespace inside, `http://user:pw@host` (SI-05), overlong (>2048). Optional fields can be cleared by editing to empty. Duplicate titles allowed, distinct ids. Control characters/newline in title rejected. HTML in title rendered as text. Add as non-facilitator rejected (raw, both control modes). New story appended at the end, status pending, visible to all within the realtime tolerance. Add during `voting` and `revealed` round does not touch votes or summary (AC18 of F01). | 2 +raw |
| AC3 | e2e (paste); backend (atomicity); frontend unit (parser) | Paste 3 lines: 3 stories in order. Blank lines and whitespace-only lines dropped; CRLF, LF and CR separators; trailing newline; per-line normalization (trim, collapse spaces). 1 line = 1 story. 100 lines ok; 101 rejected entirely (SI-06). A single over-length line (201): whole paste rejected, nothing added, error names the line number, text stays in the textarea (SI-06). Control character in a line. Bulk at 150 existing stories + 51 lines: rejected entirely with `story_limit` and remaining capacity (SI-06); 150 + 50 ok (exactly 200). Two clients bulk-adding at the same time near the cap: total never exceeds 200, each paste applied entirely or not at all. Bulk by non-facilitator rejected. Paste of lines containing `<script>`: inert text. Pasted list markers (`- `, `1.`, `[ ]`) are kept as typed (SI-06). One WS message, so one rate-limit token (SI-25). | 2 +raw |
| AC4 | e2e; backend; manual (real touch device) | **Edit**: change title/description/link, all contexts see it; edit of active story updates the active-story area live and does not touch votes (SI-08); invalid edit keeps old values and shows an inline error. **Delete**: unestimated, unactive story deleted without confirmation; estimated story asks for confirmation (Cancel keeps it, Confirm removes it, sum and progress update); active story with votes asks for confirmation (SI-07); deleting the active story clears the round and active state for everyone; raw delete of an estimated story without `confirmDelete` gets `confirmation_required`; race where the story became estimated after the client's check still ends in a confirmation (mirror of F01-AC28). **Reorder, pointer**: drag story 3 to position 1 with the mouse (CDK uses pointer events; Playwright `mouse.down/move/up` in steps); all contexts see the new order; active/estimated flags travel with the story. **Reorder, keyboard**: move up / move down buttons per row (names include the story title); first row's "move up" and last row's "move down" disabled; focus stays on the moved item's control after the list re-renders; live-region announcement "<title> moved to position n of m" (SI-26). **Mobile**: move up/down controls available at 390 px without hover; real touch drag is manual. Stale reorder (SI-09): two raw clients/two tabs move relative to a story that was deleted or moved concurrently, outcome defined, no duplicate or lost story, both converge. Non-facilitator edit/delete/reorder rejected (raw, both control modes). Edit/delete/move of unknown id: `story_not_found`. | 3 +raw |
| AC5 | e2e (seeded); backend | Seed 199 via hook, add one via UI: 200 ok. Add 201st: rejected, UI shows the limit message, add controls disabled at 200. Delete one at 200: add works again. Bulk at cap: AC3. Two concurrent single adds at 199: exactly one wins, the other gets `story_limit`. The cap counts pending, estimated and skipped stories (SI-10). Counter "200 of 200" or equivalent visible. | 1 +raw |
| AC6 | e2e; backend | Control mode "everyone": voter sees and can use reveal, reset and "Next story" (SI-04); voter does not see add/edit/delete/reorder/accept/skip/story-select controls (absent from DOM). Observer never sees reveal/reset/next. Control mode "facilitator only": voter sees none. Raw WS from voter: add/edit/delete/reorder/accept/skip/select -> `not_allowed` in both modes; reveal/reset/next allowed only in "everyone". Switching control mode live updates the voter's controls. After handover the new facilitator gets story management and the old one loses it (SI-22). Voter pressing Next while an unsaved round exists: confirmation, same as facilitator (SI-12). | 3 +raw |
| AC7 | e2e; backend | Facilitator selects story B: it is active for all contexts (agenda marker, active-story area, announcement), a new round starts (votes cleared, `voting`, cards enabled, own card deselected). Selecting while the current round has an unsaved round: confirmation (SI-12). Selecting the already active story is a no-op (SI-12). Selecting a story that was deleted a moment ago: `story_not_found`, UI resyncs. New round id differs from the previous (stale-command guard, SI-12). Auto-reveal on: selecting does not reveal (no votes yet). Offline voters' votes in the old round are cleared (F01-AC19). Selection works for pending, skipped and estimated stories (AC12/AC13 variants). Late joiner after selection sees the active story and an empty round. | 3 |
| AC8 | e2e (render); frontend unit (sanitizer corpus); manual (visual check on long text) | Title, description, link shown above the cards for all contexts including observers and late joiners; update live on edit. Markdown rendered: paragraphs, emphasis, lists, inline and fenced code, blockquote (allow-list per SI-19). **XSS corpus** (each as description and as title): `<script>`, `<img src=x onerror>`, `<svg onload>`, `<iframe>`, `<a href="javascript:...">`, `[x](javascript:...)`, `[x](data:text/html,...)`, `[x](vbscript:...)`, mixed-case/entity-encoded schemes (`jav&#x61;script:`), `![img](https://tracker.example/pixel.png)` (SI-19: not rendered as image, no request made), raw `<style>`, `<form>`, `<meta refresh>`, `<base>`, autolink of a `javascript:` URL, nested/malformed Markdown, HTML in link text, event-handler attributes. Assertions: a `dialog`/`pageerror`/console error listener sees nothing, no `script/iframe/img/style/form` element and no `on*` attribute inside the story area, all `a` have `http(s)` `href`, `rel` contains `noopener noreferrer` and `target=_blank` (SI-19), no network request to the image host (`page.on("request")`). Link field rendered as a link with the same rules; the link host is visible as text. Pathological input (5,000 `>` or `[`, deeply nested lists) renders in under 1 s and does not freeze the page. 5,000-char description does not push the cards out of reach: collapsed with "show more" or scrollable (SI-20); cards still operable by keyboard. Headings in Markdown do not create page-level `h1`/`h2` (axe heading-order) (SI-19). 320 px: no horizontal overflow with a long unbroken title/URL. | 2 |
| AC9 | e2e; backend | Agenda A(estimated) B(pending) C(pending) D(skipped) E(pending); active none: Next -> B. Active B estimated -> Next -> C. Active C, Next -> E (D skipped is not offered; SI-11). Active E, Next: wraps to earlier pending only if one exists (SI-11), otherwise button disabled and "All stories estimated or skipped" shown, and raw Next is rejected with `no_next_story`. Active story not estimated, with revealed or unrevealed votes, Next: confirmation (SI-12), then previous story returns to pending, its round is discarded and the new round starts. Active story not estimated without votes: Next without confirmation. Next after reordering follows the new order. Next after deleting the active story (active none) goes to first pending. Two voters (everyone mode) press Next together: exactly one advance, no story skipped (SI-12 stale guard). Next from an estimated story that is being re-voted. Empty agenda: Next disabled. | 3 +raw |
| AC10 | e2e (table-driven via raw voters + UI); frontend unit (pure function); backend (card validation) | Oracle table (decks Fibonacci, Modified Fibonacci, Powers of 2, T-shirt, custom numeric, custom mixed): votes -> expected consensus pick and median pick (SI-13). Cases: consensus 5,5,5 -> picks "5" (consensus and median coincide: shown once, SI-13); 3,5 -> no consensus, median 4 -> 5; 3,8 -> 5.5 -> 8; 5 only -> no consensus, median 5; 2,3,5 -> 3; 1,13,13,21 -> consensus none, median 13; 0,½ -> ½; ½,½ -> consensus ½; `?`,`?` -> none; 5,5,`?` -> consensus 5 (specials don't break it, same as F01-AC15); 5,`☕` -> only median 5, no consensus; T-shirt S,M,L -> median M, S,L -> L (upper median by deck position, SI-13); custom mixed deck by position; custom numeric deck entered unsorted ("8","1","3") -> picks by value, ties by deck order; zero votes -> no quick picks but full picker; all special -> no quick picks. Median equal to a card picks that card, not the next one. Picker shows every value card of the deck (specials excluded, SI-14); selecting a quick pick and a non-quick card both work; the chosen value is shown immediately to all. Raw: accept a card not in the deck -> `invalid_card`; accept before reveal -> `round_not_revealed`; accept by non-facilitator -> `not_allowed` (even in "everyone" mode); accept with a stale round id -> `stale_round` (SI-14). Picks are visible only to the facilitator (SI-14). Accept after handover is only possible for the new facilitator. | 3 +raw |
| AC11 | e2e; backend (persistence, history, privacy) | After accept: story shows estimated state and value in the agenda for all contexts; sum and progress update. Reload/late joiner/reconnect: same. Estimate survives `drop_memory` (backend + e2e smoke). **History**: a story's detail (SI-16) shows the accepted round's votes by participant name and card, for all contexts; contains the final round, not an earlier reset round; special cards included; observers not listed; zero-vote accept gives an empty history. Participant who later leaves/is purged/removed: history still renders, name policy per SI-16. A voter renamed later: history keeps the name at accept time (SI-16). During a re-vote the old history stays visible and the new round's hidden votes appear nowhere (frame inspection, section 4.1). Re-accept replaces the snapshot (SI-16). Backend: persisted shape inspected through the test storage dump (H2): history contains votes only of a revealed-and-accepted round; storage has no per-vote data of the in-progress round beyond the existing round state. Logs contain story ids only (section 4.6). | 3 |
| AC12 | e2e; backend | Estimated story (5): facilitator selects it again: it becomes active, new round starts, the old estimate "5" still shows in the agenda and in the sum, marked "re-voting" (SI-10). Reveal and Next without accepting: estimate unchanged, history unchanged. Accept new value 8: estimate 8, sum updated, history replaced. Reset during re-vote: estimate unchanged. Mode switch / deck change during re-vote: estimate unchanged. Delete during re-vote with confirmation. Voter cannot start a re-vote by selecting (not_allowed), but Next/reset per AC6. Progress count unchanged during re-vote. | 2 |
| AC13 | e2e; backend | Skip a pending story: status "skipped" with text cue, no estimate, progress denominator per SI-18, sum unaffected. Skip the active story (SI-10): round discarded, active cleared (or advances, per resolution), confirmation if votes. Skip an estimated story rejected `story_estimated` (SI-10). Skipped story can be selected and voted (becomes estimated on accept; if left without accept stays skipped, SI-10), and restored to pending by an explicit action. Next ignores skipped. Non-facilitator skip rejected. Skipped status and estimate persist across reload and `drop_memory`. | 2 +raw |
| AC14 | e2e; frontend unit (progress) | Agenda lists all stories in order with status text (pending, active, estimated, skipped) plus estimate; one story can be active and estimated at once (re-vote). Progress "x of y estimated" updates live in all contexts for: accept, re-accept (no change), delete estimated, delete pending, add, skip, un-skip, selection. 0 stories: "No stories yet" (no `NaN`, no "0 of 0"); all skipped (SI-18). Observer, voter and late joiner see the identical agenda. Active row marked with `aria-current` and a non-color cue. 200 stories: renders and scrolls, the active story is scrolled into view on change, interactive within 1 s of load (indicative). Titles with HTML are text. 320 px width: no horizontal scroll. | 3 |
| AC15 | e2e; frontend unit (pure function, decimal arithmetic); backend (none) | Oracle table: estimates {1,2,3} = 6; {½,½,½} = 1.5; {½,1} = 1.5; {0,0} = 0; Fibonacci 21+13+8 = 42; Modified Fibonacci 100+40+20 = 160; Powers of 2 64+32; custom numeric with decimals {0.1,0.2} = 0.3 (no `0.30000000000000004`); {0.125,0.125} = 0.25; large {100 x 200} = 20000. Deck T-shirt: no sum shown. Custom mixed deck: no sum. No estimates: no sum or "0" (SI-17). Special cards cannot be estimates (SI-14). Estimates not parseable under the current deck (deck changed after estimating, SI-15): excluded and flagged ("n estimates not counted"). Sum updates live after accept, re-accept, delete of estimated story, deck change. Sum visible to observers and late joiners. | 2 |

## 3. Additional scenarios (implied by the spec, not listed)

IDs `F02-X-<area>-n`. [level]

### 3.1 Interaction with F01 rules
- X-F01-1 [e2e + raw] Auto-reveal on, story mode: idle room (no active story) never auto-reveals
  and cards are disabled; after selecting a story, the round reveals when the last online voter
  votes; the facilitator then sees quick picks; auto-reveal does not auto-accept.
- X-F01-2 [e2e] "Facilitator votes" off: facilitator has no cards but can select, reveal, accept;
  summary and quick picks computed from voters only; facilitator alone in the room (no voters):
  reveal shows "no votes", no quick picks.
- X-F01-3 [e2e] Observer: sees agenda, active story, summary, history; no cards, no controls.
  Observer switch while a story is active and votes exist: F01-AC26 unchanged.
- X-F01-4 [e2e + raw] AC18 of F01 in story mode: after reveal votes and summary are frozen even
  though edit/add/reorder are allowed; edit of the active story's title does not alter the summary;
  deck change with confirmation and mode switch with confirmation are the only ways to discard a
  revealed round (plus reset, select, next, delete of the active story).
- X-F01-5 [e2e] Reset in story mode: same active story, votes cleared, estimate (if any) and
  history unchanged, round id changes; reset with a new topic is rejected or ignored in story mode
  (SI-03); reset when no story is active -> `no_active_story`.
- X-F01-6 [e2e] Deck change mid-agenda (F01-AC28 + SI-15): stories keep estimates as text, round
  resets, quick picks use the new deck, sum behaves per SI-15; deck change from Fibonacci to T-shirt
  hides the sum; back again restores it.
- X-F01-7 [e2e] Facilitator handover: while the old facilitator has the add/edit dialog open, the
  handover happens; save is rejected `not_allowed`, the dialog shows an error and keeps the draft
  (SI-22). New facilitator sees quick picks if the round is revealed; old one's in-flight accept is
  rejected. Claim after 5 min offline (test-mode threshold): claimant can manage stories.
- X-F01-8 [e2e] Facilitator offline in "facilitator only" mode: agenda is read-only for everyone,
  no progress possible (documented, not a defect); in "everyone" mode voters can reveal/reset/next.
- X-F01-9 [e2e] Participant offline with a vote when a new round starts through select/next:
  vote cleared (F01-AC19); purge rule counts the start of any round as a reset (SI-24).
- X-F01-10 [e2e] Removal of a participant during an unrevealed story round: vote disappears; after
  accept, removal leaves the history snapshot per SI-16.
- X-F01-11 [e2e] Hidden votes in story mode (F01-AC11 regression): see 4.1.
- X-F01-12 [e2e] Story source stays across rooms: two rooms in one browser do not share agenda.

### 3.2 Races and ordering (backend + raw clients, 200 repetitions where cheap)
- X-RACE-1 Two Next commands (everyone mode) at once: exactly one advance (SI-12).
- X-RACE-2 Accept vs reset/select/next from another client: accept either applies to the round the
  facilitator saw or is rejected `stale_round`; never writes an estimate for a round that was
  not revealed or that belongs to another story.
- X-RACE-3 Accept vs delete of the same story: one of them wins; accept gets `story_not_found`;
  no orphaned estimate in the sum.
- X-RACE-4 Delete of the active story vs a vote: vote rejected with a defined code (no active
  story / round gone), no vote stored for a deleted story.
- X-RACE-5 Select story X vs select story Y concurrently: final state is one of them on every
  client; round id strictly increases; no half-applied state (story A active with round of B).
- X-RACE-6 Reorder vs delete vs reorder (stale anchors, SI-09): converged identical order, no
  duplicates, no lost stories.
- X-RACE-7 Add at 199 x2, bulk at near cap x2 (AC5/AC3).
- X-RACE-8 Edit vs edit (two tabs, same facilitator): last write wins per field, both tabs converge,
  loser sees the new values (SI-08).
- X-RACE-9 Vote vs reveal vs accept chain at the same time: the F01 invariant (every vote is in
  the reveal or rejected) holds, and the history contains exactly the revealed votes.
- X-RACE-10 Handover vs accept (X-F01-7 raw variant); mode switch vs vote; deck change vs accept.
- X-RACE-11 Reconnect while a bulk add is in flight: the message is applied once or not at all,
  never twice (client must not auto-resend on reconnect; F01-AC29 says no vote is queued).

### 3.3 Negative paths and validation (raw WS, backend)
- Malformed story payloads: missing title, wrong types, array instead of string, title with
  `\u0000`, `\n`, bidi override characters, zero-width-only, 201 graphemes, 20 KB title.
- Description 5,001 graphemes; description of 5,000 combining marks (byte-size cap, SI-05);
  CRLF normalization; lone surrogates.
- Link: scheme list in AC2 row; 2,049 chars; `http://[::1]/`; unicode host; credentials; spaces.
- Unknown story id, id of another room's story, id of deleted story for every command.
- Commands in the wrong state: accept in `voting`, accept with no active story, skip/select/next
  with empty agenda, reset in idle.
- Story commands in Free topic mode: rejected `wrong_mode` (SI-01), state unchanged. Topic
  commands in story mode (SI-03).
- Reorder anchor equal to the moved story, anchor in another room, duplicate ids in a bulk order.
- Oversize frame (bulk of 100 x 200-char titles is ~20 KB and must pass; 1 MB frame fails cleanly).
- Rate limit: 20 messages per 10 s still applies; 100 lines in one bulk = 1 message (SI-25).
- Message before join, double join, removed token: unchanged F01 behavior for story commands.

### 3.4 Input and rendering
- Unicode in titles/descriptions: emoji ZWJ, RTL, combining marks, full-width, `½` and `☕`
  typed into titles, homoglyph duplicates. Counting unit per SI-05.
- Long unbroken tokens at 320 px in agenda row, active-story area, delete confirmation,
  history, announcements.
- Whitespace: leading/trailing/internal runs normalized in titles; description keeps internal
  newlines and indentation (code blocks).
- Right-to-left title inside an LTR list: order and `dir` handling does not break the controls.

### 3.5 Lifecycle and persistence
- Reload during: add dialog open, bulk preview, delete confirmation, accept picker, reorder drag.
  Dialog state is lost gracefully; server state intact.
- `context.setOffline` for a voter during select/next/accept: after reconnect the voter sees
  the current active story, round state, estimates, order (changes made during the outage included);
  the facilitator going offline mid-edit keeps a draft and can retry after reconnect (SI-22).
- `drop_memory` (hibernation hook) with 3 stories, one estimated with history, one skipped, one
  active in `revealed` round: next message processed with identical agenda, round, history, order.
- `abort` hook: same state after reconnect.
- Three consecutive stories (vote, reveal, accept, next) x3: no state bleeding (votes, summary,
  quick picks, history), progress "3 of 3 estimated".
- Long session: add 200, estimate 100, delete 50, reorder 20: counts consistent.
- Browser back/forward between start page and room keeps the agenda.
- Room expiry/deletion (F03) is out of scope here, but stories and history must be part of
  "all room data" in F03-AC2: flagged to the F03 test plan.

## 4. Cross-cutting checks

### 4.1 Hidden-vote frame inspection in story mode (F01-AC11 regression)
- Re-run the F01 recorder (`page.on("websocket")`, custom deck of unique 4-char tokens) with a
  story list: while any story's round is in `voting`, no non-owner client receives any vote token,
  in the join snapshot, agenda updates, story selection, Next, accept, history, reconnect resync.
- **History leak check**: re-vote of an estimated story. The history of the earlier round is
  allowed in frames (it was revealed), but the current round's tokens are not. Use different tokens
  per round so the test can tell them apart.
- Each story's history appears only after its accept; an unrevealed or rejected round never
  appears. Reset rounds never appear in history.
- Frame size per message is recorded (feeds 4.7).
- Backend test (dev agent, spec-mandated by F01-AC11) must be extended to story-mode snapshots.

### 4.2 Reconnects and offline
- As F01 4.2. Additional assertions: agenda, active story, order and estimates after reconnect
  equal the server state (compare to a context that stayed online); no duplicated stories after
  reconnect; no command re-sent automatically (bulk add count stays correct).

### 4.3 Accessibility
- axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa), fail on serious/critical, desktop and mobile
  viewport, on every new screen and state: room in story mode with empty agenda; agenda with
  mixed statuses; add-story dialog (with inline errors); bulk-add dialog with preview/error; edit
  dialog; delete confirmation; mode-switch confirmation; accept-estimate picker with quick picks;
  active-story area with long Markdown description (headings, lists, code, link); history detail;
  200-story agenda; story list as voter and as observer; room with reorder in progress.
- Keyboard-only pass through the story flow, no mouse: switch to story mode, add story, bulk add,
  select story, vote with arrows/Space, reveal, accept a quick pick, Next story, edit, move up/down,
  skip, delete with confirmation (Escape cancels, focus returns to the row/the trigger), open
  history. Visible focus (2.4.7, 2.4.11), no traps, dialogs trap and restore focus, logical tab
  order. 200 rows x action buttons is a tab-stop problem (SI-26): measure tabs to reach the
  cards from the top of the page; expect a skip link, roving tabindex or per-row menu.
- **Reorder without dragging** (WCAG 2.5.7): move up/down are single-pointer, always visible.
  Live region announces the result with title and position ("moved to position 3 of 12"), also at
  the boundaries ("already first"); focus is not lost when the list re-renders (focus stays on the
  control of the moved item).
- **Live-region announcements**: active story changes announced politely ("Now voting: <title>"),
  exactly once, also for voters; accepted estimate announced ("<title> estimated 5"); story added
  / deleted / skipped by the facilitator announced to others at most politely and without flooding
  (bulk add of 100 = one announcement). Asserted via live-region content and counts.
- Cards keep their F01 accessible names; the agenda is a list (`list`/`listitem` or table) with
  per-row status text; status and estimate have text, not only color or icon; progress exposed as
  text (and `progressbar` role only if it has a name and value).
- Move/skip/delete buttons have accessible names including the story title.
- Target size >= 24 px for row actions (2.5.8). Reflow 320 px. `prefers-reduced-motion`: drag
  and reorder animations off. Forced colors and 400% zoom: manual.
- Markdown output: link text meaningful, "opens in new tab" cue as text for `target=_blank`,
  headings downgraded (no `h1`), lists/code blocks navigable. Manual: VoiceOver pass over active
  story announcement and reorder.

### 4.4 Browsers and devices
- Projects as F01 (chromium, firefox via CI, webkit, mobile-chrome Pixel 7 as configured). Full
  F02 suite on chromium; `@cross-browser` for AC1, AC2, AC4 (keyboard reorder), AC7, AC8
  (XSS corpus: sanitizers and DOM differ per engine), AC9, AC10, AC11, AC14, AC15, a11y and the
  hidden-vote check. Heavy race and 200-story tests chromium only.
- Mobile viewport: add/bulk/edit/delete dialogs usable at 390 px, move buttons reachable, agenda
  collapsible or scrollable without hiding the cards, cards still below the active story.
- Drag-and-drop on touch (iOS Safari, Android Chrome) cannot be emulated reliably by Playwright
  (touch drag needs pointer events from CDP and WebKit mobile emulation lacks them): **manual**
  on a real device, with the keyboard-equivalent buttons covered by e2e. Mouse drag on desktop
  engines is automated; if the DnD library cannot be driven reliably on WebKit, report as
  limitation, not skipped silently.

### 4.5 ADR 0001 checks
- Review: every story mutation is applied in the Durable Object, persisted to DO storage in the
  same turn as the broadcast, uses `acceptWebSocket`; no story state held only in memory.
- Resync is a full state or an explicit snapshot; clients do not rely on replay of story events
  (asserted by AC29-style tests in 4.2).
- `drop_memory` coverage: backend test that discards memory with stories, active story, round and
  history present (extend the F01-AC30 test).
- DO input gate rule (F01 retro): story handlers do no awaited I/O between read and write of the
  agenda, or the stress script (H5) proves ordering. QA will review handler code for `await` on
  fetch/timers between state read and write.

### 4.6 ADR 0002 and privacy
- Stories, descriptions, links and history are personal data candidates (they can contain names
  or customer data) and live only in the EU-jurisdiction DO storage. No D1/KV/R2 involvement in F02:
  check `wrangler.jsonc` diff and grep for new bindings.
- Backend test: capture `console` output for add, bulk, edit, delete, reorder, select, accept,
  skip and for validation failures; assert no title, description, link, estimate-linked name or
  vote value in any log line (IDs only: roomId, storyId, participantId). Validation error messages
  must not echo the offending text into logs (SI-27).
- Error responses to the client may name the line number but not echo content.
- Backend test that the single room helper is still the only path (F01-AC31 test still passes).
- Markdown images are not fetched (SI-19): no third-party requests from participants' browsers,
  which would leak IP addresses to a host chosen by the facilitator.
- Removal of a participant vs history (SI-16): privacy decision needed before sign-off.

### 4.7 Non-functional
- **Snapshot size**: seed 200 stories with title 200 chars, description 5,000 chars (ASCII and
  a variant of 4-byte emoji), 2,048-char link, 100 of them estimated with a 50-participant history.
  Record: size of the join snapshot, size of each broadcast after a single edit/reorder/accept,
  DO storage footprint (H2). Budgets (proposal, SI-21): join snapshot <= 1 MiB without
  descriptions (agenda summary), single-mutation broadcast <= 8 KiB (delta) or the snapshot
  budget if the design broadcasts full state; storage values under the Durable Object per-value
  limit (check Cloudflare docs at report time; 128 KiB per KV-API value and 2 MB per SQLite row
  are the numbers to verify). Fails when one oversized value makes a write throw.
- **Fan-out**: 200 stories, 50 raw connections, one reorder: wall-clock to last client <= 2 s locally
  (indicative; staging p95 deferred, as in F01).
- **Late join cost**: join with 200 max stories: page interactive (cards usable) in <= 3 s locally.
- **Rendering**: 200-row agenda interaction (select, reorder button) < 200 ms (indicative via
  `performance.now()` around the action).
- **Latency NFR (500 ms p95)** for select story / accept: non-gating perf measurement as in F01.
- **Stress** (F01 retro, deferred item): once `apps/api/scripts/stress.ts` is committed, run it
  with story commands (select/next/accept/reorder/bulk from 20 concurrent raw clients) and watch
  for `storage_busy_retry`, `internal_error` and command overtaking.

## 5. Test data, fixtures, helpers and requests to dev agents

### 5.1 QA-owned (in `e2e/`, after the contract exists)
- `helpers/stories.ts`: story-command helpers on raw clients; `addStoriesViaUi`, `seedStories`
  (wraps H1); `agendaOrder(page)` reads titles in DOM order; `expectAgenda(page, [{title, status,
  estimate}])`.
- `helpers/story-oracle.ts`: quick picks (consensus, median pick), sum with exact decimals,
  progress; independent implementation, table-driven with the cases in AC10, AC14 and AC15.
- `helpers/markdown-corpus.ts`: XSS and pathological inputs with expected "inert" assertions.
- `helpers/announcements.ts`: reads the live regions' text history (records mutations) to count
  announcements.
- `fixtures/room.ts` extended: `createRoom({storySource: "stories", stories: [...]})` via the API
  (fast path); raw clients seed small agendas.
- Config: no new projects; story specs participate in the existing matrix. A seeding-heavy spec
  (200 stories) is `@chromium-only`.

### 5.2 Requests to backend-dev (packages/shared, apps/api)
- R-B1: Contract first: story model (id, title, description, link, status, estimate, optional
  reserved tracker reference), `storySource` setting, agenda in room state, `activeStoryId`,
  `round.id` (strictly increasing), commands (add, bulk add, edit, delete with `confirmDelete`,
  move with relative anchor, select, next, accept, skip/restore) and error codes: `not_allowed`,
  `story_not_found`, `story_limit`, `invalid_story`, `invalid_link`, `confirmation_required`,
  `stale_round`, `round_not_revealed`, `invalid_card`, `no_active_story`, `no_next_story`,
  `story_estimated`, `wrong_mode`. The state `version` from F01 covers story changes.
- R-B2: Constants exported from `packages/shared` (limits 200/5,000/100/200 stories, link length,
  byte caps) so tests import them.
- R-B3: Test-mode hooks (return 404 outside test mode), see H1 to H5 below.
- R-B4: Backend tests QA will review: field validation and normalization; authorization matrix
  (every story command x role x control mode); cap and atomic bulk; confirmation rules; reorder
  convergence under concurrency; round id / stale guards; accept rules; persistence across
  `drop_memory`; hidden-vote inspection with stories (snapshots, history); logs contain no story
  content; `id.jurisdiction === "eu"` still asserted; snapshot size test (4.7); concurrency stress
  for story commands (F01 retro rule).
- R-B5: Quick-pick and sum functions in `packages/shared` as pure functions, if the server will
  ever validate or export them (F03 needs the sum); otherwise tell QA where they live.
- R-B6: History snapshot stored at accept time with name snapshot per SI-16, bounded size.

### 5.3 Test-mode hooks needed (H)
- **H1** `POST /__test/rooms/:id/stories` with `{count, titleLength?, descriptionLength?,
  emoji?: boolean, linkLength?, estimated?: number, skipped?: number}`: appends deterministic
  stories (titles like `Story 001 ...`) bypassing the message rate limit, still honoring the
  200 cap (test AC5 through the normal path). Needed because 200 single adds at 20 msg/10 s
  would take 100 s and a bulk message can carry only titles.
- **H2** `GET /__test/rooms/:id/storage` (or `/stats`): persisted keys with byte sizes and the
  history records, for size and privacy assertions.
- **H3** `drop_memory` / `abort` hooks (exist from F01) must work with story state; no new
  hook, but the contract for what survives must include agenda, round id, history.
- **H4** `POST /__test/rooms/:id/stories/:storyId/estimate` seeding an estimate with a history
  snapshot without playing a round (for sum and agenda tests with many estimates).
- **H5** Stress script `apps/api/scripts/stress.ts` committed (deferred item from the F01 retro)
  with story commands.
- **H6** Optional: reveal of server-side round id in the DOM/state for tests: `data-round-id`.

### 5.4 Requests to frontend-dev (apps/web)
- R-F1: `data-testid`s (plus roles/labels), at least: `story-source-select` (setting),
  `active-story`, `active-story-title`, `active-story-description`, `active-story-link`,
  `no-active-story`, `agenda`, `agenda-progress`, `agenda-sum`, `agenda-sum-excluded`,
  `story-row` (with `data-story-id`, `data-status`, `data-active`, `data-estimate`),
  `story-title`, `story-estimate`, `story-add`, `story-add-title`, `story-add-description`,
  `story-add-link`, `story-add-submit`, `story-bulk-open`, `story-bulk-text`,
  `story-bulk-preview`, `story-bulk-submit`, `story-bulk-error`, `story-edit-<id>`,
  `story-delete-<id>`, `story-delete-confirm`, `story-delete-confirm-ok`,
  `story-delete-confirm-cancel`, `story-move-up-<id>`, `story-move-down-<id>`,
  `story-select-<id>`, `story-skip-<id>`, `story-restore-<id>`, `story-history-<id>`,
  `next-story`, `accept-open`, `quickpick-consensus`, `quickpick-median`, `accept-card-<slug>`,
  `accept-confirm`, `mode-switch-confirm`, `story-limit-notice`, `agenda-announcer` (live
  region), `story-announcer`.
- R-F2: Story-mode view must keep `topic-display` absent (not hidden) and
  `data-state-version` on the room root continues to work.
- R-F3: Markdown renderer isolated and unit tested with the XSS corpus; no image support; link
  `rel`/`target` per SI-19; no `innerHTML` of unsanitized content.
- R-F4: Pure functions with table-driven unit tests: quick picks, sum (exact decimals), progress
  counts, bulk-paste parser (line splitting, normalization, error line numbers).
- R-F5: Focus management after reorder, after dialog close, after delete; live-region
  announcements as in 4.3.
- R-F6: Tab-stop strategy for 200 rows (SI-26).
- R-F7: Disabled card state and message when there is no active story.

### 5.5 Requests to devops-engineer (via orchestrator)
- R-D1: Nothing new expected; confirm CI e2e job timeout accommodates the added specs
  (estimate +40 % runtime on chromium) and that test-mode vars are still absent in staging and
  production. Commit `apps/api/scripts/stress.ts` run as an optional CI job (backend-dev writes it).

## 6. Spec issues

Blocking (B) issues change the contract, the data model or user-visible behavior that the tests
cannot guess. Non-blocking (NB) issues have a safe default that implementation may adopt; tests
assume the proposal until the user decides otherwise.

| ID | B/NB | Area |
| --- | --- | --- |
| SI-01 | B | Mode switch semantics |
| SI-02 | B | Where story source is set, issue-tracker value |
| SI-03 | B | Story mode with no active story; topic in story mode |
| SI-04 | B | "Start rounds" in control mode "everyone" |
| SI-05 | B | Text rules for description, link, units, byte caps |
| SI-06 | B | Bulk paste edge cases and atomicity |
| SI-07 | B | Delete confirmation and deleting the active story |
| SI-08 | NB | Editing, partial updates, concurrent edits |
| SI-09 | B | Reorder operation and stale reorder |
| SI-10 | B | Story status model, skip rules, re-vote display |
| SI-11 | B | "Next story" rules |
| SI-12 | B | Round lifecycle, unsaved round, stale-command guard |
| SI-13 | B | Quick picks: median, non-numeric decks, ties, specials |
| SI-14 | B | What may be accepted, and when |
| SI-15 | B | Deck change mid-agenda |
| SI-16 | B | Round history: content, visibility, privacy |
| SI-17 | NB | Sum arithmetic and display |
| SI-18 | NB | Progress denominator and status display |
| SI-19 | B | Markdown allow-list, images, links |
| SI-20 | NB | Long description layout |
| SI-21 | B | Payload size and snapshot design |
| SI-22 | NB | Handover, claim, offline facilitator, open editors |
| SI-23 | NB | Auto-reveal and facilitator-votes-off in story mode |
| SI-24 | NB | Hibernation, reconnect, purge in story mode |
| SI-25 | NB | Rate limits and message counting |
| SI-26 | NB | Accessibility specifics |
| SI-27 | NB | Logging and ADR 0002 classification |
| SI-28 | NB | Cross-feature: F03 data needs, tracker reference |

### SI-01 (B) Mode switch semantics
**Issue.** AC1 says switching between "Free topic" and "Story list" "keeps the story list but
resets the current round". Unspecified: confirmation when votes exist (F01-AC28 requires it for a
deck change, which is the same loss); whether the active story survives the switch; what happens
to the free-text topic; whether a revealed round is reset (conflicts in spirit with F01-AC18);
status of the previously active story.
**Proposal.** Switching is a facilitator-only setting change that always resets the round. Same
rule as the deck change: if the current round has votes in either state and `confirmReset` is
false, the server rejects with `confirmation_required`; the client confirms first. On either
switch the active story is cleared (no story active after switching to Story list; the user picks
one) and story statuses and estimates are untouched. The free-text topic is kept in storage and
shown again when switching back to Free topic; reset with a topic is a Free-topic-mode operation.
Story commands in Free topic mode are rejected with `wrong_mode`. Selecting the same source is not
a change.

### SI-02 (B) Where the source is set; issue-tracker value
**Issue.** The overview lists story source as a room setting (Free topic, Story list, Issue
tracker), but F01-AC1 (create) and AC27 (change settings) don't list it and F02 doesn't say
where it is chosen, by whom, or what "Issue tracker" does before F05.
**Proposal.** Story source is a facilitator-only room setting, selectable on the start page
(default Free topic) and in the settings dialog (AC27 extended). Issue tracker is not selectable
and the server rejects it (`not_supported`) until F05. Update F01-AC1/AC27 wording in F02.

### SI-03 (B) No active story; topic in story mode
**Issue.** In Story list mode before a story is selected (empty agenda, all done, active
story deleted, after mode switch) there is no defined round state: can voters pick cards, can
anyone reveal, what does the UI show? F01 has only `voting`/`revealed`. Also F01-AC19/AC20
(topic set, reset with new topic) have no meaning in story mode.
**Proposal.** Add an `idle` condition: story mode with no active story has no round. Cards are
disabled with the message "No story selected" (voters) or an add/select prompt (facilitator);
vote, reveal, reset and accept are rejected with `no_active_story`. Voters see "Waiting for the
facilitator to add or pick a story" for an empty agenda. In story mode, topic set and reset-with-
topic are rejected (`wrong_mode`); the active story replaces the topic (AC1). Auto-reveal never
fires while idle.

### SI-04 (B) "Start rounds" in control mode "everyone"
**Issue.** AC6: "voters may also start rounds and reveal" while AC7 says the facilitator selects a
story and AC9 defines Next. It is not stated whether voters may select any story, use Next, or
only reset (restart) the round, nor whether they may skip or accept. A voter pressing Next
while the facilitator has not accepted discards the round.
**Proposal.** In "everyone" mode voters (not observers) may: reveal, reset (restart the current
story's round) and Next story (AC9). They may not select an arbitrary story, add/edit/delete/
reorder, accept or skip (AC6 second sentence; accept stays facilitator-only). Next with an unsaved
round uses the same confirmation (SI-12). In "facilitator only" mode voters have none of these.
Rename "start rounds" in the spec to name the exact commands.

### SI-05 (B) Text rules for story fields
**Issue.** F01 text normalization rejects newlines and collapses whitespace, which cannot apply to
a multi-line Markdown description; the spec says "chars" where F01 counts graphemes; link
validation is only "http(s) URL"; grapheme counting doesn't bound bytes (5,000 combining marks
could be megabytes); duplicate titles unaddressed.
**Proposal.** Title: F01 normalization (trim, collapse, no control chars/newlines), 1-200
graphemes. Description: normalize CRLF/CR to LF, trim leading/trailing blank lines, keep internal
whitespace and newlines, reject control characters other than LF and TAB, 0-5,000 graphemes.
Link: trimmed, absolute `http:` or `https:` only (case-insensitive scheme), host required, no
whitespace, no embedded credentials (`user:pw@`) since the link is shown to everyone, 2,048
characters max, stored as normalized by the URL parser. Every field also has a UTF-8 byte cap
(title 1,000, description 20,000, link 2,048) enforced server-side. Empty optional fields clear
the value. Duplicate titles are allowed. Client and server share one schema (as in F01).

### SI-06 (B) Bulk paste
**Issue.** Not specified: blank lines, lines over 200 graphemes, more than 100 lines, the 200
cap being hit mid-paste (partial add or reject), duplicate lines, pasted list markers, and where
the paste happens (a textarea, or a paste into the title field).
**Proposal.** A separate "Add several" textarea. Lines are split on CRLF/LF/CR; blank and
whitespace-only lines are dropped; each line is normalized as a title. The operation is
all-or-nothing, atomic on the server: more than 100 non-blank lines -> `too_many_lines`; any
invalid line (over 200 graphemes, control character) -> `invalid_story` with the 1-based line
number and no content echoed; total over 200 stories -> `story_limit` with the remaining capacity.
The client previews the count and line errors before sending and keeps the text on failure. Markers
like `- ` are not stripped. Duplicates are allowed. A bulk is one message for rate-limit purposes.
New stories are appended in line order.

### SI-07 (B) Delete confirmation
**Issue.** AC4 requires confirmation "if estimated". Not covered: deleting the active story
(with an unsaved round), who enforces the confirmation, what happens to the round, whether undo
exists.
**Proposal.** Confirmation is required when the story is estimated, or is active with a non-empty
round. The server enforces it with `confirmDelete` / `confirmation_required` (mirrors
F01-AC28) so a stale client can't bypass it. Deleting the active story discards its round, clears
the active story (idle, SI-03) and the history. Skipped and pending inactive stories delete
without confirmation. No undo in F02 (state it).

### SI-08 (NB) Editing
**Issue.** Not stated: effect of editing the active story (votes reset?), partial vs full update,
concurrent edits from two tabs, edit while revealed, editing the estimate.
**Proposal.** Editing never touches rounds or votes. An edit is a patch of changed fields with
last-write-wins per field; the broadcast carries the new values and any open editor shows a
"changed by someone else" notice. Editing a revealed story's title is allowed (F01-AC18 protects
votes and summary only). The estimate can't be edited here (SI-14).

### SI-09 (B) Reorder
**Issue.** "Reorder by drag-and-drop and by keyboard" doesn't define the operation. An index-based
"move to position n" is wrong when the list changed in between (another tab, a delete, a bulk
add). The effect on the active story and on Next is not stated. 200 stories moved one step at a
time is impractical.
**Proposal.** The contract uses a relative move: `{storyId, afterStoryId | null (= top)}`. If either id
no longer exists the server answers `story_not_found` and the client resyncs; the server never
applies a move to a different story. Moving up/down is computed by the client against its current
view and sent as the same relative move. Reordering does not affect the active story or round;
Next follows the new order. Add "move to top" and "move to bottom" next to up/down. Reorder is
persisted and broadcast as the new complete order of ids (or an equivalent that converges).

### SI-10 (B) Status model, skip, re-vote display
**Issue.** Statuses are pending, active, estimated, skipped, but "active" overlaps with the
others (an estimated story being re-voted is both). Unspecified: what happens to status when an
active story is left without accepting; skipping the active story; skipping an estimated story;
un-skipping; selecting a skipped story.
**Proposal.** Persisted status is `pending | estimated | skipped`; "active" is derived from the
room's `activeStoryId`, so the UI may show active and estimated together (with "re-voting"). Leaving
an active story without accepting leaves its persisted status unchanged (pending stays pending,
skipped stays skipped, estimated keeps its estimate and history). Skip: allowed for pending stories
(skipping a skipped one is a no-op), rejected for estimated (`story_estimated`; use re-vote and delete). Skipping the
active story discards its round and leaves no active story (confirmation if the round has votes,
SI-12). A skipped story can be selected and voted (accept makes it estimated) and restored to
pending by an explicit "Restore" action.

### SI-11 (B) Next story
**Issue.** "Next story makes the next unestimated story in agenda order active" leaves open: next
relative to what (active, or top of list), whether skipped counts as unestimated, wrapping, what
happens to the current story if not estimated, what happens when none remains, and who may press
it with no active story.
**Proposal.** Next = the first story with persisted status `pending` after the active story in
agenda order; if none after it, wrap to the first pending before it. With no active story, the
first pending in the list. Skipped stories are never picked by Next (they can be selected). The
current story is left per SI-10 and its round is discarded after the unsaved-round confirmation
(SI-12). When no pending story remains, Next is disabled, the UI says "All stories are estimated
or skipped", and the server rejects with `no_next_story`. Active story selection is atomic with
the new round.

### SI-12 (B) Round lifecycle, unsaved round, stale commands
**Issue.** Select story, Next, reset, re-vote, skip, delete, mode switch and deck change all start
or discard rounds, with no common rule about confirmation, and none protects against a
command based on an out-of-date view (two voters pressing Next, a facilitator accepting a round
that was meanwhile reset and re-revealed in "everyone" mode). It's also undefined whether these
count as "reset" for the F01-AC21 purge.
**Proposal.** Define **round id** (strictly increasing, changes on every new round) and
**unsaved round** (>= 1 vote and either `voting`, or `revealed` and not accepted for this round).
Select, Next, Skip, Delete of the active story and mode switch require confirmation only when
the round is unsaved (server-enforced with a confirm flag, as F01-AC28); after an accept the
round is "saved" and moving on needs none. Accept, Next and Skip carry the round id (and Select the
target story id); a mismatch is rejected with `stale_round` and the client resyncs. Selecting the
already active story is a no-op; reset keeps the story and starts a new round. Every command that
starts a new round counts as a reset for the purge rule (F01-AC21). Re-vote is "select" on an
estimated story, with no extra confirmation unless the current round is unsaved.

### SI-13 (B) Quick picks
**Issue.** "Consensus value", "median rounded up to the next deck card" are underspecified for:
median exactly on a card (next = strictly greater?); non-numeric decks (T-shirt, mixed custom) where
F01-AC15 omits a median; unsorted custom numeric decks; special cards; ties; a single vote;
zero value votes; both picks identical.
**Proposal.** Consensus pick = the F01-AC15 consensus card (>= 2 value votes, all equal, specials
ignored); absent otherwise. Median pick:
- numeric decks: median over numeric votes as in F01-AC15 (even count = mean of the middle two);
  pick = the smallest value card with value >= the median (equal counts, so median 5 -> 5; 5.5 ->
  8); ties (equal values, e.g. "1" and "1.0") broken by deck order; the deck is ordered by value
  for this purpose even if a custom deck was entered unsorted;
- non-numeric decks (T-shirt, mixed custom): votes ordered by deck position, **upper median**
  (even count: the higher of the two middle cards); no averaging;
- specials ignored; one value vote -> median pick is that card, no consensus; no value votes ->
  no quick picks.
If both picks are the same card it is shown once, labeled both. The full picker always lists all
value cards. The median is never above the deck's highest card, so a pick always exists.

### SI-14 (B) What may be accepted, and when
**Issue.** "Any card from the deck" includes `?` and `☕`, which are not estimates; accept
timing (only revealed? only the active story? repeat accept? change a typo without re-vote?);
a free value not in the deck; who sees the picker.
**Proposal.** Only value cards are acceptable (use Skip for "can't estimate"); the final estimate is
stored as the card string; free values are out of scope. Accept is allowed only in `revealed`
state for the active story, by the facilitator only (even in "everyone" mode), carrying the round
id (SI-12); errors `round_not_revealed`, `invalid_card`, `stale_round`, `no_active_story`.
Accepting again on the same revealed round overwrites the estimate (typo correction); changing it
later needs a re-vote. Accept does not change the round (votes stay frozen, F01-AC18) and does not
advance. The picker and quick picks are shown to the facilitator only; others see "facilitator is
choosing the estimate" is optional. Revealed round with no votes can be accepted with any value card.

### SI-15 (B) Deck change mid-agenda
**Issue.** F01-AC28 resets the current round on a deck change; estimates already accepted were
chosen from the old deck. Not specified what they become, whether they count in the sum, and
whether the active story's estimate survives.
**Proposal.** Accepted estimates and history are immutable text and are kept on deck change
(they are never re-mapped or cleared). The active round is reset per F01-AC28. The sum (AC15) is
shown only when the current deck is numeric and counts the estimates that parse as decimals;
others are excluded and flagged ("2 estimates not counted: deck changed"). A deck change that
makes the deck non-numeric hides the sum; changing back shows it again. History cards render as
stored even if not in the new deck.

### SI-16 (B) Round history
**Issue.** AC11 says "the round history for the story keeps the final round's votes" without
saying: what exactly is kept (one round or all), where it is visible (F03's CSV needs "their vote
in the accepted round"; F02 has no UI for it, so it can't be verified in F02), whether names are
snapshots, and what happens to the history when a participant is renamed, purged or removed
(F01-AC23 "deletes the participant"; ADR 0002 data minimization, logs IDs only).
**Proposal.** Keep exactly one snapshot per story, taken at accept time: for each voter who
had a vote, `{participantId, nameAtAccept, card}` (specials included; observers and non-voters
absent), the round id and time. Re-accept replaces it. Earlier rounds, reset rounds and
unrevealed votes are never stored in history. Make it observable in F02: a read-only "Last round"
detail per estimated story, visible to everyone (the data was already public when revealed), so
it can be verified now and F03 reuses it. Names are snapshots; a renamed participant keeps the
old name there. On removal (F01-AC23) the name in the snapshot is replaced by "Removed
participant" and the vote is kept; purged participants keep their snapshot name until the room
expires (F03). Confirm that retaining names this way satisfies ADR 0002 (EU storage, IDs in logs).
Snapshot size is bounded (<= 50 votes per story).

### SI-17 (NB) Sum arithmetic and display
**Issue.** Halves and custom decimals with binary floats; format; special cards; zero.
**Proposal.** Sum with exact decimal arithmetic (cards have <= 4 graphemes, so <= 3 decimals;
scale by 1,000). Display without trailing zeros, decimal point `.`, no thousands separator
("12.5", "13"); the card face `½` stays `½` in the agenda but the sum shows 0.5 units ("Halves are
shown as decimals", F01-AC15). Shown only when at least one estimate exists. Specials can't be
estimates (SI-14). Includes the old estimate of a story under re-vote (SI-10).

### SI-18 (NB) Progress and status display
**Issue.** "7 of 12 estimated": do skipped count in 12? What shows for zero stories? Where does
an active estimated (re-voting) story show?
**Proposal.** Denominator = all stories that are not skipped; skipped shown separately ("7 of 10
estimated, 2 skipped"); zero stories -> "No stories yet". All skipped -> "0 of 0 estimated, 2
skipped" rendered as "Nothing to estimate, 2 skipped". Each row shows a text status (pending,
active, estimated, skipped) and the estimate; an active estimated row shows both.

### SI-19 (B) Markdown allow-list, images, links
**Issue.** "Sanitized Markdown" doesn't say what is allowed. Images fetch third-party content
from participants' browsers (IP leak, tracking, ADR 0002 spirit). Raw HTML, link scheme, `rel`,
`target`, heading levels (page outline, axe) and tables are undecided. Tracker content (F05/F06)
reuses this renderer.
**Proposal.** CommonMark subset: paragraphs, line breaks, emphasis/strong, inline and fenced code,
lists (ordered, unordered), blockquotes, strikethrough, thematic break, headings (rendered as
non-heading styled text or at most `h4` so they don't break the page outline). No images (shown as
their alt text, never fetched), no tables, no raw HTML (escaped and shown as text, not stripped
silently). Links only `http:`/`https:`; other schemes render as plain text; every link has
`rel="noopener noreferrer nofollow"`, `target="_blank"`, and a visually hidden "(opens in new
tab)". Sanitization happens at render time on the client with a maintained allow-list sanitizer;
the server stores the raw Markdown. The XSS corpus in AC8 becomes the acceptance test. Title is
plain text (not Markdown).

### SI-20 (NB) Long descriptions
**Issue.** A 5,000-char description "above the cards" can push the cards off-screen, especially on
mobile.
**Proposal.** Description area has a max height (about 8 lines) with "Show more/less" (a button
with `aria-expanded`); the cards stay reachable without scrolling past the description.

### SI-21 (B) Payload size and snapshot design
**Issue.** 200 stories x (200 + 5,000 + 2,048 graphemes) is about 1.5 MB of ASCII and up to
about 6 MB with 4-byte characters, plus 200 x 50 history votes. Sending the full agenda in every
state message and join snapshot (as the F01 design does for room state) would exceed Durable Object
storage limits per value (verify against current Cloudflare docs: 128 KiB per KV-API value, 2 MB per
SQLite row), WebSocket frame limits, and F01's own oversize-frame rule, and would be broadcast on every small
edit. Not stated as a requirement anywhere.
**Proposal.** Add a requirement: the join/resync snapshot carries an **agenda summary** (id, title,
status, estimate, has-description flag, has-link flag, order) and the full text only of the active
story; descriptions are loaded on demand (`getStory`) or pushed for the active story. One story per
storage row/key, never one blob. Mutations broadcast deltas (or the summary). Budgets (tested): join
snapshot <= 1 MiB at 200 max-length stories, single-mutation broadcast <= 8 KiB, every storage value
below the platform limit. Backend and frontend agree on this in the contract before implementation.

### SI-22 (NB) Handover, claim, offline facilitator, open editors
**Issue.** Behavior of an open add/edit dialog when facilitator rights move, and during an outage;
who can progress when the facilitator is offline.
**Proposal.** All story commands authorize at processing time (F01-AC24: in-flight commands from
the old facilitator are rejected `not_allowed`). A rejected save keeps the draft text in the
editor and shows a message; a dialog opened by the old facilitator closes on handover with the draft
kept in an inline note. While the facilitator is offline in "facilitator only" mode nothing
progresses (documented); after 5 minutes any online participant may claim (F01-AC25) and manage
stories.

### SI-23 (NB) Auto-reveal and facilitator-votes-off in story mode
**Issue.** F01-AC16 re-evaluates auto-reveal on many events; select/next/mode switch/story delete
are new events; idle state needs a rule.
**Proposal.** Auto-reveal is never evaluated while idle (SI-03). A new round has no votes, so
select/next don't reveal. Deleting/skipping the active story goes idle. Mode switch resets the round.
"Facilitator votes" off: facilitator excluded from x/y and auto-reveal as in F01-AC35; their
story commands are unaffected. Accept never happens automatically.

### SI-24 (NB) Hibernation, reconnect, purge
**Issue.** F01-AC30 lists what survives eviction; stories are new.
**Proposal.** Extend the list: agenda (order, fields, statuses, estimates), active story id, round
id, history snapshots. Clients get the agenda summary with the full resync on reconnect, including
changes made while offline. Any new-round command resets for the purge rule (SI-12).

### SI-25 (NB) Rate limits and message counting
**Issue.** F01-AC37: 20 messages per 10 s per connection. Story management (reordering with keys,
many adds) can hit it; a bulk add of 100 lines is a single message.
**Proposal.** Each story command is one message; bulk = 1; no separate limit. Keyboard reorder
bursts beyond 20 in 10 s get `rate_limited`; the client coalesces (debounces) repeated
move presses and sends the final position, and keeps the list consistent on error. Set a max frame
size that allows the largest valid message (bulk of 100 x 200 graphemes x 4 bytes = about 80 KB).

### SI-26 (NB) Accessibility specifics
**Issue.** AC4 requires a keyboard reorder, but not the announcement, focus behavior, tab-stop
count or the pointer alternative (WCAG 2.5.7). Active-story announcement not stated (F01-AC33
live regions).
**Proposal.** F01-AC33 extended to F02: no serious/critical axe violations on all new
screens; keyboard-only users can add, bulk add, select, vote, reveal, accept, next, edit, reorder,
skip and delete; live-region announcements (polite, once) for active story change, accepted
estimate and reorder result; status and estimate in text; row actions reachable with <= 3 tab stops per
list (roving tabindex or per-row menu); focus stays with the moved item; move buttons always visible
(also on touch); animations respect `prefers-reduced-motion`.

### SI-27 (NB) Logging and ADR 0002 classification
**Issue.** Story title/description/link can contain personal or customer data; ADR 0002 says
"story content" must not be logged, but F01-AC32 lists only names, topics, votes, tokens.
**Proposal.** Extend F01-AC32 to include story titles, descriptions, links, estimates tied to a
name, and history snapshots; validation errors and exceptions must not include submitted text.
Stories live only in EU-jurisdiction DO storage (no D1/KV).

### SI-28 (NB) Cross-feature
**Issue.** The glossary says a story has an optional tracker reference; AC2 doesn't list it.
F03-AC6 needs per-participant votes of the accepted round and F03-AC7 per-round data in Free
topic mode, which F01/F02 don't store.
**Proposal.** Reserve a nullable tracker reference in the story model (not editable in F02). F02-AC11
history (SI-16) is the data source for F03-AC6. F03-AC7 needs a revealed-round log in Free topic
mode; flag it for the F03 spec review (not an F02 requirement).

## 7. Out of scope and deferred

- Importing from trackers (F05, F06), export (F03), room expiry and deletion (F03-AC2 must
  include stories and history: flagged).
- Real-device touch drag-and-drop, VoiceOver, Edge, real iOS, forced colors, 400% zoom: manual.
- Staging-only: EU jurisdiction of story storage (F01-AC31 check covers the same helper), p95
  latency of select/accept.
- Collaborative editing/undo of stories; a "clear all" action: not in the spec, no tests.

## 8. Entry and exit criteria

- Entry for writing e2e tests: all blocking spec issues (SI-01 to SI-07, SI-09 to SI-16, SI-19,
  SI-21) resolved and the spec updated to rev 2; contract published in `packages/shared`; hooks H1
  to H4 and R-F1 delivered.
- Exit (sign-off): every AC has a passing test or an explicit manual/deferred mark with reason;
  no open critical or major defects; axe clean (no serious/critical) on all new screens; hidden-vote
  inspection with stories passes; the snapshot size budgets hold; three consecutive full runs
  (`CI=1`, 2 workers, one of them the CI run) without retries; backend tests for validation,
  authorization matrix, atomic bulk and cap, confirmation rules, stale guards, persistence across
  `drop_memory`, logs without content, and the EU helper exist and pass.
