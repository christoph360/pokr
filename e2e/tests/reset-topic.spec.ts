import { TOPIC_MAX } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeRoom } from '../fixtures/scenarios';

const cross = { tag: '@cross-browser' };

test.describe('reset (F01-AC19)', () => {
  test(
    'F01-AC19: reset clears votes everywhere, returns to voting and keeps the topic',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await fac.room.setTopic('T1');
      await expect(vera.room.topicDisplay).toHaveText('T1');
      await vera.room.vote('5');
      await fac.room.reveal.click();
      await expect(olga.room.summary).toBeVisible();
      await fac.room.reset.click();
      for (const p of [fac, vera, olga]) {
        await expect(p.room.summary).toHaveCount(0);
        await expect(p.room.row('Vera')).toHaveAttribute('data-voted', 'false');
        await expect(p.room.row('Vera').getByTestId('participant-vote')).not.toHaveText('5');
        await expect(p.room.topicDisplay).toHaveText('T1');
      }
      await vera.room.expectSelected('5', false);
      await expect(fac.room.topicInput).toHaveValue('T1');
      await vera.rec.waitForState(
        (s) => s.round.phase === 'voting' && s.round.number === 2,
        'round 2',
      );
      // Voting works again in the new round.
      await vera.room.vote('8');
    },
  );

  test(
    'F01-AC19: resetting an unrevealed round with votes asks for confirmation; cancel keeps the votes',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.reset.click();
      await expect(fac.page.getByTestId('reset-confirm')).toBeVisible();
      await fac.page.getByTestId('reset-confirm-cancel').click();
      await expect(fac.page.getByTestId('reset-confirm')).toBeHidden();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.reset.click();
      await fac.page.getByTestId('reset-confirm-ok').click();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
      await vera.room.expectSelected('5', false);
    },
  );

  test(
    'F01-AC19: resetting without votes or after reveal needs no confirmation',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const v0 = await fac.room.version();
      await fac.room.reset.click();
      await expect(fac.page.getByTestId('reset-confirm')).toBeHidden();
      await fac.room.waitForVersionAtLeast(v0 + 1);
      await others[0]!.room.vote('3');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.reveal.click();
      // Reset only once the reveal is visible; before that the round still has unrevealed votes.
      await expect(fac.room.summary).toBeVisible();
      await fac.room.reset.click();
      await expect(fac.page.getByTestId('reset-confirm')).toBeHidden();
      await expect(fac.room.summary).toHaveCount(0);
    },
  );

  test(
    'F01-AC19: reset takes an optional new topic and applies both atomically; omitted keeps it; empty clears',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const watcher = await world.raw(room, 'Wanda', 'observer');
      await fac.command('set_topic', { topic: 'T1' });
      await fac.vote('5');
      await fac.command('reveal');
      const mark = watcher.frames.length;
      expect((await fac.command('reset', { topic: 'T2' })).ok).toBe(true);
      await watcher.waitForState((s) => s.topic === 'T2', 'new topic');
      // Atomic: no state between "voting with the old topic" and "topic T2" was broadcast.
      const seen = watcher.frames
        .slice(mark)
        .flatMap((f) => (f.msg?.type === 'state' ? [f.msg.state] : []));
      for (const s of seen) {
        expect(s.topic === 'T2' || s.round.phase === 'revealed').toBe(true);
        if (s.round.phase === 'voting') expect(s.topic).toBe('T2');
      }
      await fac.command('reset');
      expect(fac.state!.topic).toBe('T2');
      await fac.command('reset', { topic: '' });
      await fac.waitForState((s) => s.topic === '', 'topic cleared by reset');
    },
  );

  test(
    'F01-AC19: reset clears the retained votes of offline participants',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const b = await world.raw(room, 'Ben');
      await b.vote('8');
      b.close();
      await fac.waitForState(
        (s) => s.participants.some((p) => !p.online && p.hasVoted),
        'Ben offline with vote',
      );
      await fac.command('reset');
      const s = await fac.waitForState(
        (st) => st.participants.every((p) => !p.hasVoted),
        'votes cleared',
      );
      expect(s.round.phase).toBe('voting');
    },
  );

  test(
    'F01-AC19 / F01-AC13: reset by an observer is refused even in everyone mode',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom({ settings: { controlMode: 'everyone' } });
      await world.rawFacilitator(room);
      const o = await world.raw(room, 'Olga', 'observer');
      const r = await o.command('reset');
      expect(r.ok ? 'ok' : r.code).toBe('not_allowed');
    },
  );
});

