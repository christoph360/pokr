# F01 verification report: Rooms and voting

- Spec: `docs/specs/01-rooms-and-voting.md` rev 2. Plan: `docs/qa/F01-test-plan.md` (v2).
- Author: qa-engineer. Date: 2026-10-13.
- Environment: macOS, local `wrangler dev --var POKR_TEST_MODE:1` (:8787) and `ng serve` (:4200), Playwright 1.61.1, `retries: 0`.
- Projects run: chromium (178 tests), webkit (61), mobile-chrome Pixel 7 (61). **Firefox was not run** (see Environment limits).

## Verdict: SIGNED OFF LOCALLY, pending Firefox in CI

Three consecutive full runs on chromium, webkit and mobile-chrome were green (`retries: 0`, clean `wrangler dev --var POKR_TEST_MODE:1`,
apps/api and apps/web frozen, no test edits between runs). All product defects found are fixed and verified (D2, D3).
Remaining before release: Firefox in CI (cannot launch on this machine), the staging checks and manual items listed below.

## CI result for 8b911ca and triage

First CI run (per-project matrix): firefox and mobile-chrome passed; chromium 1 failure, webkit 5 failures (error text not readable without GitHub auth).

| CI failure | Project | Triage |
| --- | --- | --- |
| a11y "join prompt, room..." , a11y "arrow keys move between cards", create-join "a voter joins with a 1-char and a 30-char name", create-join "joining as observer", vote "no vote value reaches any other client" (AC11) | webkit | **Test infrastructure bug T7 (fixed), not a product defect.** Playwright's WebKit build (26.5, v2311) hangs in `page.goto` after about 63 browser contexts in one browser process. Reproduced with a bare newContext/goto/close loop against the dev server (hang at context 63, then the browser dies). A worker reuses one browser for all its tests, so with 2 workers (CI) each worker hits the limit mid-run, once per worker, and the unlucky test times out at 30 s; with 4 workers and three projects locally the limit was never reached. Local CI-like repro (`webkit`, 2 workers) failed 2 tests per run, always the first tests after about 30 tests per worker, in 5 of 5 runs. Fix: `fixtures/index.ts` now gives each worker a browser that is relaunched after 30 contexts (`BrowserPool`). Webkit with 2 workers then passed. |
| create-join "joining as observer shows no cards..." | chromium | **Not reproduced.** CI-like runs (`CI=1`, fresh servers, 2 workers, also with the Angular vite dependency cache removed to simulate a cold runner): full chromium green twice; the test and the 1-char/30-char test repeated 40 times each: 80 of 80 green. Best hypothesis: a cold dev server on the GitHub runner reloading or delaying the join form (the same test failed on webkit); unproven. If it recurs, the Playwright report trace will show it. No product defect found. |

Findings about CI visibility (for devops-engineer):
- With the `github` reporter alone, failures appear only as annotations in the run summary; the job log has no error text. `e2e/playwright.config.ts` now also uses the `list` reporter on CI so the job log prints each failing test with its error. No change is needed to paths or working directory for that.
- The `playwright-report-<project>` artifact (HTML report with traces for failures) needs a token to download. Consider `--reporter=list,github,html` plus `if: always()` on the upload step (already present if it uses `always()`), and a `json` reporter output uploaded as a plain artifact if needed.
- Chromium is not installed in the webkit/firefox jobs (`playwright install ${{ matrix.browser }}`), so a global warm-up of the dev server using Chromium would not work there; I did not add one.

Verification after the fixes, CI conditions (`CI=1`, fresh `wrangler dev --var POKR_TEST_MODE:1` and `ng serve` started by Playwright, 2 workers), three consecutive full runs on chromium, webkit and mobile-chrome: **all green** (178 + 60 + 61 passed, 1 + 1 skipped by design, 0 failed in each run). Webkit alone with 2 workers, which failed 5 of 5 before the fix, is also green.

## Results

Final runs (X1 to X3). chromium 179 tests (1 skip by design), webkit 61 (1 skip), mobile-chrome 61:

| Run | chromium | webkit | mobile-chrome | Failing | `storage_busy_retry` | `reschedule_failed` | `broadcast_failed` | `internal_error` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X1 | 178 pass, 1 skip | 60 pass, 1 skip | 61 pass | none | 2 | 0 | 0 | 0 |
| X2 | 178 pass, 1 skip | 60 pass, 1 skip | 61 pass | none | 0 | 0 | 0 | 0 |
| X3 | 178 pass, 1 skip | 60 pass, 1 skip | 61 pass | none | 1 | 0 | 0 | 0 |

