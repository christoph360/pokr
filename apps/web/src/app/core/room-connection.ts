import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  PING_FRAME,
  WS_CLOSE_CODES,
  backoffDelayMs,
  isTerminalError,
  parseServerMessage,
  serializeMessage,
} from '@pokr/shared';
import type {
  ClientMessage,
  CommandMessage,
  ErrorCode,
  Role,
  RoomState,
  ServerMessage,
} from '@pokr/shared';
import { RoomApi } from './room-api';
import { ROOM_SOCKET_FACTORY } from './room-socket';
import type { RoomSocket } from './room-socket';
import { readClientConfig } from './test-config';
import { TokenStore } from './token-store';

/** How the connection introduces itself on (re)connect. After a fresh join, a stored token turns it into `rejoin`. */
export type JoinIntent = { kind: 'join'; name: string; role: Role } | { kind: 'rejoin' };

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'terminal';
export type TerminalCode = Extract<
  ErrorCode,
  'removed' | 'room_not_found' | 'room_full' | 'invalid_token'
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A command without its correlation id; the connection assigns the id. */
export type CommandInput = DistributiveOmit<CommandMessage, 'id'>;

export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode | 'disconnected',
    readonly field?: string,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'CommandError';
  }
}

export interface ConnectionNotice {
  seq: number;
  code: ErrorCode;
  retryAfterMs?: number;
}

interface Pending {
  resolve: (version: number) => void;
  reject: (error: CommandError) => void;
}

const CLOSE_CODE_TERMINAL: Record<number, TerminalCode> = {
  [WS_CLOSE_CODES.invalidToken]: 'invalid_token',
  [WS_CLOSE_CODES.removed]: 'removed',
  [WS_CLOSE_CODES.roomNotFound]: 'room_not_found',
  [WS_CLOSE_CODES.roomFull]: 'room_full',
};

/**
 * Owns the room WebSocket (ADR 0001): join/rejoin, the stored token, the heartbeat, reconnect with
 * backoff, terminal errors, command ack correlation and version ordering. Components read the
 * signals and call `send`; they never touch the socket.
 */
@Injectable({ providedIn: 'root' })
export class RoomConnection {
  private readonly factory = inject(ROOM_SOCKET_FACTORY);
  private readonly tokens = inject(TokenStore);
  private readonly api = inject(RoomApi);
  private readonly doc = inject(DOCUMENT);
  private readonly config = readClientConfig();

  private readonly _status = signal<ConnectionStatus>('idle');
  private readonly _state = signal<RoomState | null>(null);
  private readonly _terminal = signal<TerminalCode | null>(null);
  private readonly _indicator = signal<'connected' | 'reconnecting'>('connected');
  private readonly _restored = signal(false);
  private readonly _notice = signal<ConnectionNotice | null>(null);
  private readonly _clockOffset = signal(0);

  readonly status = this._status.asReadonly();
  readonly state = this._state.asReadonly();
  /** Set when the server ended the session for good (no auto-reconnect). */
  readonly terminal = this._terminal.asReadonly();
  /** What the UI shows: flips to "reconnecting" only after the indicator delay (F01-AC29). */
  readonly indicator = this._indicator.asReadonly();
  /** True for a few seconds after a reconnect, for a polite "back online" announcement. */
  readonly restored = this._restored.asReadonly();
  /** Non-fatal errors that did not answer a command (e.g. `rate_limited`). */
  readonly notice = this._notice.asReadonly();
  readonly connected = computed(() => this._status() === 'connected');

