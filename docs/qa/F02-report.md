# F02 verification report: Story list

- Spec: `docs/specs/02-story-list.md` rev 2. Plan: `docs/qa/F02-test-plan.md` (v2, section 9).
- Author: qa-engineer. Date: 2026-10-15.
- Build under test: `7c3fb66` (feature/F02-story-list), code freeze on `apps/` and `packages/`.
- Environment: macOS, local `wrangler dev --var POKR_TEST_MODE:1` (:8787) and `ng serve` (:4200), Playwright 1.61.1, `retries: 0`.
- Projects run locally: chromium, webkit, mobile-chrome (Pixel 7), under `CI=1` (2 workers). **Firefox cannot launch on this machine**; its coverage comes from CI.

## Verdict: BLOCKED (1 defect)

| ID | Severity | Owner | Summary |
| --- | --- | --- | --- |
| D1 | Major | frontend-dev | Drag-and-drop reorder moves the wrong story (see below) |

Everything else passes. Two full runs (`CI=1`, 2 workers) on chromium, webkit and mobile-chrome after the test fixes: 618 passed, 2 skipped by design, 2 failed. The two failures are the same test, the drag test (D1), on chromium and webkit. The mobile project does not run it (`@desktop-only`). Not yet done: the third green run (needs D1 fixed), Firefox in CI, the manual items below.

## Defects

### D1 (major, frontend-dev): dragging a story moves a different story

- **Steps:** Story list mode, facilitator, agenda One, Two, Three. Press on the grip (⋮⋮) of "Three", move up past "One" with the mouse, release.
- **Expected:** order Three, One, Two (`move_story {storyId: Three, beforeId: One}`).
- **Actual:** the drag preview shows "Three", but the agenda ends as Two, Three, One. The client sends `move_story {storyId: One, beforeId: null}`.
- **Same for other drags:** drag Two onto One, Three onto Two, and One onto Three all produce the same result: One goes to the end. The story that moves is always the first one.
- **Evidence it is the app, not the harness:** wrapping `AgendaPanel.onDrop` in the page (`ng.getComponent`) logs the CDK event: `drop previousIndex=0 currentIndex=2` for the drag of Three to the top. Indices are reversed (expected 2 and 0), so `onDrop` computes `ids[0]` = One. The drag itself starts (`.cdk-drag-preview` present, placeholder shown), the viewport was 1280x1600 so nothing auto-scrolls, and the wire message is `{storyId: One, beforeId: null}`. It fails on chromium and webkit, in 6 of 6 runs (including two full CI-condition runs). The harness only produces pointer events. Likely cause is in how `cdkDropList`/`cdkDrag` items are ordered in `agenda-panel.ts` (`@for` with `track view.row.id`, custom placeholder); the owner should check `event.previousIndex`/`currentIndex` against `views()`.
- **Test:** `F02-AC4: dragging a story with the mouse reorders the agenda for everyone` (`stories-manage.spec.ts`). Keyboard and button reorder (same file) pass.
- **Note:** frontend-dev's smoke script did not cover drag-and-drop.

## Test bugs found and fixed in `e2e/` (not product defects)

First run of the new suite: 25 failures on chromium (CI: 24 chromium, 13 mobile, 13 firefox, 19 webkit). All but D1 were harness:

| Cause | Fix |
| --- | --- |
| `expectRow` compared `data-status` with the stored status, but the UI shows the displayed status (`active` for the active row; estimate is in `data-estimate`). About 14 tests, all browsers. | `expectRow` now derives the stored status from `data-estimate` and `data-active` (`helpers/story-page.ts`) |
| Add and accept dialogs close asynchronously after a successful submit; the next action raced the closing dialog (webkit, mobile) | wait for the dialog hidden after submit and accept |
| The bulk dialog was left open before the next click (a11y test) | cancel it first |
| Tests voted while idle, or before the selection had arrived | select first and wait for the active title |
| `topic-input`/`topic-display` assumed in an empty-topic state | `topic-empty` |
| Quick picks live in the accept dialog, which must be opened first | `openPicker()` |
| T-shirt and custom non-numeric sum cases forgot `numeric: false`; tab characters in a title are control characters, not whitespace | fixed the table and the expectation |
| `cardGrid.boundingBox()` on an observer (no card grid) waited until the test timeout | count first |
| X-RACE-5 compared a state from before both selects were applied | quiesce with `resync` on each client, then compare |
| Rows read one at a time while rows were being removed | one atomic read of all titles |
| Pointer drag started from the row, not the grip, and from a point below the viewport | start at the grip, scroll into view, tall viewport |
| **Heartbeat:** the F01 test config (250 ms ping, connection declared dead after 375 ms) made the page reconnect on a loaded runner and swallow the next UI click ("You are not connected"), seen on webkit and mobile in story specs | story rooms use a 2 s ping (`makeStoryRoom`, `clientConfig` option) |

