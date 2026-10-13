import { expect } from '@playwright/test';
import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { parseServerMessage } from '@pokr/shared';
import type { RoomState, ServerMessage } from '@pokr/shared';

export interface BrowserFrame {
  dir: 'in' | 'out';
  /** Text of the frame; binary frames are decoded as utf-8 and flagged. */
  text: string;
  binary: boolean;
  at: number;
  msg?: ServerMessage;
}

const isRoomSocket = (url: string): boolean => /\/api\/rooms\/[^/]+\/ws/.test(url);

/**
 * Records every room WebSocket frame seen by one browser context (one participant).
 * Default source: `page.on("websocket")` (frames as the page's network stack sees them).
 * When the context uses NetControl, frames are taken from the route layer instead, because
 * routed sockets are not reported by `page.on("websocket")`.
 */
export class FrameRecorder {
  readonly frames: BrowserFrame[] = [];
  /** Number of sockets opened to a room endpoint (reconnect attempts included). */
  socketsOpened = 0;
  readonly socketOpenTimes: number[] = [];

  record(dir: 'in' | 'out', payload: string | Buffer): void {
    const binary = typeof payload !== 'string';
    const text = binary ? payload.toString('utf8') : payload;
    const frame: BrowserFrame = { dir, text, binary, at: Date.now() };
    if (dir === 'in' && !binary) {
      const parsed = parseServerMessage(text);
      if (parsed.ok) frame.msg = parsed.message;
    }
    this.frames.push(frame);
  }

  noteSocketOpened(): void {
    this.socketsOpened += 1;
    this.socketOpenTimes.push(Date.now());
  }

  attachPageEvents(page: Page): void {
    page.on('websocket', (ws) => {
      if (!isRoomSocket(ws.url())) return;
      this.noteSocketOpened();
      ws.on('framereceived', (e) => this.record('in', e.payload));
      ws.on('framesent', (e) => this.record('out', e.payload));
    });
  }

  get received(): BrowserFrame[] {
    return this.frames.filter((f) => f.dir === 'in');
  }

  get sent(): BrowserFrame[] {
    return this.frames.filter((f) => f.dir === 'out');
  }

  get states(): RoomState[] {
    return this.frames.flatMap((f) => (f.msg?.type === 'state' ? [f.msg.state] : []));
  }

  get lastState(): RoomState | null {
    let best: RoomState | null = null;
    for (const s of this.states) if (!best || s.version >= best.version) best = s;
    return best;
  }

  get selfId(): string {
    const s = this.lastState;
    if (!s) throw new Error('no state frame received yet');
    return s.selfId;
  }

  /** Frames received since a position returned by `mark()`. */
  mark(): number {
    return this.frames.length;
  }

  since(mark: number): BrowserFrame[] {
    return this.frames.slice(mark);
  }

  /** Wait on a received state (not on time). */
  async waitForState(
    pred: (s: RoomState) => boolean,
    message: string,
    timeout = 10_000,
  ): Promise<RoomState> {
    await expect
      .poll(() => this.lastState !== null && pred(this.lastState), { message, timeout })
      .toBe(true);
    return this.lastState!;
  }

  /** Time (ms epoch) the first state with the predicate was received. */
  firstReceivedAt(pred: (s: RoomState) => boolean): number | null {
    for (const f of this.frames) {
      if (f.dir === 'in' && f.msg?.type === 'state' && pred(f.msg.state)) return f.at;
    }
    return null;
  }
}

export type NetMode = 'online' | 'offline';

/**
 * Controls the WebSocket of one context at the route layer, so tests can drop the connection
 * (`setOffline` alone does not close existing sockets) and observe reconnect attempts.
 * Must be installed before the page navigates.
 */
export class NetControl {
  mode: NetMode = 'online';
  private live = new Set<{ page: WebSocketRoute; server: WebSocketRoute }>();
  private dropping = false;

  constructor(
    private readonly context: BrowserContext,
    private readonly recorder: FrameRecorder,
  ) {}

  async install(): Promise<void> {
    await this.context.routeWebSocket(/\/api\/rooms\/[^/]+\/ws/, (page) => {
      this.recorder.noteSocketOpened();
      if (this.mode === 'offline') {
        page.close({ code: 3000, reason: 'e2e offline' });
        return;
      }
      const server = page.connectToServer();
      const pair = { page, server };
      this.live.add(pair);
      page.onMessage((m) => {
        this.recorder.record('out', m);
        if (this.mode === 'online') server.send(m);
      });
      server.onMessage((m) => {
        this.recorder.record('in', m);
        if (this.mode === 'online') page.send(m);
      });
      page.onClose(() => {
        this.live.delete(pair);
        if (!this.dropping) void server.close();
      });
      server.onClose(() => {
        this.live.delete(pair);
        void page.close({ code: 3001, reason: 'server closed' });
      });
    });
  }

  /**
   * Network loss. `silent` (default): the page side dies, the server is not told, so it only
   * notices through the heartbeat timeout. `clean`: the server also receives a close.
   */
  async goOffline(opts: { clean?: boolean } = {}): Promise<void> {
    this.mode = 'offline';
    await this.context.setOffline(true);
    this.dropping = !opts.clean;
    for (const { page, server } of [...this.live]) {
      void page.close({ code: 3000, reason: 'e2e offline' });
      if (opts.clean) void server.close();
    }
    this.live.clear();
    this.dropping = false;
  }

  async goOnline(): Promise<void> {
    this.mode = 'online';
    await this.context.setOffline(false);
  }

  /** Close the connection only (not the network); the client should reconnect by itself. */
  async dropConnectionOnce(): Promise<void> {
    for (const { page, server } of [...this.live]) {
      void page.close({ code: 3000, reason: 'e2e drop' });
      void server.close();
    }
    this.live.clear();
  }
}
