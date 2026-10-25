import { env, exports } from 'cloudflare:workers';
import { mergeAgenda, parseServerMessage } from '@pokr/shared';
import type {
  ClientMessage,
  HeldAgenda,
  CreateRoomRequest,
  CreateRoomResponse,
  RoomState,
  ServerMessage,
} from '@pokr/shared';

export const BASE = 'https://pokr.test';
let keyCounter = 0;
/** A fresh rate-limit key per call, so tests never share an IP budget. */
export const freshKey = () =>
  `t-${Date.now()}-${keyCounter++}-${Math.random().toString(36).slice(2)}`;

export function api(path: string, init: RequestInit & { key?: string } = {}): Promise<Response> {
  const { key, headers, ...rest } = init;
  return exports.default.fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'x-pokr-test-client-key': key ?? freshKey(), ...headers },
  });
}

export async function createRoom(
  displayName = 'Facilitator',
  settings: CreateRoomRequest['settings'] = {},
): Promise<CreateRoomResponse> {
  const res = await api('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName, settings }),
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as CreateRoomResponse;
}

export class Client {
  readonly frames: string[] = [];
  readonly messages: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  participantId = '';
  token = '';
  /** The agenda this client holds, kept in sync with the real client rule (`mergeAgenda`). */
  held: HeldAgenda | null = null;
  /** Times the real client rule would have asked for a resync; always 0 on a healthy connection. */
  resyncs = 0;
  private cmd = 0;
  static readonly all: Client[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const raw = String(e.data);
      this.frames.push(raw);
      const parsed = parseServerMessage(raw);
      if (!parsed.ok) throw new Error(`server sent an invalid frame: ${parsed.message}`);
      this.messages.push(parsed.message);
      if (parsed.message.type === 'state') {
        const merged = mergeAgenda(this.held, parsed.message.state.stories);
        this.held = merged.held;
        if (merged.resync) this.resyncs++;
      }
      if (parsed.message.type === 'joined') {
        this.participantId = parsed.message.participantId;
        if (parsed.message.token) this.token = parsed.message.token;
      }
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
    ws.accept();
    Client.all.push(this);
  }

  static async connect(roomId: string, key = freshKey()): Promise<Client> {
    const res = await exports.default.fetch(`${BASE}/api/rooms/${roomId}/ws`, {
      headers: { Upgrade: 'websocket', 'x-pokr-test-client-key': key },
    });
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
    return new Client(res.webSocket);
  }

  /** Connect and rejoin with a token. */
  static async rejoin(roomId: string, token: string): Promise<Client> {
    const c = await Client.connect(roomId);
    c.send({ type: 'rejoin', token });
    await c.waitFor((m) => m.type === 'state');
    return c;
  }

  /** Connect and join fresh. */
  static async join(
    roomId: string,
    name: string,
    role: 'voter' | 'observer' = 'voter',
  ): Promise<Client> {
    const c = await Client.connect(roomId);
    c.send({ type: 'join', name, role });
    await c.waitFor((m) => m.type === 'state');
    return c;
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }
  sendRaw(data: string | ArrayBuffer): void {
    this.ws.send(data);
  }

  /** Sends a command with a fresh id; resolves with the ack or error answering it. */
  async cmd_(msg: Record<string, unknown>): Promise<ServerMessage> {
    const id = `c${++this.cmd}`;
    const from = this.messages.length;
    this.send({ ...msg, id });
    return this.waitFor((m) => (m.type === 'ack' || m.type === 'error') && m.id === id, from);
  }

  async waitFor(
    pred: (m: ServerMessage) => boolean,
    from = 0,
    timeoutMs = 3000,
  ): Promise<ServerMessage> {
    const start = Date.now();
    for (;;) {
      const hit = this.messages.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `timeout waiting for message; got ${this.messages
            .slice(from)
            .map((m) => m.type)
            .join(',')}`,
        );
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async waitForState(pred: (s: RoomState) => boolean, timeoutMs = 3000): Promise<RoomState> {
    const start = Date.now();
    for (;;) {
      const s = this.state;
      if (s && pred(s)) return s;
      if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for state');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const start = Date.now();
    while (!this.closed) {
      if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for close');
      await new Promise((r) => setTimeout(r, 5));
    }
    return this.closed;
  }

  /** Agenda rows as this client sees them. */
  get rows() {
    return this.held?.rows ?? [];
  }
  get titles(): string[] {
    return this.rows.map((r) => r.title);
  }

  /** The raw `state` frames received so far, parsed as JSON (to inspect which keys travelled). */
  stateFrames(): { stories: Record<string, unknown>; version: number; bytes: number }[] {
    return this.frames
      .filter((f) => f.startsWith('{"type":"state"'))
      .map((f) => {
        const j = JSON.parse(f) as { state: { stories: Record<string, unknown>; version: number } };
        return { stories: j.state.stories, version: j.state.version, bytes: f.length };
      });
  }

  get state(): RoomState | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.type === 'state') return m.state;
    }
    return undefined;
  }

  close(): void {
    try {
      this.ws.close(1000);
    } catch {
      /* closed */
    }
  }
}

export async function setTimers(roomId: string, timers: Record<string, number>): Promise<void> {
  const res = await api(`/api/__test/rooms/${roomId}/timers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(timers),
  });
  if (res.status !== 204) throw new Error(`timers failed: ${res.status}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { env };

export function closeAll(): void {
  for (const c of Client.all.splice(0)) c.close();
}

export function expectCode(msg: ServerMessage, code: string): void {
  if (msg.type !== 'error' || msg.code !== code) {
    throw new Error(`expected error ${code}, got ${JSON.stringify(msg)}`);
  }
}

export function expectAck(msg: ServerMessage): void {
  if (msg.type !== 'ack') throw new Error(`expected ack, got ${JSON.stringify(msg)}`);
}

/** A facilitator already connected to a fresh room. */
export async function setup(settings: CreateRoomRequest['settings'] = {}) {
  const room = await createRoom('Fac', settings);
  const fac = await Client.rejoin(room.roomId, room.token);
  fac.token = room.token;
  return { room, id: room.roomId, fac };
}

/** Story helpers for tests. */
export async function addStory(c: Client, title: string, extra: Record<string, unknown> = {}) {
  const r = await c.cmd_({ type: 'add_story', title, ...extra });
  if (r.type !== 'ack') throw new Error(`add_story failed: ${JSON.stringify(r)}`);
  return r.storyIds![0]!;
}

export async function addStories(c: Client, ...titles: string[]): Promise<string[]> {
  const r = await c.cmd_({ type: 'add_stories', text: titles.join('\n') });
  if (r.type !== 'ack') throw new Error(`add_stories failed: ${JSON.stringify(r)}`);
  return r.storyIds ?? [];
}

export async function seedStories(roomId: string, body: Record<string, unknown>) {
  return api(`/api/__test/rooms/${roomId}/stories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function storageReport(roomId: string) {
  const res = await api(`/api/__test/rooms/${roomId}/storage`);
  if (res.status !== 200) throw new Error(`storage failed: ${res.status}`);
  return (await res.json()) as {
    entries: { key: string; bytes: number }[];
    totalBytes: number;
    finalRounds: {
      storyId: string;
      finalRound: {
        number: number;
        votes: { participantId: string; name: string | null; card: string }[];
      };
    }[];
  };
}

/** A facilitator in a fresh Story list room. */
export const setupStories = (settings: CreateRoomRequest['settings'] = {}) =>
  setup({ storySource: 'stories', ...settings });

/** Round id (`round.number`) as the client sees it. */
export const roundOf = (c: Client): number => c.state!.round.number;
