import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { CreateRoomRequest, RoomSettingsInput, TestTimersRequest, Role } from '@pokr/shared';
import { ApiClient } from './api';
import { CLIENT_KEY_HEADER, tokenStorageKey, uniqueKey, WEB_URL } from '../helpers/env';
import { RawClient } from '../helpers/raw-client';
import { RoomPage } from '../helpers/room-page';
import { FrameRecorder, NetControl } from '../helpers/ws-recorder';

/** Shape injected as `globalThis.__pokrTestConfig` (agreed with frontend). */
export interface PokrTestConfig {
  backoff: { initialMs: number; maxMs: number; factor: number; jitter: number };
  pingIntervalMs: number;
}

export const FAST_CLIENT_CONFIG: PokrTestConfig = {
  backoff: { initialMs: 100, maxMs: 400, factor: 2, jitter: 0 },
  pingIntervalMs: 250,
};

export interface RoomHandle {
  roomId: string;
  /** Path, resolved against baseURL. */
  url: string;
  facilitatorId: string;
  facilitatorToken: string;
  settingsInput: RoomSettingsInput;
  /** Server heartbeat timeout set for this room by the test, if any (shapes the client ping). */
  heartbeatTimeoutMs?: number;
  setTimers(t: TestTimersRequest): Promise<void>;
}

export interface Participant {
  name: string;
  role: Role;
  context: BrowserContext;
  page: Page;
  room: RoomPage;
  rec: FrameRecorder;
  net: NetControl | null;
  /** Participant id (from the first state frame). */
  id(): Promise<string>;
}

export interface JoinOptions {
  name: string;
  role?: Role;
  /** Enter with the creator's token instead of the join form. */
  asFacilitator?: boolean;
  /** Route-layer network control (offline simulation). Frames then come from the route layer. */
  net?: boolean;
  /** Override or extend the injected client test config. */
  clientConfig?: Partial<PokrTestConfig>;
  /** Do not navigate to the room (caller drives the page). */
  noGoto?: boolean;
  /** Do not fill the join form (caller drives it). */
  noJoinForm?: boolean;
}

export interface CreateOptions {
  displayName?: string;
  settings?: RoomSettingsInput;
  timers?: TestTimersRequest;
}

/**
 * A per-worker browser that is relaunched every few tests. Playwright's WebKit build (26.5, v2311)
 * hangs in `goto` after about 63 contexts in one browser process (reproduced with a bare
 * newContext/goto/close loop, no app involved), which broke the second half of every CI webkit run.
 * Context counts are kept far below that.
 */
export interface BrowserPool {
  browser: Browser;
  used: number;
  relaunch(): Promise<void>;
  /** Probe the browser with a throw-away page; relaunch it when it does not answer in time. */
  ensureHealthy(): Promise<void>;
}
// CI run 39031808167 (webkit, 2 workers): late in a worker's life the pooled browser stopped
// answering: pages sat at "Joining the room..." (their WebSocket never completed), single actions
// took 4 s, and `browser.close()` then hung for the whole 30 s teardown limit, failing two
// unrelated tests. That was at roughly 30 contexts per browser, so contexts are kept lower, the
// browser is probed before every test, and no close may block a test for more than a few seconds.
const MAX_CONTEXTS_PER_BROWSER = 12;
const PROBE_TIMEOUT_MS = 8_000;
const CLOSE_TIMEOUT_MS = 8_000;

