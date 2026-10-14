import { DurableObject } from 'cloudflare:workers';
import {
  EMPTY_STORIES_STATE,
  FACILITATOR_CLAIM_MS,
  HEARTBEAT_TIMEOUT_MS,
  JOIN_TIMEOUT_MS,
  MAX_PARTICIPANTS,
  OFFLINE_PURGE_MS,
  PING_FRAME,
  PONG_FRAME,
  RATE_LIMITS,
  WS_CLOSE_CODES,
  applySettings,
  canClaimFacilitator,
  canManageRoom,
  canRevealOrReset,
  decksEqual,
  isCardInDeck,
  isVoter,
  parseClientMessage,
  serializeMessage,
  shouldAutoReveal,
} from '@pokr/shared';
import type {
  ClientMessage,
  CommandMessage,
  ErrorCode,
  RoomSettings,
  RoomState,
  ServerMessage,
  TestEvictRequest,
  TestTimersRequest,
} from '@pokr/shared';
import { isTestMode } from './env';
import type { AppEnv } from './env';
import { log, logError } from './log';
import { RoomStore } from './store';
import type { LeftRow, ParticipantRow, RoomRecord } from './store';

/** Per-connection data that survives hibernation (ADR 0001). Never holds names or votes. */
interface Attachment {
  connectedAt: number;
  pid?: string;
  stale?: boolean;
}

type Fx = Array<() => void>;

/** Two claims within this window of a successful claim answer `already_claimed` (F01-AC25). */
const CLAIM_RACE_WINDOW_MS = 10_000;
const OPEN = 1;
/** Delays before retrying a transaction that hit a transient storage error (local workerd reports SQLITE_BUSY under load). */
const BUSY_BACKOFF_MS = [5, 15, 40, 100];

function isTransientStorageError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : '';
  return /SQLITE_BUSY|database is locked/i.test(m);
}
/** After a clean close the participant stays online this long, so a reload does not flicker (F01-AC21). */
const CLOSE_GRACE_MS = 400;

class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly field?: string,
    readonly fatal = false,
  ) {
    super(message ?? code);
  }
}

const FATAL_CLOSE_CODES: Partial<Record<ErrorCode, number>> = {
  room_full: WS_CLOSE_CODES.roomFull,
  invalid_token: WS_CLOSE_CODES.invalidToken,
  removed: WS_CLOSE_CODES.removed,
  room_not_found: WS_CLOSE_CODES.roomNotFound,
};

function errorMessage(
  code: ErrorCode,
  o: {
    id?: string | undefined;
    message?: string | undefined;
    field?: string | undefined;
    fatal?: boolean;
    retryAfterMs?: number;
  },
): ServerMessage {
  return {
    type: 'error',
    code,
    fatal: o.fatal ?? false,
    ...(o.id !== undefined ? { id: o.id } : {}),
    ...(o.message !== undefined ? { message: o.message } : {}),
    ...(o.field !== undefined ? { field: o.field } : {}),
    ...(o.retryAfterMs !== undefined ? { retryAfterMs: o.retryAfterMs } : {}),
  };
}