The wrangler log counts per run show the SQLITE_BUSY retry doing its job (3 transient locks absorbed, none surfaced to a client).
The skip is the mobile-layout test on desktop projects. Firefox was not run (CI only).

Runs on the way to this (test or product fixes between them):

| Run | Result | Cause |
| --- | --- | --- |
| Q1 to Q3, U1 | failures | test bugs (removed-screen locator, `invalid_token` expectation changed to `removed`, topic poll, join-rate burst, reset race), one unexplained purge timeout in U1 (probably D3) |
| V1 | 1 fail | D3 (`internal_error` on join) |
| V2, V3 | green | |
| W1, W2 | green; W3 1 fail | join-rate test (T6, below), not a product failure |

## Fixed on the way

- T7: WebKit browser context limit (see CI triage above).

- T6: the joins-per-minute test counted any socket error as "limited" and, as a 130-attempt burst, could straddle a fixed rate-limit window.
  It now uses `probeUpgrade` (plain HTTP upgrade handshake, reads the real status 101/429) with 2 x limit + 20 attempts in batches of 20.
  Node's WebSocket also produced spurious `setTypeOfService EINVAL` errors at high concurrency, which this avoids.

## Flake results

- Product: none after the D3 fix (nine full runs before it had one occurrence; three after it had none; storage retries are logged as `storage_busy_retry`).
- Test bugs found by repeated runs and fixed: T1 (vote withdraw not awaited), T2 (raw clients had no heartbeat), T3 (reset test did not wait for the reveal),
  T4 (join-rate burst outran the window), T5 (topic-cleared poll could hang), T6 (join-rate test, see above).
- Watch list (not flaky so far): `waitForClaimOpen` (server clock), the `observeFor` windows (removal no-reconnect, backoff attempt count), the 2 s reveal timing (AC14).
- Remaining unproven: the single purge timeout in run U1 never reproduced (15 repeats, 6 later full runs); it coincides in time with the D3 period and is attributed to it.

## Traceability: criterion -> tests -> result

Result is chromium run 3 across all tests carrying the AC ID (count = distinct test titles, each also run on
webkit and mobile-chrome when tagged `@cross-browser`). Test names start with the AC IDs, so
`playwright test -g "F01-AC15"` selects them.

| AC | Tests | Spec files | Result (runs X1 to X3) |
| --- | --- | --- | --- |
| AC1 | 9 | a11y.spec.ts, api.spec.ts, create-join.spec.ts | pass |
| AC2 | 5 | api.spec.ts, create-join.spec.ts | pass |
| AC3 | 4 | api.spec.ts, create-join.spec.ts, protocol.spec.ts | pass |
| AC4 | 8 | create-join.spec.ts, protocol.spec.ts | pass |
| AC5 | 7 | create-join.spec.ts, protocol.spec.ts | pass |
| AC6 | 6 | api.spec.ts, create-join.spec.ts | pass |
| AC7 | 3 | api.spec.ts | pass |
| AC8 | 2 | presence-roles.spec.ts | pass |
| AC9 | 2 | vote.spec.ts | pass |
| AC10 | 7 | protocol.spec.ts, vote.spec.ts | pass |
| AC11 | 3 | protocol.spec.ts, vote.spec.ts | pass |
| AC12 | 4 | create-join.spec.ts, protocol.spec.ts, vote.spec.ts | pass |
| AC13 | 7 | protocol.spec.ts, reset-topic.spec.ts, reveal.spec.ts, settings.spec.ts | pass |
| AC14 | 3 | races.spec.ts, reveal.spec.ts | pass |
| AC15 | 11 | reveal.spec.ts | pass |
| AC16 | 11 | races.spec.ts, reveal.spec.ts | pass |
| AC17 | 3 | races.spec.ts, reveal.spec.ts | pass |
| AC18 | 4 | races.spec.ts, reveal.spec.ts | pass |
| AC19 | 6 | reset-topic.spec.ts | pass |
| AC20 | 8 | protocol.spec.ts, reset-topic.spec.ts | pass |
| AC21 | 7 | create-join.spec.ts, presence-roles.spec.ts | pass |
| AC22 | 3 | reveal.spec.ts, vote.spec.ts | pass |
| AC23 | 8 | connection.spec.ts, presence-roles.spec.ts, protocol.spec.ts, races.spec.ts | pass |
| AC24 | 5 | presence-roles.spec.ts, protocol.spec.ts | pass |
| AC25 | 5 | presence-roles.spec.ts, protocol.spec.ts, races.spec.ts | pass |
| AC26 | 3 | presence-roles.spec.ts | pass |
| AC27 | 4 | protocol.spec.ts, settings.spec.ts | pass |
| AC28 | 4 | settings.spec.ts | pass |
| AC29 | 12 | connection.spec.ts, protocol.spec.ts | pass |
| AC30 | 4 | connection.spec.ts | pass |
| AC31 | - | - | deferred: backend test plus staging/grep review; no e2e |
| AC32 | - | - | deferred: backend test plus staging/grep review; no e2e |
| AC33 | 15 | a11y.spec.ts, create-join.spec.ts, reveal.spec.ts, vote.spec.ts | pass |
| AC34 | 4 | create-join.spec.ts, protocol.spec.ts, settings.spec.ts | pass |
| AC35 | 3 | presence-roles.spec.ts, reveal.spec.ts | pass |
| AC36 | 1 | presence-roles.spec.ts | pass |
| AC37 | 3 | api.spec.ts | pass |

