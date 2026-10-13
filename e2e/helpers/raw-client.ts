import { PING_FRAME, parseServerMessage } from '@pokr/shared';
import type { ErrorCode, RoomState, ServerMessage } from '@pokr/shared';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { API_URL, CLIENT_KEY_HEADER, WS_URL } from './env';

export interface RawFrame {
  dir: 'in' | 'out';
  text: string;
  at: number;
  msg?: ServerMessage;
}

export type CommandResult =
  | { ok: true; version: number }
  | { ok: false; code: ErrorCode; fatal: boolean; field?: string; retryAfterMs?: number };

type ErrorMsg = Extract<ServerMessage, { type: 'error' }>;

/** Minimal protocol client built on the shared types. Used for races, limits and malformed input. */
export class RawClient {
  readonly frames: RawFrame[] = [];
  state: RoomState | null = null;
  participantId: string | null = null;
  token: string | null = null;
  closed: { code: number; reason: string } | null = null;
  private nextId = 1;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Heartbeat like the real client (`pingIntervalMs` of the test config). Off = a silent client. */
  pingIntervalMs = 250;
  autoPing = true;
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('message', (ev: MessageEvent) => {
      const text =
        typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      const parsed = parseServerMessage(text);
      const frame: RawFrame = { dir: 'in', text, at: Date.now() };
      if (parsed.ok) {
        frame.msg = parsed.message;
        if (parsed.message.type === 'state') {
          const prev = this.state;
          if (!prev || parsed.message.state.version >= prev.version)
            this.state = parsed.message.state;
        }
        if (parsed.message.type === 'joined') {
          this.participantId = parsed.message.participantId;
          if (parsed.message.token) this.token = parsed.message.token;
        }
      }
      if (parsed.ok && parsed.message.type === 'pong') return; // heartbeat noise
      this.frames.push(frame);
      this.wake();
    });
    ws.addEventListener('close', (ev: CloseEvent) => {
      this.stopPing();
      this.closed = { code: ev.code, reason: ev.reason };
      this.wake();
    });
  }

  /** Opens the socket. Rejects when the upgrade is refused (e.g. 404 for unknown rooms). */
  static connect(roomId: string, clientKey: string, baseWs: string = WS_URL): Promise<RawClient> {
    return new Promise((resolve, reject) => {
      const Ctor = WebSocket as unknown as new (
        url: string,
        init?: { headers: Record<string, string> },
      ) => WebSocket;
      const ws = new Ctor(`${baseWs}/api/rooms/${roomId}/ws`, {
        headers: { [CLIENT_KEY_HEADER]: clientKey },
      });
      const client = new RawClient(ws);
      ws.addEventListener('open', () => resolve(client));
      ws.addEventListener('error', () => reject(new Error('websocket upgrade refused')));
    });
  }

  /** Start the heartbeat (called after a successful join/rejoin when autoPing is on). */
  private startPing(): void {
    if (!this.autoPing || this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      if (this.ws.readyState === 1) this.ws.send(PING_FRAME);
    }, this.pingIntervalMs);
  }

  stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /**
   * Turn the heartbeat off to behave like a client that went silent without closing
   * (a test that expects the server to declare it dead must do this explicitly).
   */
  goSilent(): void {
    this.autoPing = false;
    this.stopPing();
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Resolves when `pred` is true; rechecked on every incoming frame or close. */
  async waitUntil(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  sendRaw(text: string): void {
    this.frames.push({ dir: 'out', text, at: Date.now() });
    this.ws.send(text);
  }

  send(msg: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify(msg));
  }

  /** Fresh join; resolves with the first state. Throws on an error reply. */
  async join(name: string, role: 'voter' | 'observer' = 'voter'): Promise<RawClient> {
    this.send({ type: 'join', name, role });
    await this.waitUntil(() => this.state !== null || this.firstError() !== null, 'join result');
    const err = this.firstError();
    if (err) throw new Error(`join failed: ${err.code}`);
    this.startPing();
    return this;
  }

  /** Join and return the error instead of throwing. */
  async tryJoin(name: string, role: 'voter' | 'observer' = 'voter'): Promise<ErrorMsg | null> {
    this.send({ type: 'join', name, role });
    await this.waitUntil(
      () => this.state !== null || this.firstError() !== null || this.closed !== null,
      'join result',
    );
    if (this.state !== null) this.startPing();
    return this.firstError();
  }

  async rejoin(token: string): Promise<RawClient> {
    this.send({ type: 'rejoin', token });
    await this.waitUntil(() => this.state !== null || this.firstError() !== null, 'rejoin result');
    const err = this.firstError();
    if (err) throw new Error(`rejoin failed: ${err.code}`);
    this.startPing();
    return this;
  }

  firstError(): ErrorMsg | null {
    for (const f of this.frames)
      if (f.msg?.type === 'error' && f.msg.id === undefined) return f.msg;
    return null;
  }

  errors(): ErrorMsg[] {
    return this.frames.flatMap((f) => (f.msg?.type === 'error' ? [f.msg] : []));
  }

  /** Send a command and wait for its ack or error. */
  async command(type: string, fields: Record<string, unknown> = {}): Promise<CommandResult> {
    const id = `c${this.nextId++}`;
    const start = this.frames.length;
    this.send({ type, id, ...fields });
    let result: CommandResult | null = null;
    await this.waitUntil(() => {
      for (let i = start; i < this.frames.length; i++) {
        const m = this.frames[i]?.msg;
        if (m?.type === 'ack' && m.id === id) result = { ok: true, version: m.version };
        if (m?.type === 'error' && m.id === id) {
          result = {
            ok: false,
            code: m.code,
            fatal: m.fatal,
            ...(m.field !== undefined ? { field: m.field } : {}),
            ...(m.retryAfterMs !== undefined ? { retryAfterMs: m.retryAfterMs } : {}),
          };
        }
      }
      return result !== null;
    }, `reply to ${type}`);
    return result!;
  }

  vote(card: string | null): Promise<CommandResult> {
    return this.command('vote', { card });
  }

  async waitForState(
    pred: (s: RoomState) => boolean,
    what: string,
    timeoutMs = 10_000,
  ): Promise<RoomState> {
    await this.waitUntil(() => this.state !== null && pred(this.state), what, timeoutMs);
    return this.state!;
  }

  async waitForClose(timeoutMs = 10_000): Promise<{ code: number; reason: string }> {
    await this.waitUntil(() => this.closed !== null, 'close', timeoutMs);
    return this.closed!;
  }

  close(): void {
    this.stopPing();
    if (this.ws.readyState <= 1) this.ws.close();
  }
}

/**
 * One WebSocket upgrade handshake over plain HTTP, returning the status code the server answered
 * with (101 = upgraded, 429 = rate limited, 404 = unknown room). Unlike `RawClient.connect` it
 * can tell a rate-limit refusal from a local socket error.
 */
export function probeUpgrade(roomId: string, clientKey: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}/api/rooms/${roomId}/ws`);
    const req = httpRequest(url, {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        [CLIENT_KEY_HEADER]: clientKey,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}