function peekId(raw: string): string | undefined {
  if (raw.length > 4096) return undefined;
  try {
    const j = JSON.parse(raw) as { id?: unknown } | null;
    const id = j?.id;
    return typeof id === 'string' && id.length >= 1 && id.length <= 64 ? id : undefined;
  } catch {
    return undefined;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Name key for suffix matching: NFC is already applied by the schema, so only case folds here (F01-AC8). */
const nameKey = (base: string) => base.toLowerCase();

function computeDisplay(
  base: string,
  others: ParticipantRow[],
): { suffix: number; display: string } {
  const key = nameKey(base);
  const used = new Set(others.filter((o) => nameKey(o.base_name) === key).map((o) => o.suffix));
  const displays = new Set(others.map((o) => o.display_name.toLowerCase()));
  for (let n = 1; ; n++) {
    const display = n === 1 ? base : `${base} (${n})`;
    if (!used.has(n) && !displays.has(display.toLowerCase())) return { suffix: n, display };
  }
}

export type CreateRoomInput = {
  roomId: string;
  displayName: string;
  settings: RoomSettings;
};
export type CreateRoomResult =
  { ok: true; participantId: string; token: string } | { ok: false; reason: 'exists' };

/**
 * One Durable Object per room (ADR 0001). All state lives in SQLite storage and socket
 * attachments; the only in-memory state is the per-connection rate window, last-seen times, and
 * the test instance id, all safe to lose on eviction. Stubs only via `getRoomStub` (ADR 0002).
 */
export class RoomDurableObject extends DurableObject<AppEnv> {
  private instanceId = crypto.randomUUID();
  private readonly lastSeen = new Map<WebSocket, number>();
  private readonly msgTimes = new Map<WebSocket, number[]>();
  /** participantId -> time of their last clean close; lost on eviction (then offline is immediate, which is fine). */
  private readonly closing = new Map<string, number>();
  /** Tail of the work queue. Everything that reads-modifies-writes room state runs through `enqueue`. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly store: RoomStore;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.store = new RoomStore(ctx.storage.sql);
    // Answered by the runtime without waking the object (F01-AC21 heartbeat).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));
  }

  /**
   * Runs `task` after all earlier tasks finished, in arrival order. A storage retry (which awaits a
   * timer and so opens the input gate) therefore delays later messages instead of letting them
   * overtake. A failed task does not break the chain. Tasks must never await another queued task
   * (internal helpers such as `tick`, `commit` and `reschedule` are not queued), which rules out
   * deadlock.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // ---- RPC (called from the Worker through getRoomStub) ----

  create(input: CreateRoomInput): Promise<CreateRoomResult> {
    return this.enqueue(() => this.createNow(input));
  }

  private async createNow(input: CreateRoomInput): Promise<CreateRoomResult> {
    if (this.store.exists()) return { ok: false, reason: 'exists' };
    const token = randomToken();
    const hash = await sha256Hex(token);
    if (this.store.exists()) return { ok: false, reason: 'exists' };
    const participantId = crypto.randomUUID();
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.store.init({
        roomId: input.roomId,
        settings: input.settings,
        topic: '',
        phase: 'voting',
        roundNumber: 1,
        version: 1,
        facilitatorId: participantId,
        nextSeq: 1,
        timers: {},
        claimPushed: null,
        lastClaimAt: null,
      });
      this.store.insertParticipant({
        id: participantId,
        token_hash: hash,
        base_name: input.displayName,
        suffix: 1,
        display_name: input.displayName,
        role: 'voter',
        vote: null,
        seq: 0,
        offline_since: now,
      });
    });
    log('room_created', { roomId: input.roomId, participantId });
    return { ok: true, participantId, token };
  }

  /** `null` for a room that was never created. Reads only: writes nothing for unknown rooms (F01-AC6). */
  info(): Promise<{ name: string; full: boolean } | null> {
    return this.enqueue(() => this.infoNow());
  }

  private async infoNow(): Promise<{ name: string; full: boolean } | null> {
    if (!this.store.exists()) return null;
    await this.tick();
    await this.reschedule();
    return {
      name: this.store.room().settings.name,
      full: this.store.participants().length >= MAX_PARTICIPANTS,
    };
  }

  testSetTimers(timers: TestTimersRequest): Promise<boolean> {
    return this.enqueue(() => this.testSetTimersNow(timers));
  }

  private async testSetTimersNow(timers: TestTimersRequest): Promise<boolean> {
    this.requireTestMode();
    if (!this.store.exists()) return false;
    this.store.setTimers({ ...this.store.room().timers, ...timers });
    await this.tick();
    await this.reschedule();
    return true;
  }

  testInstance(): string {
    this.requireTestMode();
    return this.instanceId;
  }

  /** `drop_memory` discards every in-memory cache but keeps sockets (hibernation path); `abort` kills the object. */
  testEvict(mode: TestEvictRequest['mode']): { previousInstanceId: string } {
    this.requireTestMode();
    const previousInstanceId = this.instanceId;
    this.instanceId = crypto.randomUUID();
    this.lastSeen.clear();
    this.msgTimes.clear();
    if (mode === 'abort') setTimeout(() => this.ctx.abort('test eviction'), 20);
    return { previousInstanceId };
  }

  private requireTestMode(): void {
    if (!isTestMode(this.env)) throw new Error('test mode is off');
  }

  // ---- WebSocket upgrade ----

  override fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.fetchNow(request));
  }

  private async fetchNow(request: Request): Promise<Response> {
    if (!this.store.exists()) {
      return Response.json({ error: { code: 'room_not_found' } }, { status: 404 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json(
        { error: { code: 'invalid_input', message: 'WebSocket upgrade required' } },
        { status: 426 },
      );
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() } satisfies Attachment);
    await this.reschedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Hibernation handlers ----

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.lastSeen.set(ws, Date.now());
    if (message === PING_FRAME) {
      this.send(ws, { type: 'pong' });
      return;
    }
    return this.enqueue(() => this.onMessage(ws, message));
  }

  private async onMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const raw = typeof message === 'string' ? message : null;
    const retryAfterMs = this.rateCheck(ws, now);
    if (retryAfterMs !== null) {
      const id = raw ? peekId(raw) : undefined;
      this.send(
        ws,
        errorMessage('rate_limited', { id, message: 'too many messages', retryAfterMs }),
      );
      return;
    }
    if (raw === null) {
      this.send(ws, errorMessage('invalid_input', { message: 'binary frames are not supported' }));
      return;
    }
    if (!this.store.exists()) {
      this.fail(ws, new CommandError('room_not_found', undefined, undefined, true));
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send(
        ws,
        errorMessage(parsed.code, {
          id: peekId(raw),
          message: parsed.message,
          field: parsed.field,
        }),
      );
      return;
    }
    const msg = parsed.message;
    try {
      if (msg.type === 'ping') {
        this.send(ws, { type: 'pong' });
      } else if (msg.type === 'join' || msg.type === 'rejoin') {
        try {
          await this.handshake(ws, msg);
        } catch (err) {
          this.handleFailure(ws, err);
        }
      } else {
        await this.command(ws, msg);
      }
    } catch (err) {
      this.handleFailure(ws, err, 'id' in msg ? msg.id : undefined);
    }
    await this.reschedule();
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.noteClose(ws);
    this.forget(ws);
    return this.enqueue(() => this.onClose(ws, code));
  }

  private async onClose(ws: WebSocket, code: number): Promise<void> {
    const valid = code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code);
    try {
      ws.close(valid ? code : 1000, 'closing');
    } catch {
      /* already closed */
    }
    try {
      await this.tick(ws);
    } catch (err) {
      logError('close_failed', err);
    }
    await this.reschedule();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.noteClose(ws);
    this.forget(ws);
    return this.enqueue(() => this.onError(ws));
  }

  private async onError(ws: WebSocket): Promise<void> {
    try {
      await this.tick(ws);
    } catch (err) {
      logError('socket_error_failed', err);
    }
    await this.reschedule();
  }

  /** One alarm multiplexes heartbeat expiry, join timeouts, purge, and claim availability. */
  override async alarm(): Promise<void> {
    return this.enqueue(() => this.onAlarm());
  }

  private async onAlarm(): Promise<void> {
    try {
      await this.tick();
      const room = this.store.room();
      const fac = this.store.participant(room.facilitatorId);
      if (fac && fac.offline_since !== null && room.claimPushed !== fac.offline_since) {
        if (Date.now() >= fac.offline_since + this.durations(room).claim) {
          this.store.setClaimPushed(fac.offline_since);
          this.broadcast(); // same version, fresh serverTime: claiming is now open
        }
      }
    } catch (err) {
      logError('alarm_failed', err);
    }

    await this.reschedule();
  }

  // ---- connection helpers ----

  private attachment(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { connectedAt: 0 };
  }

  private noteClose(ws: WebSocket): void {
    const att = this.attachment(ws);
    if (att.pid && !att.stale) this.closing.set(att.pid, Date.now());
  }

  private forget(ws: WebSocket): void {
    this.lastSeen.delete(ws);
    this.msgTimes.delete(ws);
  }

  private liveSockets(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      if (ws === except || ws.readyState !== OPEN) return false;
      return !this.attachment(ws).stale;
    });
  }

  private lastActivity(ws: WebSocket): number {
    const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
    return Math.max(this.attachment(ws).connectedAt, auto, this.lastSeen.get(ws) ?? 0);
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(serializeMessage(msg));
    } catch {
      /* socket already gone; presence is fixed by the close handler */
    }
  }

  private rateCheck(ws: WebSocket, now: number): number | null {
    const { limit, windowMs } = RATE_LIMITS.message;
    const recent = (this.msgTimes.get(ws) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.msgTimes.set(ws, recent);
      return Math.max(1, recent[0]! + windowMs - now);
    }
    recent.push(now);
    this.msgTimes.set(ws, recent);
    return null;
  }

  private fail(ws: WebSocket, err: CommandError, id?: string): void {
    this.send(
      ws,
      errorMessage(err.code, { id, message: err.message, field: err.field, fatal: err.fatal }),
    );
    if (err.fatal) {
      try {
        ws.close(FATAL_CLOSE_CODES[err.code] ?? 1008, err.code);
      } catch {
        /* already closed */
      }
    }
  }

  private handleFailure(ws: WebSocket, err: unknown, id?: string): void {
    if (err instanceof CommandError) {
      this.fail(ws, err, id);
      return;
    }
    logError('command_failed', err);
    this.send(ws, errorMessage('internal_error', { id, message: 'internal error' }));
  }

  // ---- timers ----

  private durations(room: RoomRecord): {
    heartbeat: number;
    join: number;
    purge: number;
    claim: number;
  } {
    const o = isTestMode(this.env) ? room.timers : {};
    return {
      heartbeat: o.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS,
      join: o.joinTimeoutMs ?? JOIN_TIMEOUT_MS,
      purge: o.offlinePurgeMs ?? OFFLINE_PURGE_MS,
      claim: o.facilitatorClaimMs ?? FACILITATOR_CLAIM_MS,
    };
  }

  /** Housekeeping: heartbeat expiry, join timeout, presence sync, due purges. Cheap when nothing changed. */
  private async tick(except?: WebSocket): Promise<void> {
    const now = Date.now();
    const room = this.store.room();
    const d = this.durations(room);
    const live: WebSocket[] = [];
    for (const ws of this.liveSockets(except)) {
      const att = this.attachment(ws);
      if (!att.pid && now - att.connectedAt > d.join) {
        this.closeQuietly(ws, WS_CLOSE_CODES.joinTimeout, 'join timeout');
        continue;
      }
      if (now - this.lastActivity(ws) > d.heartbeat) {
        ws.serializeAttachment({ ...att, stale: true } satisfies Attachment);
        this.closeQuietly(ws, 1001, 'heartbeat timeout');
        continue;
      }
      live.push(ws);
    }
    const onlineIds = new Set(
      live.map((ws) => this.attachment(ws).pid).filter((p): p is string => !!p),
    );
    await this.commit(() => {
      for (const p of this.store.participants()) {
        const online = onlineIds.has(p.id);
        const closedAt = this.closing.get(p.id);
        if (online) this.closing.delete(p.id);
        if (!online && closedAt !== undefined && now - closedAt < CLOSE_GRACE_MS) continue;
        if (!online) this.closing.delete(p.id);
        if (online && p.offline_since !== null)
          this.store.updateParticipant(p.id, { offline_since: null });
        if (!online && p.offline_since === null)
          this.store.updateParticipant(p.id, { offline_since: closedAt ?? now });
      }
      this.purgeDue(now, false);
    });
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** Remove offline non-facilitator participants whose purge time has passed (F01-AC21). */
  private purgeDue(now: number, includeVoters: boolean): void {
    const room = this.store.room();
    const purge = this.durations(room).purge;
    for (const p of this.store.participants()) {
      if (p.id === room.facilitatorId || p.offline_since === null) continue;
      if (now - p.offline_since < purge) continue;
      if (p.vote !== null && !includeVoters) continue;
      this.store.deleteParticipant(p.id);
      log('participant_purged', { participantId: p.id });
    }
  }

  /**
   * Re-arms the multiplexed alarm. Never throws: a failing alarm call must not fail a committed
   * command. One retry, then an ID-only log. Every entry point calls this again, so a lost alarm
   * is re-armed by the next message, connect or close.
   */
  private async reschedule(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.rescheduleOnce();
        return;
      } catch (err) {
        if (attempt === 1) {
          logError('reschedule_failed', err, { roomId: this.safeRoomId() });
          return;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }

  private async rescheduleOnce(): Promise<void> {
    if (!this.store.exists()) return;
    const sockets = this.liveSockets();
    const current = await this.ctx.storage.getAlarm();
    if (sockets.length === 0) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return; // timers are applied lazily on the next entry point
    }
    const now = Date.now();
    const room = this.store.room();
    const d = this.durations(room);
    let next = Infinity;
    for (const ws of sockets) {
      const att = this.attachment(ws);
      next = Math.min(next, this.lastActivity(ws) + d.heartbeat + 1);
      if (!att.pid) next = Math.min(next, att.connectedAt + d.join + 1);
    }
    for (const p of this.store.participants()) {
      if (p.offline_since === null) continue;
      if (p.id === room.facilitatorId) {
        if (room.claimPushed !== p.offline_since) next = Math.min(next, p.offline_since + d.claim);
      } else if (p.vote === null) {
        next = Math.min(next, p.offline_since + d.purge);
      }
    }
    const floor = Math.max(10, Math.min(1000, d.heartbeat / 4));
    let target = Math.max(next, now + floor);
    // Pending clean-close grace deadlines; entries of removed/purged participants or past their
    // grace are not deadlines (a leaked entry used to pin the alarm to now + 10 ms).
    const ids = new Set(this.store.participants().map((p) => p.id));
    for (const [pid, closedAt] of this.closing) {
      if (!ids.has(pid) || closedAt + CLOSE_GRACE_MS < now) {
        this.closing.delete(pid);
        continue;
      }
      target = Math.min(target, Math.max(closedAt + CLOSE_GRACE_MS + 1, now + 10));
    }
    if (current === null || current > target || current < now)
      await this.ctx.storage.setAlarm(target);
  }

  // ---- transactions ----

  private fingerprint(): string {
    const r = this.store.room();
    return JSON.stringify([
      r.settings,
      r.topic,
      r.phase,
      r.roundNumber,
      r.facilitatorId,
      this.store
        .participants()
        .map((p) => [p.id, p.display_name, p.role, p.vote, p.offline_since === null]),
      this.store.left(),
    ]);
  }

  /**
   * Runs `fn` atomically. The room version is bumped exactly once if anything visible changed, then
   * `pre` runs, the new state is broadcast, and the queued effects run (F01-AC14, AC16).
   */
  private async commit<T>(
    fn: (fx: Fx) => T,
    pre?: () => void,
  ): Promise<{ result: T; changed: boolean; version: number }> {
    // Only the transaction is retried: it rolls back completely on failure, so a retry cannot
    // double-apply. Everything after it (broadcast, effects) runs once.
    let attempt = 0;
    let out: { result: T; changed: boolean; version: number; fx: Fx };
    for (;;) {
      try {
        out = this.transact(fn);
        break;
      } catch (err) {
        if (!isTransientStorageError(err) || attempt >= BUSY_BACKOFF_MS.length) throw err;
        log('storage_busy_retry', { count: attempt + 1 });
        await new Promise((r) => setTimeout(r, BUSY_BACKOFF_MS[attempt]));
        attempt++;
      }
    }
    pre?.();
    if (out.changed) this.broadcast();
    for (const f of out.fx) f();
    return { result: out.result, changed: out.changed, version: out.version };
  }

  private transact<T>(fn: (fx: Fx) => T): { result: T; changed: boolean; version: number; fx: Fx } {
    const fx: Fx = [];
    let changed = false;
    let version = 0;
    const result = this.ctx.storage.transactionSync(() => {
      const before = this.fingerprint();
      const r = fn(fx);
      this.autoReveal();
      version = this.store.room().version;
      if (this.fingerprint() !== before) {
        version += 1;
        this.store.setVersion(version);
        changed = true;
      }
      return r;
    });
    return { result, changed, version, fx };
  }

  private autoReveal(): void {
    const room = this.store.room();
    if (room.phase !== 'voting') return;
    const parts = this.store.participants().map((p) => ({
      id: p.id,
      role: p.role,
      online: p.offline_since === null,
      hasVoted: p.vote !== null,
    }));
    if (shouldAutoReveal(room.phase, parts, room.facilitatorId, room.settings)) {
      this.store.setRound('revealed', room.roundNumber);
    }
  }

  // ---- projection ----

  private buildState(
    room: RoomRecord,
    parts: ParticipantRow[],
    left: LeftRow[],
    selfId: string,
    now: number,
  ): RoomState {
    const me = parts.find((p) => p.id === selfId);
    const fac = parts.find((p) => p.id === room.facilitatorId);
    const claimAt =
      fac && fac.offline_since !== null ? fac.offline_since + this.durations(room).claim : null;
    return {
      roomId: room.roomId,
      version: room.version,
      serverTime: now,
      selfId,
      facilitatorId: room.facilitatorId,
      settings: room.settings,
      topic: room.topic,
      stories: EMPTY_STORIES_STATE, // TODO(F02): placeholder until the story list is implemented
      // Other participants' cards exist only in the revealed branch (F01-AC11).
      round:
        room.phase === 'voting'
          ? { phase: 'voting', number: room.roundNumber }
          : {
              phase: 'revealed',
              number: room.roundNumber,
              votes: [
                ...parts
                  .filter((p) => p.vote !== null)
                  .map((p) => ({ participantId: p.id, card: p.vote! })),
                ...left.map((l) => ({ participantId: l.participant_id, card: l.card })),
              ],
              left: left.map((l) => ({ participantId: l.participant_id, name: l.name })),
            },
      participants: parts.map((p) => ({
        id: p.id,
        name: p.display_name,
        role: p.role,
        online: p.offline_since === null,
        hasVoted: p.vote !== null,
      })),
      myVote: me?.vote ?? null,
      canClaimAt: claimAt,
    };
  }

  private stateFor(selfId: string): RoomState {
    return this.buildState(
      this.store.room(),
      this.store.participants(),
      this.store.left(),
      selfId,
      Date.now(),
    );
  }

  private broadcast(): void {
    try {
      this.broadcastNow();
    } catch (err) {
      // The change is committed; clients resync on their next message or reconnect.
      logError('broadcast_failed', err);
    }
  }

  private broadcastNow(): void {
    const room = this.store.room();
    const parts = this.store.participants();
    const left = this.store.left();
    const ids = new Set(parts.map((p) => p.id));
    const now = Date.now();
    const cache = new Map<string, string>();
    for (const ws of this.liveSockets()) {
      const pid = this.attachment(ws).pid;
      if (!pid || !ids.has(pid)) continue;
      let frame = cache.get(pid);
      if (frame === undefined) {
        const state = this.buildState(room, parts, left, pid, now);
        frame = serializeMessage({ type: 'state', state });
        cache.set(pid, frame);
      }
      try {
        ws.send(frame);
      } catch {
        /* gone */
      }
    }
  }

  /** Post-commit: a failing read must not turn a committed command into an error; the client resyncs on the next state. */
  private sendStateSafe(ws: WebSocket, pid: string): void {
    try {
      this.sendState(ws, pid);
    } catch (err) {
      logError('send_state_failed', err);
    }
  }

  private safeRoomId(): string {
    try {
      return this.store.room().roomId;
    } catch {
      return '';
    }
  }

  private sendState(ws: WebSocket, pid: string): void {
    this.send(ws, { type: 'state', state: this.stateFor(pid) });
  }

  // ---- handshake ----

  private async handshake(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: 'join' | 'rejoin' }>,
  ): Promise<void> {
    const att = this.attachment(ws);
    if (att.pid && this.store.participant(att.pid)) {
      throw new CommandError('already_joined', 'this connection already joined');
    }
    let token: string | undefined;
    let hash: string;
    if (msg.type === 'join') {
      token = randomToken();
      hash = await sha256Hex(token);
    } else {
      hash = await sha256Hex(msg.token);
    }
    await this.tick();
    let pid = '';
    const { changed } = await this.commit(
      () => {
        if (msg.type === 'join') {
          const parts = this.store.participants();
          if (parts.length >= MAX_PARTICIPANTS)
            throw new CommandError('room_full', 'room is full', undefined, true);
          const { suffix, display } = computeDisplay(msg.name, parts);
          pid = crypto.randomUUID();
          this.store.insertParticipant({
            id: pid,
            token_hash: hash,
            base_name: msg.name,
            suffix,
            display_name: display,
            role: msg.role,
            vote: null,
            seq: this.store.takeSeq(),
            offline_since: null,
          });
        } else {
          const p = this.store.participantByHash(hash);
          if (!p) {
            // Removed while offline: the tombstone makes the token terminal, never admitted (F01-AC23).
            if (this.store.isTombstoned(hash)) {
              throw new CommandError('removed', 'you were removed from the room', undefined, true);
            }
            throw new CommandError('invalid_token', 'unknown token', undefined, true);
          }
          pid = p.id;
          if (p.offline_since !== null) this.store.updateParticipant(p.id, { offline_since: null });
        }
      },
      () => {
        ws.serializeAttachment({ ...att, pid } satisfies Attachment);
        this.closing.delete(pid);
        this.send(ws, { type: 'joined', participantId: pid, ...(token ? { token } : {}) });
      },
    );
    log(msg.type === 'join' ? 'participant_joined' : 'participant_rejoined', {
      roomId: this.safeRoomId(),
      participantId: pid,
    });
    if (!changed) this.sendStateSafe(ws, pid);
  }

  // ---- commands ----

  private async command(ws: WebSocket, msg: CommandMessage): Promise<void> {
    const pid = this.attachment(ws).pid;
    if (!pid) throw new CommandError('not_joined', 'send join or rejoin first');
    await this.tick();
    const { changed, version } = await this.commit((fx) => this.execute(pid, msg, fx));
    if (!changed) this.sendStateSafe(ws, pid);
    this.send(ws, { type: 'ack', id: msg.id, version });
  }

  private execute(pid: string, msg: CommandMessage, fx: Fx): void {
    const s = this.store;
    const now = Date.now();
    const me = s.participant(pid);
    if (!me) throw new CommandError('removed', 'you were removed from the room', undefined, true);
    const room = s.room();
    const fid = room.facilitatorId;
    const actor = { id: me.id, role: me.role, online: true };
    const need = (ok: boolean) => {
      if (!ok) throw new CommandError('not_allowed', 'not allowed');
    };

    switch (msg.type) {
      case 'vote': {
        need(isVoter(me, fid, room.settings));
        if (room.phase === 'revealed')
          throw new CommandError('round_revealed', 'round already revealed');
        const card = msg.card === null ? null : msg.card.normalize('NFC');
        if (card !== null && !isCardInDeck(room.settings.deck, card)) {
          throw new CommandError('invalid_card', 'card is not in the deck', 'card');
        }
        s.updateParticipant(me.id, { vote: card });
        return;
      }
      case 'reveal': {
        need(canRevealOrReset(actor, fid, room.settings.controlMode));
        if (room.phase === 'voting') s.setRound('revealed', room.roundNumber);
        return;
      }
      case 'reset': {
        need(canRevealOrReset(actor, fid, room.settings.controlMode));
        this.resetRound(now);
        if (msg.topic !== undefined) s.setTopic(msg.topic);
        return;
      }
      case 'set_topic': {
        need(canManageRoom(actor, fid));
        s.setTopic(msg.topic);
        return;
      }
      case 'update_settings': {
        need(canManageRoom(actor, fid));
        const next = applySettings(room.settings, msg.settings);
        const deckChanged =
          msg.settings.deck !== undefined && !decksEqual(room.settings.deck, msg.settings.deck);
        let reset = false;
        if (deckChanged) {
          const hasVotes = s.participants().some((p) => p.vote !== null) || s.left().length > 0;
          if (hasVotes) {
            if (!msg.confirmReset)
              throw new CommandError('confirmation_required', 'changing the deck discards votes');
            reset = true;
          }
        }
        s.setSettings(next);
        if (reset) this.resetRound(now);
        if (!next.facilitatorVotes && room.phase === 'voting') {
          const fac = s.participant(fid);
          if (fac?.vote != null) s.updateParticipant(fid, { vote: null });
        }
        return;
      }
      case 'set_role': {
        if (me.role === msg.role) return;
        s.updateParticipant(me.id, {
          role: msg.role,
          ...(msg.role === 'observer' && room.phase === 'voting' ? { vote: null } : {}),
        });
        return;
      }
      case 'rename': {
        const others = s.participants().filter((p) => p.id !== me.id);
        if (nameKey(msg.name) === nameKey(me.base_name)) {
          // Same name modulo case: keep the suffix, update the casing.
          const display = me.suffix === 1 ? msg.name : `${msg.name} (${me.suffix})`;
          s.updateParticipant(me.id, { base_name: msg.name, display_name: display });
          return;
        }
        const { suffix, display } = computeDisplay(msg.name, others);
        s.updateParticipant(me.id, { base_name: msg.name, suffix, display_name: display });
        return;
      }
      case 'remove_participant': {
        need(canManageRoom(actor, fid));
        const target = s.participant(msg.participantId);
        if (!target)
          throw new CommandError('unknown_target', 'no such participant', 'participantId');
        if (target.id === fid)
          throw new CommandError('not_allowed', 'the facilitator cannot be removed');
        if (room.phase === 'revealed' && target.vote !== null) {
          s.insertLeft({ participant_id: target.id, name: target.display_name, card: target.vote });
        }
        s.addTombstone(target.token_hash, now);
        s.deleteParticipant(target.id);
        fx.push(() => {
          for (const ws of this.ctx.getWebSockets()) {
            if (this.attachment(ws).pid !== target.id) continue;
            this.send(
              ws,
              errorMessage('removed', { message: 'you were removed from the room', fatal: true }),
            );
            this.closeQuietly(ws, WS_CLOSE_CODES.removed, 'removed');
          }
        });
        log('participant_removed', { roomId: this.store.room().roomId, participantId: target.id });
        return;
      }
      case 'hand_over': {
        need(canManageRoom(actor, fid));
        const target = s.participant(msg.participantId);
        if (!target)
          throw new CommandError('unknown_target', 'no such participant', 'participantId');
        if (target.id === me.id)
          throw new CommandError('not_allowed', 'you are already the facilitator');
        if (target.offline_since !== null)
          throw new CommandError('target_offline', 'target is offline');
        s.setFacilitator(target.id, null);
        return;
      }
      case 'claim_facilitator': {
        const fac = s.participant(fid);
        if (me.id === fid) throw new CommandError('claim_not_available', 'you are the facilitator');
        if (!fac || fac.offline_since === null) {
          if (room.lastClaimAt !== null && now - room.lastClaimAt < CLAIM_RACE_WINDOW_MS) {
            throw new CommandError('already_claimed', 'someone else claimed the role first');
          }
          throw new CommandError('claim_not_available', 'the facilitator is online');
        }
        const claimAt = fac.offline_since + this.durations(room).claim;
        if (!canClaimFacilitator({ ...actor }, fid, claimAt, now)) {
          throw new CommandError('claim_not_available', 'claiming is not available yet');
        }
        s.updateParticipant(fac.id, { role: 'voter' }); // a returning former facilitator becomes a voter
        s.setFacilitator(me.id, now);
        log('facilitator_claimed', { roomId: this.store.room().roomId, participantId: me.id });
        return;
      }
    }
  }

  /** New round: clears all votes, back to voting, purges offline participants whose time has passed (F01-AC19, AC21). */
  private resetRound(now: number): void {
    const room = this.store.room();
    this.store.clearVotes();
    this.store.clearLeft();
    this.store.setRound('voting', room.roundNumber + 1);
    this.purgeDue(now, true);
  }
}