Extra scenarios (`F01-X-RACE-1..12`) are in `races.spec.ts` and `presence-roles.spec.ts`: RACE-1, 2, 3, 4, 5 (raw and UI), 7, 10, 12 and 6 are covered and pass; RACE-8 and RACE-9 are partly covered (RACE-9 in `api.spec.ts`); RACE-11 is covered by the server-side confirmation test.

## Defects

### D1 reclassified: test bug T2 (was "offline participants not purged while the facilitator is offline")
- Root cause (found by backend-dev, confirmed): raw clients from `world.raw()` never sent `{"type":"ping"}`
  although the fixtures define `pingIntervalMs: 250`. With `heartbeatTimeoutMs: 1000` the server correctly declared the
  silent Watcher dead and closed it (1001), so its last snapshot still showed Later offline. The facilitator-online control only
  passed because that socket stayed open. Not a product defect.
- Fix: `RawClient` now sends the ping frame every 250 ms after a successful join/rejoin (`goSilent()` / `{ ping: false }` turns it off
  for a test that expects the server to close a silent client; no current test needs that). Pong frames are not stored in `frames`.
  All other raw tests with short `heartbeatTimeoutMs` (claim, purge, AC21) were checked and use the same helper, so they get the heartbeat too.
- Backend-dev also fixed a separate alarm bug: after a removal or purge the room timer fired about every 10 ms.
  No extra e2e action; the existing suite covers purge and removal flows.
- Backend now covers purge with the facilitator offline in both orders (`apps/api/test/purge.test.ts`).

### D2 resolved: participant removed while offline sees the removed screen on reconnect (F01-AC29, AC23)
- Decision: removed means the removed screen (spec updated). Backend stores a hashed-token tombstone; a rejoin answers `removed` (fatal, close 4403); purged tokens still get `invalid_token`.
- Verified: `connection.spec.ts` "removed while offline" passes, plus the new "after the removed screen a reload is a fresh join, and a second tab with the same token also sees removed", plus `presence-roles.spec.ts` (rejoin with a removed token returns `removed`, fatal).

