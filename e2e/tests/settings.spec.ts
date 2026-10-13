import { resolveDeck } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { createRoomViaUi, makeRoom } from '../fixtures/scenarios';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

test.describe('settings (F01-AC27)', () => {
  test(
    'F01-AC27: each setting change reaches every participant without a reload',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await fac.room.openSettings();

      await fac.room.setRoomName('Retro bash');
      for (const p of [vera, olga]) await expect(p.page).toHaveTitle(/Retro bash/);

      await fac.room.selectDeck('tshirt');
      for (const c of resolveDeck({ id: 'tshirt' })) await expect(vera.room.card(c)).toBeVisible();
      await expect(vera.room.card('5')).toHaveCount(0);

      await fac.room.setControlMode('everyone');
      await expect(vera.room.reveal).toBeVisible();

      await fac.room.setAutoReveal(true);
      await vera.rec.waitForState((s) => s.settings.autoReveal, 'auto reveal on');
      await fac.room.setFacilitatorVotes(false);
      await vera.rec.waitForState((s) => !s.settings.facilitatorVotes, 'facilitator votes off');
      await expect(fac.page.locator('[data-testid^="card-"]')).toHaveCount(0);
      const final = olga.rec.lastState!;
      expect(final.settings).toMatchObject({
        name: 'Retro bash',
        deck: { id: 'tshirt' },
        controlMode: 'everyone',
        autoReveal: true,
        facilitatorVotes: false,
      });
    },
  );

  test(
    'F01-AC27 / F01-AC13: participants have no settings UI and the server refuses their changes in both modes',
    chromiumOnly,
    async ({ world }) => {
      for (const controlMode of ['facilitator', 'everyone'] as const) {
        const room = await world.createRoom({ settings: { controlMode } });
        await world.rawFacilitator(room);
        const v = await world.raw(room, 'Vera');
        for (const settings of [
          { name: 'x' },
          { deck: { id: 'tshirt' } },
          { controlMode: 'facilitator' },
          { autoReveal: true },
          { facilitatorVotes: false },
        ]) {
          const r = await v.command('update_settings', { settings, confirmReset: true });
          expect(r.ok ? 'ok' : r.code, `${controlMode} ${JSON.stringify(settings)}`).toBe(
            'not_allowed',
          );
        }
      }
    },
  );

  test(
    'F01-AC27: a custom deck set in the settings is offered to everyone with ? and coffee appended',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await fac.room.openSettings();
      await fac.room.selectDeck('custom');
      await fac.page.getByTestId('setting-custom-deck').fill('s1, s2, s3');
      await fac.page.getByTestId('setting-custom-deck-apply').click();
      for (const c of ['s1', 's2', 's3', '?', '☕'])
        await expect(others[0]!.room.card(c)).toBeVisible();
    },
  );
});

test.describe('deck change (F01-AC28)', () => {
  test(
    'F01-AC28: with votes cast the facilitator must confirm; cancel keeps deck and votes, confirm resets the round',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.openSettings();
      await fac.room.selectDeck('tshirt');
      await expect(fac.page.getByTestId('deck-confirm')).toBeVisible();
      await fac.page.getByTestId('deck-confirm-cancel').click();
      await expect(fac.page.getByTestId('deck-confirm')).toBeHidden();
      await expect(fac.page.getByTestId('setting-deck')).toHaveValue('fibonacci');
      await expect(vera.room.card('5')).toBeVisible();
      await vera.room.expectSelected('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');

      await fac.room.selectDeck('tshirt');
      await fac.page.getByTestId('deck-confirm-ok').click();
      await expect(vera.room.card('xl')).toBeVisible();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
      await expect(vera.room.card('5')).toHaveCount(0);
      await vera.rec.waitForState(
        (s) => s.settings.deck.id === 'tshirt' && s.myVote === null && s.round.phase === 'voting',
        'deck and round reset',
      );
    },
  );

  test(
    'F01-AC28: without votes there is no dialog; selecting the current deck is not a change',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await fac.room.openSettings();
      const v0 = await fac.room.version();
      await fac.room.selectDeck('fibonacci');
      await expect(fac.page.getByTestId('deck-confirm')).toBeHidden();
      expect(await fac.room.version()).toBe(v0);
      await fac.room.selectDeck('powers-of-2');
      await expect(fac.page.getByTestId('deck-confirm')).toBeHidden();
      await expect(others[0]!.room.card('64')).toBeVisible();
    },
  );

  test(
    'F01-AC28: the server enforces confirmReset, also for a revealed round',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      await a.vote('5');
      const refused = await fac.command('update_settings', {
        settings: { deck: { id: 'tshirt' } },
      });
      expect(refused.ok ? 'ok' : refused.code).toBe('confirmation_required');
      expect(fac.state!.settings.deck.id).toBe('fibonacci');
      expect(a.state!.myVote).toBe('5');
      // Same deck is not a change, even with votes.
      expect(
        (await fac.command('update_settings', { settings: { deck: { id: 'fibonacci' } } })).ok,
      ).toBe(true);
      // Revealed round with votes: still needs confirmation.
      await fac.command('reveal');
      const again = await fac.command('update_settings', { settings: { deck: { id: 'tshirt' } } });
      expect(again.ok ? 'ok' : again.code).toBe('confirmation_required');
      expect(
        (
          await fac.command('update_settings', {
            settings: { deck: { id: 'tshirt' } },
            confirmReset: true,
          })
        ).ok,
      ).toBe(true);
      const s = await a.waitForState((st) => st.settings.deck.id === 'tshirt', 'deck changed');
      expect(s.round.phase).toBe('voting');
      expect(s.myVote).toBeNull();
      expect(s.participants.every((p) => !p.hasVoted)).toBe(true);
    },
  );

  test(
    'F01-AC28 / F01-X-RACE-11: a vote arriving while the dialog is open is covered by the server confirmation',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await fac.room.openSettings();
      // Vote lands after the facilitator's UI computed "no votes", before the deck change is sent.
      await others[0]!.room.vote('3');
      await fac.room.selectDeck('tshirt');
      await expect(fac.page.getByTestId('deck-confirm')).toBeVisible();
    },
  );
});

test.describe('custom deck input (F01-AC34)', () => {
  test(
    'F01-AC34: duplicates, empty cards, long cards and manual specials show an inline error and do not create a room',
    cross,
    async ({ world }) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/');
      await page.getByTestId('start-name').fill('Fiona');
      await page.getByTestId('start-deck').selectOption({ value: 'custom' });
      for (const bad of [
        'a, A',

        'abcde',
        'a, ?',
        'a, ☕',
        Array.from({ length: 21 }, (_, i) => `c${i}`).join(','),
      ]) {
        await page.getByTestId('start-custom-deck').fill(bad);
        const create = page.getByTestId('start-create');
        if (await create.isEnabled()) await create.click();
        await expect(page.getByTestId('start-custom-deck-error'), bad).toBeVisible();
        await expect(page, bad).not.toHaveURL(/\/r\//);
      }
    },
  );

  test(
    'F01-AC34: a valid custom deck creates a room with those cards plus ? and coffee',
    chromiumOnly,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, {
        name: 'Fiona',
        deck: 'custom',
        customCards: 'XS,S,M,L',
      });
      for (const c of ['XS', 'S', 'M', 'L', '?', '☕'])
        await expect(fac.room.card(c)).toBeVisible();
    },
  );
});
