import { expect } from '@playwright/test';
import type { RoomSettingsInput, TestTimersRequest } from '@pokr/shared';
import type { RawClient } from '../helpers/raw-client';
import { StoryPage } from '../helpers/story-page';
import { addStories } from '../helpers/stories';
import { makeRoom } from './scenarios';
import type { PersonSpec, Scenario } from './scenarios';
import type { Participant, RoomHandle, World } from './index';

export interface RawStoryRoom {
  room: RoomHandle;
  /** The creator, as a raw client (paced). */
  fac: RawClient;
  voters: RawClient[];
  observers: RawClient[];
  /** Story ids by title, for the titles given at setup. */
  ids: Record<string, string>;
}

/**
 * A room driven entirely over the raw protocol: facilitator, named voters and observers, and an
 * initial agenda (added in one bulk message). Defaults to Story list mode.
 */
export async function rawStoryRoom(
  world: World,
  opts: {
    settings?: RoomSettingsInput;
    voters?: string[];
    observers?: string[];
    titles?: string[];
    timers?: TestTimersRequest;
  } = {},
): Promise<RawStoryRoom> {
  const room = await world.createRoom({
    settings: { storySource: 'stories', ...opts.settings },
    ...(opts.timers ? { timers: opts.timers } : {}),
  });
  const fac = await world.rawFacilitator(room);
  fac.paced = true;
  const voters: RawClient[] = [];
  for (const name of opts.voters ?? []) {
    const c = await world.raw(room, name, 'voter');
    c.paced = true;
    voters.push(c);
  }
  const observers: RawClient[] = [];
  for (const name of opts.observers ?? []) {
    const c = await world.raw(room, name, 'observer');
    c.paced = true;
    observers.push(c);
  }
  const ids: Record<string, string> = {};
  if (opts.titles && opts.titles.length > 0) {
    const created = await addStories(fac, opts.titles);
    opts.titles.forEach((t, i) => {
      ids[t] = created[i]!;
    });
  }
  return { room, fac, voters, observers, ids };
}

export interface UiStoryRoom extends Scenario {
  /** The creator as a raw client (same participant as `fac`, a second connection). */
  raw: RawClient;
  ids: Record<string, string>;
}

/** Story page object for a participant. */
export function sp(p: Participant): StoryPage {
  return new StoryPage(p.page);
}

/**
 * Browser participants in a Story-list-mode room with an initial agenda added over the raw
 * protocol. Every context has seen the full agenda when this returns.
 */
export async function makeStoryRoom(
  world: World,
  people: PersonSpec[],
  opts: {
    settings?: RoomSettingsInput;
    titles?: string[];
    timers?: TestTimersRequest;
    facilitatorName?: string;
  } = {},
): Promise<UiStoryRoom> {
  const sc = await makeRoom(world, people, {
    settings: { storySource: 'stories', ...opts.settings },
    ...(opts.timers ? { timers: opts.timers } : {}),
    ...(opts.facilitatorName ? { facilitatorName: opts.facilitatorName } : {}),
  });
  for (const p of sc.all) await sp(p).openAgenda();
  const raw = await world.rawFacilitator(sc.room);
  raw.paced = true;
  const ids: Record<string, string> = {};
  const titles = opts.titles ?? [];
  if (titles.length > 0) {
    const created = await addStories(raw, titles);
    titles.forEach((t, i) => {
      ids[t] = created[i]!;
    });
    for (const p of sc.all) await expect(sp(p).rows).toHaveCount(titles.length);
  }
  return { ...sc, raw, ids };
}
