import type { RoomSettingsInput, TestTimersRequest, Role } from '@pokr/shared';
import { RoomPage } from '../helpers/room-page';
import { FrameRecorder, NetControl } from '../helpers/ws-recorder';
import type { Participant, RoomHandle, World } from './index';

export interface PersonSpec {
  name: string;
  role?: Role;
  net?: boolean;
}

export interface Scenario {
  room: RoomHandle;
  fac: Participant;
  others: Participant[];
  /** All participants, facilitator first. */
  all: Participant[];
}

/**
 * One room with the facilitator in a browser plus `people` joined through the UI, and every
 * context waiting until it sees the full participant list (so tests start from a settled state).
 */
export async function makeRoom(
  world: World,
  people: PersonSpec[],
  opts: {
    settings?: RoomSettingsInput;
    timers?: TestTimersRequest;
    facilitatorName?: string;
    facilitatorNet?: boolean;
  } = {},
): Promise<Scenario> {
  const facName = opts.facilitatorName ?? 'Fiona';
  const room = await world.createRoom({
    displayName: facName,
    ...(opts.settings ? { settings: opts.settings } : {}),
    ...(opts.timers ? { timers: opts.timers } : {}),
  });
  const fac = await world.join(room, {
    name: facName,
    asFacilitator: true,
    ...(opts.facilitatorNet ? { net: true } : {}),
  });
  const others: Participant[] = [];
  for (const p of people) {
    others.push(
      await world.join(room, {
        name: p.name,
        ...(p.role ? { role: p.role } : {}),
        ...(p.net ? { net: true } : {}),
      }),
    );
  }
  const all = [fac, ...others];
  for (const p of all) {
    await p.rec.waitForState(
      (s) => s.participants.length === all.length,
      'all participants listed',
    );
  }
  return { room, fac, others, all };
}

export interface UiCreateOptions {
  name: string;
  roomName?: string;
  deck?: string; // DeckId (option value of start-deck)
  customCards?: string; // as typed into the custom deck field
  controlMode?: 'facilitator' | 'everyone';
  autoReveal?: boolean;
  facilitatorVotes?: boolean;
  net?: boolean;
}

/** Create a room through the start page (AC1 path). Returns the facilitator as a participant. */
export async function createRoomViaUi(world: World, opts: UiCreateOptions): Promise<Participant> {
  const context = await world.newContext();
  const rec = new FrameRecorder();
  let net: NetControl | null = null;
  if (opts.net) {
    net = new NetControl(context, rec);
    await net.install();
  } else {
    context.on('page', (p) => rec.attachPageEvents(p));
  }
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('start-name').fill(opts.name);
  if (opts.roomName !== undefined) await page.getByTestId('start-room-name').fill(opts.roomName);
  if (opts.deck) await page.getByTestId('start-deck').selectOption({ value: opts.deck });
  if (opts.customCards !== undefined)
    await page.getByTestId('start-custom-deck').fill(opts.customCards);
  if (opts.controlMode)
    await page.getByTestId('start-control-mode').selectOption({ value: opts.controlMode });
  if (opts.autoReveal !== undefined)
    await page.getByTestId('start-auto-reveal').setChecked(opts.autoReveal);
  if (opts.facilitatorVotes !== undefined) {
    await page.getByTestId('start-facilitator-votes').setChecked(opts.facilitatorVotes);
  }
  await page.getByTestId('start-create').click();
  const roomPage = new RoomPage(page);
  await page.waitForURL(/\/r\/[0-9a-z]{16}$/);
  await roomPage.expectInRoom();
  return {
    name: opts.name,
    role: 'voter',
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
}
