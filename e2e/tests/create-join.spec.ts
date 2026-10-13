import type { Locator } from '@playwright/test';
import { DISPLAY_NAME_MAX, DEFAULT_SETTINGS, resolveDeck } from '@pokr/shared';
import { expect, fillJoinForm, test } from '../fixtures';
import { createRoomViaUi, makeRoom } from '../fixtures/scenarios';
import { observeFor } from '../helpers/wait';
import { RoomPage } from '../helpers/room-page';

const cross = { tag: '@cross-browser' };

async function textOf(loc: Locator): Promise<string> {
  return loc.evaluate((el) => (el as HTMLInputElement).value ?? el.textContent ?? '');
}

test.describe('create a room', () => {
  test(
    'F01-AC1: entering only a name creates a room and makes me facilitator',
    cross,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, { name: 'Fiona' });
      await expect(fac.page).toHaveURL(/\/r\/[0-9a-z]{16}$/);
      await expect(fac.room.reveal).toBeVisible();
      await expect(fac.room.reset).toBeVisible();
      await expect(fac.room.settingsOpen).toBeVisible();
      const state = await fac.rec.waitForState((s) => s.participants.length === 1, 'own state');
      expect(state.facilitatorId).toBe(state.selfId);
      expect(state.participants[0]).toMatchObject({ name: 'Fiona', role: 'voter', online: true });
      await expect(fac.room.ownRow).toHaveAttribute('data-role', 'voter');
    },
  );

  test(
    'F01-AC1: room URL is shown and the copy button copies it with visible feedback',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const fac = await createRoomViaUi(world, { name: 'Fiona' });
      await fac.context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const shown = (await textOf(fac.page.getByTestId('room-url'))).trim();
      expect(shown).toMatch(/\/r\/[0-9a-z]{16}$/);
      await fac.page.getByTestId('copy-link').click();
      await expect(fac.page.getByTestId('copy-feedback')).toBeVisible();
      const clip = await fac.page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe(
        shown.startsWith('http') ? shown : new URL(shown, fac.page.url()).toString(),
      );
    },
  );

  test(
    'F01-AC1: copy feedback is announced through a live region (F01-AC33)',
    cross,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, { name: 'Fiona' });
      await fac.page.getByTestId('copy-link').click();
      const fb = fac.page.getByTestId('copy-feedback');
      await expect(fb).toBeVisible();
      // The element itself or an ancestor is a live region.
      const live = await fb.evaluate(
        (el) => !!el.closest('[aria-live], [role="status"], [role="alert"]'),
      );
      expect(live).toBe(true);
    },
  );

  test(
    'F01-AC1 / F01-AC3: name, room name, deck, control mode, auto-reveal and facilitator votes are applied',
    cross,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, {
        name: 'Fiona',
        roomName: 'Sprint 42 planning',
        deck: 'tshirt',
        controlMode: 'everyone',
        autoReveal: true,
        facilitatorVotes: false,
      });
      const s = await fac.rec.waitForState((st) => st.participants.length === 1, 'state');
      expect(s.settings).toEqual({
        name: 'Sprint 42 planning',
        deck: { id: 'tshirt' },
        controlMode: 'everyone',
        autoReveal: true,
        facilitatorVotes: false,
      });
      await expect(fac.page).toHaveTitle(/Sprint 42 planning/);
      // Facilitator votes off: no cards for the facilitator (F01-AC35).
      await expect(fac.page.getByTestId('card-grid')).toHaveCount(0);
    },
  );

  test(
    'F01-AC1 / F01-AC34: a custom deck from the start page gets ? and the coffee card appended',
    cross,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, {
        name: 'Fiona',
        deck: 'custom',
        customCards: 'a, bb, c3',
      });
      const s = await fac.rec.waitForState((st) => st.participants.length === 1, 'state');
      expect(s.settings.deck).toEqual({ id: 'custom', cards: ['a', 'bb', 'c3'] });
      for (const c of resolveDeck(s.settings.deck)) await expect(fac.room.card(c)).toBeVisible();
    },
  );

  test('F01-AC3: with only a name, the defaults apply', cross, async ({ world }) => {
    const fac = await createRoomViaUi(world, { name: 'Fiona' });
    const s = await fac.rec.waitForState((st) => st.participants.length === 1, 'state');
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    await expect(fac.page).toHaveTitle(/Planning session/);
    await fac.room.openSettings();
    await expect(fac.page.getByTestId('setting-deck')).toHaveValue('fibonacci');
    await expect(fac.page.getByTestId('setting-control-mode')).toHaveValue('facilitator');
    await expect(fac.page.getByTestId('setting-auto-reveal')).not.toBeChecked();
    await expect(fac.page.getByTestId('setting-facilitator-votes')).toBeChecked();
  });

  test(
    'F01-AC1 / F01-AC4: the start page refuses an empty or too long name',
    cross,
    async ({ world }) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/');
      const create = page.getByTestId('start-create');
      for (const bad of ['', '   ']) {
        await page.getByTestId('start-name').fill(bad);
        if (await create.isEnabled()) await create.click();
        await expect(page).not.toHaveURL(/\/r\//);
      }
      await page.getByTestId('start-name').fill('x'.repeat(DISPLAY_NAME_MAX + 1));
      if (await create.isEnabled()) await create.click();
      await observeFor(page, 300);
      // Either blocked, or the input truncated to the limit; never a 31-char name.
      const value = await page.getByTestId('start-name').inputValue();
      if (/\/r\//.test(page.url())) expect(value.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
      else await expect(page).not.toHaveURL(/\/r\//);
    },
  );

  test('F01-AC2: the room URL has the form /r/<16 chars>', cross, async ({ world }) => {
    const fac = await createRoomViaUi(world, { name: 'Fiona' });
    expect(new URL(fac.page.url()).pathname).toMatch(/^\/r\/[0-9a-hjkmnp-tv-z]{16}$/);
  });

  test('F01-AC2: an upper-case room URL opens the same room', cross, async ({ world }) => {
    const room = await world.createRoom();
    const p = await world.join(room, { name: 'Uma', noGoto: true });
    await p.page.goto(room.url.toUpperCase().replace('/R/', '/r/'));
    await fillJoinForm(p.page, 'Uma', 'voter');
    await p.room.expectInRoom();
  });
});

