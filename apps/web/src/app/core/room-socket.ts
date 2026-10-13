import { InjectionToken } from '@angular/core';
import { API_PATHS } from '@pokr/shared';

/**
 * The small transport interface from ADR 0001 (connect, send, onMessage, onClose). Components
 * never see it; only `RoomConnection` does. Tests provide a fake factory.
 */
export interface RoomSocket {
  send(data: string): void;
  close(): void;
}

export interface RoomSocketHandlers {
  open(): void;
  message(data: string): void;
  /** `code` is the WebSocket close code (1006 when the connection never opened or dropped). */
  close(code: number): void;
}

export type RoomSocketFactory = (roomId: string, handlers: RoomSocketHandlers) => RoomSocket;

/** Opens the browser WebSocket on the main thread (R-F3) so Playwright can observe the frames. */
export const browserSocketFactory: RoomSocketFactory = (roomId, handlers) => {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${location.host}${API_PATHS.roomSocket(roomId)}`);
  ws.addEventListener('open', () => handlers.open());
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data === 'string') handlers.message(event.data);
  });
  ws.addEventListener('close', (event: CloseEvent) => handlers.close(event.code));
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
};

export const ROOM_SOCKET_FACTORY = new InjectionToken<RoomSocketFactory>('ROOM_SOCKET_FACTORY', {
  providedIn: 'root',
  factory: () => browserSocketFactory,
});