### D3 resolved (was major, owner: backend-dev): intermittent `internal_error` under `wrangler dev`
- Symptom: a join answered `internal_error`; server log `Uncaught Error: internal error` from `reschedule()` (alarm calls).
- Root cause (backend-dev): local workerd throws a transient `SQLITE_BUSY: database is locked` under concurrent load; the alarm calls were only where it surfaced
  (1 to 5 per 40 rooms in backend-dev's stress script).
- Fix in `apps/api/src/room.ts`: transactions retry on BUSY (5/15/40/100 ms, logged `storage_busy_retry`; a transaction rolls back fully so a retry cannot double-apply);
  `reschedule()` never throws (one retry, then an ID-only `reschedule_failed` log); a failing broadcast or state send after commit is logged, not reported as an error;
  all state-touching entry points run one at a time in arrival order through a queue (worst-case added latency during a retry about 160 ms).
- Verified: no `internal_error`, `reschedule_failed` or `broadcast_failed` in runs X1 to X3; three green runs.
- Note: infra/README.md has a new "Staging checks" section with a SQLITE_BUSY burst check. Whether this occurs on production Durable Objects is unknown; keep that check.

### Spec/UX observations (not defects)
- Custom deck on the start page accepted "a, , b" in the earlier build; the frontend fix now shows an inline error (verified).
- During the flip animation the participant list shows "Voted" for a moment after the summary is visible; values appear after. Tests poll for values. Acceptable for AC14 (2 s), but a screen reader user could read "Voted" after the reveal announcement. Frontend may want to confirm the announcement waits for the values.

## Deferred and manual items

| Item | Reason / how |
| --- | --- |
| AC31 EU jurisdiction | workerd has no local jurisdiction. Backend unit test with a fake namespace; QA grep review of `.idFromName(`/`.get(` outside the helper. **Verify on staging.** |
| AC32 logs contain IDs only | Backend test and QA grep for `console.` calls; no e2e. |
| SQLITE_BUSY burst check | See "Staging checks" in `infra/README.md`. |
| Join timeout (AC29 handshake) | Server closes with 4408 after `joinTimeoutMs`, but under `wrangler dev` a client that sent no frame sees the close about 10 s late (workerd quirk). Test allows 25 s. **Verify on staging.** |
| Firefox | Not run: Playwright's Firefox (build 1532) hangs at launch on this machine (100% CPU, launch timeout even for one browser, also after `install --force`). Firefox tests are tagged and in the config; run in CI. Coverage gap until then. |
| Real iOS Safari, Edge | Playwright cannot cover; smoke on real devices before release. WebKit desktop and Pixel 7 emulation are the proxies. |
| VoiceOver / screen reader pass | Manual. Live-region presence and content are checked automatically, speech output is not. |
| 400% zoom, grayscale/forced-colors review | Manual. 320 and 390 px reflow and 24 px targets are automated. |
| p95 500 ms latency (AC14 perf target) | Not measured in e2e (2 s bound only). Deferred to staging. |
| AC36 rename in the UI | Rename rules are tested over the protocol; the UI (`rename-*` ids) has no e2e test. Gap. |
| Test hooks return 404 outside test mode | Cannot be exercised in an environment that is always in test mode; backend test/config review. |
| ADR 0001 grep (hibernation API, attachments) | Manual review at sign-off; AC30 `drop_memory` e2e passes. |

## Environment limits and notes
- A stale `wrangler dev` without test mode can hold :8787; `global-setup.ts` fails fast. Use `E2E_API_PORT`/`E2E_WEB_PORT` to avoid clashes.
- `ng serve` runs in watch mode. Edits to `apps/web` by other agents during a run can reset connections. Runs 1 to 4 above were made while apps/web was unchanged.
- Whole-suite runtime on three projects is about 10 to 12 minutes with 4 workers.

## Sign-off conditions
1. (done) D2, D3 and T2 verified, three consecutive green runs.
2. Firefox project green in CI (user decides when the suite is committed).
3. Staging checks (see Deferred) done.
4. (done) Backend test review, see below.

## Review of backend tests (read-only)

| Item | Test | Finding |
| --- | --- | --- |
| AC2 length, alphabet, random source | `apps/api/test/rooms.test.ts` (spies on `crypto.getRandomValues`, checks 16 chars, alphabet, 200 unique, `isRoomId`); `packages/shared/src/room-id.test.ts` (spy, called once) | Adequate. No statistical test, which is acceptable for 80 bits from a CSPRNG. |
| AC31 EU helper | `apps/api/test/ops.test.ts` "F01-AC31: jurisdiction": a fake namespace throws on bare `idFromName`/`newUniqueId`/`get`; asserts `id.jurisdiction === "eu"`; create, info and WebSocket connect never touch the bare namespace | Good: covers the real create/info/connect routes. QA grep confirms only `room-stub.ts` calls `idFromName`/`jurisdiction`. Resolved in 2011d4d (test renamed). Was: the second AC31 test in `rooms.test.ts` was titled "ID differs from the bare namespace" but only asserts that a room is reachable and DO IDs exist; the "differs" part is not asserted. Test title/assertion mismatch for backend-dev. Local enforcement is not possible (workerd), so staging remains required. |
| AC32 logs IDs only | `apps/api/test/voting.test.ts` captures `console.log/warn/error` through a create/join/vote/reveal flow and asserts no tokens, names, topic or votes appear | Good. Coverage is the vote flow only; log events for removal, purge, claim and rename are covered by type rather than by test (`LogFields` admits no free text, which is a strong structural guard). Resolved in 2011d4d: the captured flow now includes rename and removal. QA grep: all `console.*` calls are in `log.ts` (typed fields) or the constant `jurisdiction_unsupported_locally` warning. |