test.describe('topic (F01-AC20)', () => {
  test(
    'F01-AC20: the topic appears for everyone above the cards, and can be cleared',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      await fac.room.setTopic('Checkout redesign');
      for (const p of others) await expect(p.room.topicDisplay).toHaveText('Checkout redesign');
      const topicBox = await others[0]!.room.topicDisplay.boundingBox();
      const gridBox = await others[0]!.room.cardGrid.boundingBox();
      expect(topicBox!.y).toBeLessThan(gridBox!.y);
      await fac.room.setTopic('');
      for (const p of others) {
        await expect
          .poll(
            async () => (await p.room.topicDisplay.allInnerTexts()).every((t) => t.trim() === ''),
            { message: 'topic cleared' },
          )
          .toBe(true);
      }
    },
  );

  test('F01-AC20: a topic can be changed after reveal', cross, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
    await fac.room.reveal.click();
    await fac.room.setTopic('After the fact');
    await expect(others[0]!.room.topicDisplay).toHaveText('After the fact');
  });

  test(
    'F01-AC20: 200 characters are accepted, 201 are not',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const ok = 'a'.repeat(TOPIC_MAX);
      await fac.room.setTopic(ok);
      await expect(others[0]!.room.topicDisplay).toHaveText(ok);
      await fac.room.topicInput.fill('b'.repeat(TOPIC_MAX + 1));
      await fac.room.topicSave.click().catch(() => undefined);
      const shown = await others[0]!.room.topicDisplay.innerText();
      expect(shown).not.toContain('b'.repeat(TOPIC_MAX + 1));
      expect(shown.length).toBeLessThanOrEqual(TOPIC_MAX);
    },
  );

  test(
    'F01-AC20: HTML in a topic is rendered as literal text and never executes',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const dialogs: string[] = [];
      for (const p of [fac, ...others])
        p.page.on('dialog', (d) => void d.dismiss().then(() => dialogs.push(d.message())));
      const payload = '<img src=x onerror=alert(1)> <b>bold</b>';
      await fac.room.setTopic(payload);
      await expect(others[0]!.room.topicDisplay).toHaveText(payload);
      await expect(others[0]!.room.topicDisplay.locator('img, b')).toHaveCount(0);
      await expect(others[0]!.page).toHaveTitle(/.*/);
      expect(dialogs).toEqual([]);
    },
  );

  test(
    'F01-AC20: a long unbroken topic and a long name do not overflow a 320 px viewport',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { room, fac } = await makeRoom(world, []);
      const narrow = await world.join(room, { name: 'W'.repeat(30) });
      await narrow.page.setViewportSize({ width: 320, height: 640 });
      await fac.room.setTopic('W'.repeat(200));
      await expect(narrow.room.topicDisplay).toHaveText('W'.repeat(200));
      const overflow = await narrow.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    },
  );

  test(
    'F01-AC20 / F01-AC13: only the facilitator sets the topic, in both control modes',
    { tag: '@chromium-only' },
    async ({ world }) => {
      for (const controlMode of ['facilitator', 'everyone'] as const) {
        const room = await world.createRoom({ settings: { controlMode } });
        await world.rawFacilitator(room);
        const v = await world.raw(room, 'Vera');
        const r = await v.command('set_topic', { topic: 'hijack' });
        expect(r.ok ? 'ok' : r.code, controlMode).toBe('not_allowed');
      }
    },
  );
});