test.describe('join', () => {
  test(
    'F01-AC4: opening a link asks for a name and a voter/observer choice, voter preselected',
    cross,
    async ({ world }) => {
      const room = await world.createRoom();
      const p = await world.join(room, { name: 'Vera', noJoinForm: true });
      await expect(p.page.getByTestId('join-name')).toBeVisible();
      await expect(p.page.getByTestId('join-role-voter')).toBeChecked();
      await expect(p.page.getByTestId('join-role-observer')).not.toBeChecked();
      await expect(p.page.getByTestId('join-submit')).toBeVisible();
      await expect(p.room.participantList).toHaveCount(0);
    },
  );

  test('F01-AC4: a voter joins with a 1-char and a 30-char name', cross, async ({ world }) => {
    const { room } = await makeRoom(world, [{ name: 'V' }, { name: 'W'.repeat(30) }]);
    const fac = await world.rawFacilitator(room);
    await fac.waitForState((s) => s.participants.length === 3, 'three participants');
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fiona', 'V', 'W'.repeat(30)]);
  });

  test(
    'F01-AC4: blank, whitespace-only and 31-char names do not get into the room',
    cross,
    async ({ world }) => {
      const room = await world.createRoom();
      const p = await world.join(room, { name: 'x', noJoinForm: true });
      const submit = p.page.getByTestId('join-submit');
      for (const bad of ['', '    ']) {
        await p.page.getByTestId('join-name').fill(bad);
        if (await submit.isEnabled()) await submit.click();
        await expect(p.page.getByTestId('join-name')).toBeVisible();
        await expect(p.room.participantList).toHaveCount(0);
      }
      await p.page.getByTestId('join-name').fill('y'.repeat(DISPLAY_NAME_MAX + 1));
      if (await submit.isEnabled()) await submit.click();
      await observeFor(p.page, 300);
      const fac = await world.rawFacilitator(room);
      expect(fac.state!.participants.every((x) => [...x.name].length <= DISPLAY_NAME_MAX)).toBe(
        true,
      );
    },
  );

  test(
    'F01-AC4 / F01-AC12: joining as observer shows no cards and an observer role in the list',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Olga', role: 'observer' }]);
      const obs = others[0]!;
      await expect(obs.page.locator('[data-testid^="card-"]')).toHaveCount(0);
      await expect(fac.room.row('Olga')).toHaveAttribute('data-role', 'observer');
      await expect(fac.room.row('Olga')).toHaveAttribute('data-voted', 'false');
    },
  );
});