  private roomId: string | null = null;
  private intent: JoinIntent = { kind: 'rejoin' };
  private socket: RoomSocket | null = null;
  /** Bumped for every socket; callbacks from older sockets are ignored. */
  private generation = 0;
  private awaitingFirstState = false;
  private joinedOnSocket = false;
  private attempt = 0;
  private lastInbound = 0;
  private commandCounter = 0;
  private noticeCounter = 0;
  private everConnected = false;
  private readonly pending = new Map<string, Pending>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private indicatorTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private restoredTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const win = this.doc.defaultView;
    if (win) {
      const onOffline = () => {
        if (this._status() === 'connected') this.dropConnection();
      };
      const onOnline = () => {
        if (this._status() === 'reconnecting' && this.reconnectTimer !== undefined) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = undefined;
          this.connect();
        }
      };
      win.addEventListener('offline', onOffline);
      win.addEventListener('online', onOnline);
      inject(DestroyRef).onDestroy(() => {
        win.removeEventListener('offline', onOffline);
        win.removeEventListener('online', onOnline);
        this.close();
      });
    }
  }

  /** Start a session for `roomId`, replacing any previous one. */
  open(roomId: string, intent: JoinIntent): void {
    this.close();
    this.roomId = roomId;
    this.intent = intent;
    this.attempt = 0;
    this.everConnected = false;
    this._status.set('connecting');
    this.connect();
  }

  /** End the session without a terminal error (leaving the page). */
  close(): void {
    this.teardown();
    this.roomId = null;
    this._status.set('idle');
    this._state.set(null);
    this._terminal.set(null);
    this._notice.set(null);
    this._indicator.set('connected');
    this._restored.set(false);
  }

  /** Server clock estimate (epoch ms), for `canClaimFacilitator`. */
  serverNow(): number {
    return Date.now() + this._clockOffset();
  }

  /**
   * Send a command. Resolves with the room version once the server acks it; rejects with a
   * `CommandError` on an error reply or when not connected. Nothing is queued while disconnected.
   */
  send(command: CommandInput): Promise<number> {
    if (this._status() !== 'connected' || !this.socket || !this.joinedOnSocket) {
      return Promise.reject(new CommandError('disconnected'));
    }
    const id = `c${++this.commandCounter}-${Math.random().toString(36).slice(2, 8)}`;
    // The union minus `id` plus `id` is a CommandMessage; TypeScript cannot see through the distributive Omit.
    const message = { ...command, id } as ClientMessage;
    return new Promise<number>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.socket?.send(serializeMessage(message));
      } catch {
        this.pending.delete(id);
        reject(new CommandError('disconnected'));
      }
    });
  }

  // ---- socket lifecycle ----

  private connect(): void {
    const roomId = this.roomId;
    if (roomId === null) return;
    const gen = ++this.generation;
    this.awaitingFirstState = true;
    this.joinedOnSocket = false;
    this.socket = this.factory(roomId, {
      open: () => gen === this.generation && this.onOpen(),
      message: (data) => gen === this.generation && this.onMessage(data),
      close: (code) => gen === this.generation && this.onClose(code),
    });
  }

  private onOpen(): void {
    const roomId = this.roomId;
    if (roomId === null) return;
    this.lastInbound = Date.now();
    const token = this.tokens.get(roomId);
    if (token) {
      this.sendRaw({ type: 'rejoin', token });
    } else if (this.intent.kind === 'join') {
      this.sendRaw({ type: 'join', name: this.intent.name, role: this.intent.role });
    } else {
      this.enterTerminal('invalid_token');
      return;
    }
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.heartbeat(), this.config.pingIntervalMs);
  }

  private sendRaw(message: ClientMessage): void {
    try {
      this.socket?.send(serializeMessage(message));
    } catch {
      /* a failing send surfaces as a close */
    }
  }

  private heartbeat(): void {
    if (Date.now() - this.lastInbound > this.config.pingIntervalMs * 1.5) {
      // No pong for more than one interval: the connection is silently dead.
      this.dropConnection();
      return;
    }
    try {
      this.socket?.send(PING_FRAME);
    } catch {
      /* ignore */
    }
  }

  /** Treat the current socket as closed right now, without waiting for the browser to notice. */
  private dropConnection(): void {
    const socket = this.socket;
    this.generation++;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    this.onClose(1006);
  }

  private onMessage(data: string): void {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) return;
    this.lastInbound = Date.now();
    this.handle(parsed.message);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'pong':
        return;
      case 'joined': {
        this.joinedOnSocket = true;
        if (message.token && this.roomId) this.tokens.set(this.roomId, message.token);
        return;
      }
      case 'state':
        this.applyState(message.state);
        return;
      case 'ack': {
        const p = this.pending.get(message.id);
        if (p) {
          this.pending.delete(message.id);
          p.resolve(message.version);
        }
        return;
      }
      case 'error':
        this.handleError(message);
        return;
    }
  }

  private applyState(next: RoomState): void {
    const current = this._state();
    // Ignore older snapshots; the first snapshot of a connection always wins (it is the resync).
    if (!this.awaitingFirstState && current && next.version < current.version) return;
    this.awaitingFirstState = false;
    this._clockOffset.set(next.serverTime - Date.now());
    this._state.set(next);
    this.markConnected();
  }

  private markConnected(): void {
    clearTimeout(this.indicatorTimer);
    this.indicatorTimer = undefined;
    const wasReconnecting =
      this._status() === 'reconnecting' || this._indicator() === 'reconnecting';
    this.attempt = 0;
    this.joinedOnSocket = true;
    this._status.set('connected');
    this._indicator.set('connected');
    if (wasReconnecting && this.everConnected) {
      this._restored.set(true);
      clearTimeout(this.restoredTimer);
      this.restoredTimer = setTimeout(() => this._restored.set(false), 4000);
    }
    this.everConnected = true;
  }

  private handleError(message: Extract<ServerMessage, { type: 'error' }>): void {
    if (isTerminalError(message.code)) {
      this.enterTerminal(message.code as TerminalCode);
      return;
    }
    if (message.id !== undefined) {
      const p = this.pending.get(message.id);
      if (p) {
        this.pending.delete(message.id);
        p.reject(new CommandError(message.code, message.field, message.retryAfterMs));
        return;
      }
    }
    this._notice.set({
      seq: ++this.noticeCounter,
      code: message.code,
      ...(message.retryAfterMs !== undefined ? { retryAfterMs: message.retryAfterMs } : {}),
    });
  }

  private onClose(code: number): void {
    this.stopPing();
    this.socket = null;
    this.rejectPending();
    const terminal = CLOSE_CODE_TERMINAL[code];
    if (terminal) {
      this.enterTerminal(terminal);
      return;
    }
    if (this._status() === 'terminal' || this._status() === 'idle' || this.roomId === null) return;
    const joined = this.joinedOnSocket;
    this._status.set('reconnecting');
    this.scheduleIndicator();
    if (!joined) void this.probeRoom();
    const delay = backoffDelayMs(this.attempt++, this.config.backoff);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private scheduleIndicator(): void {
    if (this._indicator() === 'reconnecting' || this.indicatorTimer !== undefined) return;
    this.indicatorTimer = setTimeout(() => {
      this.indicatorTimer = undefined;
      if (this._status() === 'reconnecting') this._indicator.set('reconnecting');
    }, this.config.reconnectIndicatorDelayMs);
  }

  /** A failed attempt may mean the room is gone (F01-AC29): ask over HTTP before retrying blindly. */
  private async probeRoom(): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null) return;
    const result = await this.api.roomInfo(roomId);
    if (
      result.kind === 'not_found' &&
      this.roomId === roomId &&
      this._status() === 'reconnecting'
    ) {
      this.enterTerminal('room_not_found');
    }
  }

  private enterTerminal(code: TerminalCode): void {
    const roomId = this.roomId;
    if (roomId !== null && (code === 'removed' || code === 'invalid_token')) {
      this.tokens.clear(roomId);
    }
    this.teardown();
    this._terminal.set(code);
    this._status.set('terminal');
    this._indicator.set('connected');
  }

  private teardown(): void {
    this.generation++;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    this.stopPing();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    clearTimeout(this.indicatorTimer);
    this.indicatorTimer = undefined;
    clearTimeout(this.restoredTimer);
    this.restoredTimer = undefined;
    this.rejectPending();
    this.joinedOnSocket = false;
  }

  private stopPing(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private rejectPending(): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) p.reject(new CommandError('disconnected'));
  }
}
