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

export class World {
  private contexts: BrowserContext[] = [];
  private raws: RawClient[] = [];
  readonly api: ApiClient;

  constructor(
    private readonly browser: Browser,
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
      setTimers: (t) => this.api.setTimers(res.roomId, t),
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
    const context = await this.browser.newContext({
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
    const context = await this.newContext({}, opts.clientConfig);
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

export const test = base.extend<{ world: World }>({
  world: async (
    { browser, playwright, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor },
    use,
  ) => {
    const request = await playwright.request.newContext();
    const api = new ApiClient(request, uniqueKey('api'));
    const ctxOptions: Record<string, unknown> = {
      ...(viewport ? { viewport } : {}),
      ...(userAgent ? { userAgent } : {}),
      ...(isMobile ? { isMobile } : {}),
      ...(hasTouch ? { hasTouch } : {}),
      ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    };
    const world = new World(browser, ctxOptions, api);
    await use(world);
    await world.dispose();
    await request.dispose();
  },
});

export { expect };