test.describe('identity', () => {
  test(
    'F01-AC5: reopening the link in the same browser rejoins as the same participant',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      const id = await vera.id();
      await vera.page.close();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false');
      const page2 = await vera.context.newPage();
      await page2.goto(room.url);
      const rp2 = new RoomPage(page2);
      await rp2.expectInRoom();
      await expect(page2.getByTestId('join-name')).toHaveCount(0);
      await expect(fac.room.rows).toHaveCount(2);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-participant-id', id);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await rp2.expectSelected('5');
    },
  );

  test('F01-AC5: a reload during voting keeps my vote and role', cross, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [
      { name: 'Olga', role: 'observer' },
      { name: 'Vera' },
    ]);
    const [olga, vera] = others as [(typeof others)[0], (typeof others)[0]];
    await vera.room.vote('8');
    await vera.page.reload();
    await vera.room.expectInRoom();
    await vera.room.expectSelected('8');
    await olga.page.reload();
    await olga.room.expectInRoom();
    await expect(olga.page.locator('[data-testid^="card-"]')).toHaveCount(0);
    await expect(fac.room.rows).toHaveCount(3);
    await expect(fac.room.row('Olga')).toHaveAttribute('data-role', 'observer');
  });

  test(
    'F01-AC5: several tabs with one token are one participant who stays online while one tab is open',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      const tab2 = await vera.context.newPage();
      await tab2.goto(room.url);
      const rp2 = new RoomPage(tab2);
      await rp2.expectInRoom();
      await expect(fac.room.rows).toHaveCount(2);
      await vera.room.vote('3');
      await rp2.expectSelected('3');
      await vera.page.close();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      await tab2.close();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false');
    },
  );

  test('F01-AC5: a fresh browser context is a new participant', cross, async ({ world }) => {
    const { room, fac } = await makeRoom(world, [{ name: 'Vera' }]);
    await world.join(room, { name: 'Vera' });
    await expect(fac.room.rows).toHaveCount(3);
    await expect(fac.room.row('Vera')).toBeVisible();
    await expect(fac.room.row('Vera (2)')).toBeVisible();
  });

  test(
    'F01-AC5 / F01-AC21: after being purged, reopening the link is a fresh join',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }], {
        timers: { offlinePurgeMs: 800, heartbeatTimeoutMs: 1500 },
      });
      const vera = others[0]!;
      await vera.page.close();
      await expect(fac.room.row('Vera')).toHaveCount(0, { timeout: 10_000 });
      const page2 = await vera.context.newPage();
      await page2.goto(room.url);
      await expect(page2.getByTestId('join-name')).toBeVisible();
    },
  );
});

test.describe('unknown and malformed room links', () => {
  test(
    'F01-AC6: a never-created room shows "room not found" with a way to create a new room',
    cross,
    async ({ world }) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/r/0123456789abcdef');
      await expect(page.getByTestId('room-not-found')).toBeVisible();
      await expect(page.getByTestId('join-name')).toHaveCount(0);
      await page.getByTestId('room-not-found-create').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId('start-name')).toBeVisible();
    },
  );

  test(
    'F01-AC6 / F01-AC2: malformed ids show "room not found" and do not crash',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      for (const id of [
        'abc',
        'x'.repeat(100),
        '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
        '..%2F..%2Fadmin',
        'ILOU0000ILOU0000',
      ]) {
        await page.goto(`/r/${id}`);
        await expect(page.getByTestId('room-not-found'), id).toBeVisible();
      }
    },
  );

  test(
    'F01-AC6: the room does not exist after merely visiting its link',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/r/aaaaaaaaaaaaaaaa');
      await expect(page.getByTestId('room-not-found')).toBeVisible();
      expect((await world.api.roomInfoRaw('aaaaaaaaaaaaaaaa')).status()).toBe(404);
    },
  );
});