Not changed: two F01 reconnect tests (`connection.spec.ts` "changes made by others while offline", "removed while offline") and one claim test fail about 1 in 100 with the 250 ms heartbeat under 4 workers on HEAD, with the same "not connected" symptom. I reproduced the symptom on this machine on HEAD and did not on the F01 base commit `11ef34f` in 156 repeats, so it may be a regression of the F02 build, or load. **Open question for the orchestrator; not filed as a defect:** these did not fail in the two full runs (2 workers); I could not isolate whether the app's reconnect logic changed in F02. CI will show whether they recur.

## Results (CI=1, 2 workers)

| Run | chromium | webkit | mobile-chrome | Failing |
| --- | --- | --- | --- | --- |
| full3 | pass except 1 | pass except 1 | pass | drag test (D1) on chromium and webkit |
| full4 | same | same | same | same |

Totals per run: 618 passed, 2 skipped, 2 failed. The skipped tests are by design. No test was retried.

## Traceability: criterion to tests to result

Counts are distinct tests carrying the ID on chromium. `-g "F02-AC4"` selects the tests of a criterion. Result column: runs full3 and full4.

| AC | Tests | Spec files | Result |
| --- | --- | --- | --- |
| AC1 | 9 | stories-protocol, stories-manage | pass |
| AC2 | 40 | stories-protocol, stories-manage | pass |
| AC3 | 9 | stories-protocol, stories-manage | pass |
| AC4 | 16 | stories-protocol, stories-manage | pass except drag (D1) |
| AC5 | 5 | stories-protocol, stories-manage | pass |
| AC6 | 9 | stories-protocol, stories-voting | pass |
| AC7 | 5 | stories-protocol, stories-voting | pass |
| AC8 | 26 | stories-markdown (20-payload XSS corpus), stories-voting | pass |
| AC9 | 8 | stories-protocol, stories-voting | pass |
| AC10 | 24 | stories-protocol, stories-estimate (19-case table) | pass |
| AC11 | 8 | stories-protocol, stories-estimate | pass |
| AC12 | 2 | stories-protocol, stories-voting | pass |
| AC13 | 6 | stories-protocol, stories-voting | pass |
| AC14 | 6 | stories-protocol, stories-agenda | pass |
| AC15 | 17 | stories-protocol, stories-estimate | pass |
| AC16 | 10 | stories-protocol, stories-agenda, test-mode-off | pass |
| AC17 | 5 | stories-protocol, stories-agenda | pass |
| AC18 | 0 | backend log-capture test (backend-dev) | not covered here, see gaps |
| AC19 | 8 | stories-a11y (axe, keyboard-only, live regions, tab stops) | pass |
| AC20 | 2 | stories-protocol | pass |
| AC21 | 1 | stories-protocol | pass |
| Extra scenarios | F02-X-F01-1/2/7/8, X-RACE-1/2/4/5/6 | protocol, voting | pass |

370 F02 tests listed across 4 projects (chromium 227, firefox/webkit/mobile each a `@cross-browser` subset).

## Checks against the plan

- **Hidden votes in story mode (F01-AC11):** raw and browser frame inspection with unique tokens, including `get_story`, `resync`, join, reload, re-vote with a prior final round: pass.
- **Snapshot size (AC16):** 200 maximum-length stories (ASCII and 4-byte emoji, 100 estimated with 50-vote final rounds): join and resync frames under `SNAPSHOT_MAX_BYTES`; vote, reveal, reset and presence broadcasts carry no agenda; every storage row under 64 KiB: pass.
- **ADR 0001:** `drop_memory` and `abort` keep agenda, round, estimates and final rounds; offline client resyncs the agenda: pass.
- **ADR 0002:** story content stays in the room object (no new binding). `test-mode-off.spec.ts` starts a second `wrangler dev` without test mode and checks the story seeding, storage, instance, evict and timers hooks answer 404: pass.
- **Accessibility:** axe (wcag2a/aa, 21aa, 22aa) on all new screens and dialogs, desktop and phone: no serious or critical violations. Row actions are one tab stop (roving tabindex); keyboard-only flow passes; live-region announcements pass.

## Manual and deferred (still open)

- Touch drag-and-drop on a real phone (and, after D1, mouse drag on Safari/Firefox).
- VoiceOver pass over the active-story announcement and reorder.
- Edge, real iOS, forced colors, 400% zoom.
- Staging: EU jurisdiction of story storage (the F01-AC31 helper check covers the same helper), p95 latency of select and accept.
- **Firefox:** only in CI.

## Gaps and notes

- **AC18** (no story content in logs): needs the backend log-capture test; not an e2e check. QA to review that test at sign-off.
- AC20 "client coalesces repeated keyboard moves": the keyboard reorder test passes, but there is no message-count assertion.
- Mobile: `story-count` and the collapsed-agenda toggle are only exercised through the page object.
- Spec wording to check: a skipped story that is active shows only "active"; its skipped state is not visible until it is left.

## Flaky areas

- Story specs after the heartbeat fix: no flake in two full runs plus 15 to 30 repeats of the previously failing tests.
- F01 reconnect and claim tests with the 250 ms heartbeat: rare failures under 4 workers (see above); not seen with 2 workers.
