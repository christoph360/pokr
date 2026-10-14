import { vi } from 'vitest';
import { signal } from '@angular/core';
import type { HeldAgenda, RoomState, StoryDetail } from '@pokr/shared';
import { RoomConnection } from '../core/room-connection';
import type { CommandInput } from '../core/room-connection';

type Reply = (cmd: CommandInput) => Promise<number>;

/** A stand-in for `RoomConnection`: records commands, lets a test decide the reply. */
export function connStub(state: RoomState, reply: Reply = () => Promise.resolve(1)) {
  const sent: CommandInput[] = [];
  const stories = new Map<string, StoryDetail>();
  const stub = {
    state: signal<RoomState | null>(state),
    connected: signal(true),
    notice: signal(null),
    agenda: signal<HeldAgenda | null>(null),
    serverNow: () => Date.now(),
    resync: vi.fn(),
    send: (cmd: CommandInput) => {
      sent.push(cmd);
      return reply(cmd);
    },
    getStory: (id: string) => {
      const found = stories.get(id);
      return found ? Promise.resolve(found) : Promise.reject(new Error('no such story'));
    },
  };
  return { provider: { provide: RoomConnection, useValue: stub }, stub, sent, stories };
}