/** Close without ever blocking longer than `CLOSE_TIMEOUT_MS` (a hung browser is abandoned; the worker's exit reaps it). */
async function closeBounded(browser: Browser): Promise<void> {
  await Promise.race([
    browser.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
}

/**
 * The page declares its connection dead after 1.5 x `pingIntervalMs` without inbound frames. The
 * old fixed 250 ms (dead after 375 ms) made the page reconnect whenever a loaded CI runner stalled
 * for a moment, and the next UI action then failed with "not connected" (seen on webkit and
 * chromium in CI on 16d000a). Ping as slowly as the room's server-side heartbeat allows: a third
 * of the server timeout, at most 1 s, and when the test sets none, `PAGE_PING_MS`.
 */
// Run 39033477508 (webkit, PR #1): the runner stalled for several seconds (the server answered a
// ping 450 ms late, then nothing for over 5 s; other tests in that window took 10 to 27 s instead
// of 3 to 5 s). With a 1 s ping the page declared the connection dead after 1.5 s, reconnected,
// and the `update_settings` it had just sent was lost, failing AC1. Tests that do not exercise
// dead-connection detection use a page ping of 4 s (dead after 6 s).
const PAGE_PING_MS = 4_000;

function pingFor(heartbeatTimeoutMs?: number): Partial<PokrTestConfig> {
  if (heartbeatTimeoutMs === undefined) return { pingIntervalMs: PAGE_PING_MS };
  return { pingIntervalMs: Math.min(1000, Math.max(100, Math.floor(heartbeatTimeoutMs / 3))) };
}

export class World {
  private contexts: BrowserContext[] = [];
  private raws: RawClient[] = [];
  readonly api: ApiClient;

  constructor(
    private readonly pool: BrowserPool,
    private readonly ctxOptions: Record<string, unknown>,
    api: ApiClient,
  ) {
    this.api = api;
  }

  async createRoom(opts: CreateOptions = {}): Promise<RoomHandle> {
    const body: CreateRoomRequest = {
      displayName: opts.displayName ?? 'Facilitator',
      ...(opts.settings ? { settings: opts.settings } : {}),
    };
    const res = await this.api.createRoom(body);
    const handle: RoomHandle = {
      roomId: res.roomId,
      url: `/r/${res.roomId}`,
      facilitatorId: res.participantId,
      facilitatorToken: res.token,
      settingsInput: opts.settings ?? {},
      setTimers: async (t) => {
        if (t.heartbeatTimeoutMs !== undefined) handle.heartbeatTimeoutMs = t.heartbeatTimeoutMs;
        await this.api.setTimers(res.roomId, t);
      },
    };
    if (opts.timers) await handle.setTimers(opts.timers);
    return handle;
  }

  /** New isolated browser context (own storage, own rate-limit key). */
  async newContext(
    extra: Record<string, unknown> = {},
    config?: Partial<PokrTestConfig>,
  ): Promise<BrowserContext> {
    const ctxKey = uniqueKey('ui');
    this.pool.used += 1;
    const context = await this.pool.browser.newContext({
      ...this.ctxOptions,
      baseURL: WEB_URL,
      ...extra,
      extraHTTPHeaders: { [CLIENT_KEY_HEADER]: ctxKey },
    });
    // Browsers do not send extraHTTPHeaders on the WebSocket handshake, but they do send cookies.
    // The backend is asked to accept the rate-limit key from this cookie as well (request R-B8).
    const key = ctxKey;
    await context.addCookies([{ name: CLIENT_KEY_HEADER, value: key, url: WEB_URL }]);
    const cfg: PokrTestConfig = { ...FAST_CLIENT_CONFIG, ...config };
    await context.addInitScript((c) => {
      (globalThis as unknown as { __pokrTestConfig: unknown }).__pokrTestConfig = c;
    }, cfg);
    this.contexts.push(context);
    return context;
  }

  async join(room: RoomHandle, opts: JoinOptions): Promise<Participant> {
    const context = await this.newContext(
      {},
      opts.clientConfig ?? pingFor(room.heartbeatTimeoutMs),
    );
    const rec = new FrameRecorder();
    let net: NetControl | null = null;
    if (opts.net) {
      net = new NetControl(context, rec);
      await net.install();
    } else {
      context.on('page', (p) => rec.attachPageEvents(p));
    }
    if (opts.asFacilitator) {
      await context.addInitScript(
        ([key, token]) => {
          if (!localStorage.getItem('__e2e_seeded')) {
            localStorage.setItem(key as string, token as string);
            localStorage.setItem('__e2e_seeded', '1');
          }
        },
        [tokenStorageKey(room.roomId), room.facilitatorToken],
      );
    }
    const page = await context.newPage();
    const roomPage = new RoomPage(page);
    const role: Role = opts.role ?? 'voter';
    const participant: Participant = {
      name: opts.name,
      role,
      context,
      page,
      room: roomPage,
      rec,
      net,
      id: async () => {
        await rec.waitForState(() => true, 'first state frame');
        return rec.selfId;
      },
    };
    if (!opts.noGoto) await page.goto(room.url);
    if (!opts.asFacilitator && !opts.noGoto && !opts.noJoinForm) {
      await fillJoinForm(page, opts.name, role);
    }
    if (!opts.noGoto && !opts.noJoinForm) await roomPage.expectInRoom();
    return participant;
  }

  /** A raw protocol client that has joined (fresh join). */
  async raw(
    room: RoomHandle,
    name: string,
    role: Role = 'voter',
    opts: { ping?: boolean } = {},
  ): Promise<RawClient> {
    const c = await RawClient.connect(room.roomId, uniqueKey('raw'));
    if (opts.ping === false) c.goSilent();
    this.raws.push(c);
    await c.join(name, role);
    return c;
  }

  /** The creator as a raw client (rejoin with the creator's token). */
  async rawFacilitator(room: RoomHandle, opts: { ping?: boolean } = {}): Promise<RawClient> {
    const c = await RawClient.connect(room.roomId, uniqueKey('raw'));
    if (opts.ping === false) c.goSilent();
    this.raws.push(c);
    await c.rejoin(room.facilitatorToken);
    return c;
  }

  /** Connected but not joined (for handshake tests). */
  async rawConnect(roomId: string, key = uniqueKey('raw')): Promise<RawClient> {
    const c = await RawClient.connect(roomId, key);
    this.raws.push(c);
    return c;
  }

  async dispose(): Promise<void> {
    for (const r of this.raws) r.close();
    await Promise.all(this.contexts.map((c) => c.close().catch(() => undefined)));
  }
}

export async function fillJoinForm(page: Page, name: string, role: Role): Promise<void> {
  await page.getByTestId('join-name').fill(name);
  if (role === 'observer') await page.getByTestId('join-role-observer').check();
  else await page.getByTestId('join-role-voter').check();
  await page.getByTestId('join-submit').click();
}

export const test = base.extend<{ world: World }, { browserPool: BrowserPool }>({
  browserPool: [
    async ({ playwright, browserName, launchOptions, headless }, use) => {
      const browserType = playwright[browserName];
      const options = { ...launchOptions, headless };
      const pool: BrowserPool = {
        browser: await browserType.launch(options),
        used: 0,
        async relaunch() {
          await closeBounded(this.browser);
          this.browser = await browserType.launch(options);
          this.used = 0;
        },
        async ensureHealthy() {
          const probe = async (): Promise<boolean> => {
            const timeout = new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(false), PROBE_TIMEOUT_MS),
            );
            const run = (async (): Promise<boolean> => {
              const context = await this.browser.newContext();
              try {
                const page = await context.newPage();
                await page.goto('about:blank');
                return (await page.evaluate(() => 1 + 1)) === 2;
              } finally {
                void context.close().catch(() => undefined);
              }
            })().catch(() => false);
            return Promise.race([run, timeout]);
          };
          this.used += 1;
          if (!(await probe())) await this.relaunch();
        },
      };
      await use(pool);
      await closeBounded(pool.browser);
    },
    { scope: 'worker' },
  ],
  world: async (
    { browserPool, playwright, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor },
    use,
  ) => {
    if (browserPool.used >= MAX_CONTEXTS_PER_BROWSER) await browserPool.relaunch();
    await browserPool.ensureHealthy();
    const request = await playwright.request.newContext();
    const api = new ApiClient(request, uniqueKey('api'));
    const ctxOptions: Record<string, unknown> = {
      ...(viewport ? { viewport } : {}),
      ...(userAgent ? { userAgent } : {}),
      ...(isMobile ? { isMobile } : {}),
      ...(hasTouch ? { hasTouch } : {}),
      ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    };
    const world = new World(browserPool, ctxOptions, api);
    await use(world);
    await world.dispose();
    await request.dispose();
  },
});

export { expect };
