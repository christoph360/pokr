import { afterEach, describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { getRoomStub } from '../src/room-stub';
import { Client, closeAll, expectAck, setTimers, setup, sleep } from './helpers';

afterEach(closeAll);

const names = (c: Client) => c.state!.participants.map((p) => p.name);
const pingEvery = (cs: Client[]) => {
  const t = setInterval(
    () =>
      cs.forEach((c) => {
        try {
          if (!c.closed) c.send({ type: 'ping' });
        } catch {
          /* closed */
        }
      }),
    100,
  );
  return () => clearInterval(t);
};

describe('F01-AC21: purge while the facilitator is offline (QA D1)', () => {
  it('facilitator offline first, then another participant leaves: they are purged, facilitator stays', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 500, heartbeatTimeoutMs: 1000 });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    const stop = pingEvery([watcher, later]);
    try {
      fac.close();
      await watcher.waitForState(
        (s) => s.participants.find((p) => p.name === 'Fac')?.online === false,
      );
      later.close();
      await watcher.waitForState((s) => !s.participants.some((p) => p.name === 'Later'), 4000);
      await sleep(1500);
      expect(names(watcher)).toEqual(['Fac', 'Watcher']);
    } finally {
      stop();
    }
  });

  it('participant leaves first, then the facilitator: both orders purge on time', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 500, heartbeatTimeoutMs: 1000 });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    const stop = pingEvery([watcher, fac]);
    try {
      later.close();
      await watcher.waitForState(
        (s) => s.participants.find((p) => p.name === 'Later')?.online === false,
      );
      fac.close();
      await watcher.waitForState((s) => !s.participants.some((p) => p.name === 'Later'), 4000);
      expect(names(watcher)).toEqual(['Fac', 'Watcher']);
    } finally {
      stop();
    }
  });

  it('an offline participant with a vote is purged at the first reset after the deadline, facilitator offline', async () => {
    const { id, fac } = await setup({ controlMode: 'everyone' });
    await setTimers(id, { offlinePurgeMs: 400, heartbeatTimeoutMs: 1000 });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    await later.cmd_({ type: 'vote', card: '5' });
    const stop = pingEvery([watcher]);
    try {
      fac.close();
      later.close();
      await watcher.waitForState(
        (s) => s.participants.find((p) => p.name === 'Later')?.online === false,
      );
      await sleep(1200);
      expect(names(watcher)).toEqual(['Fac', 'Watcher', 'Later']); // holds a vote: kept
      expectAck(await watcher.cmd_({ type: 'reset' }));
      expect(names(watcher)).toEqual(['Fac', 'Watcher']);
    } finally {
      stop();
    }
  });

  it('with the facilitator online, the same purge works (control)', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 500, heartbeatTimeoutMs: 1000 });
    const later = await Client.join(id, 'Later');
    const stop = pingEvery([fac]);
    try {
      later.close();
      await fac.waitForState((s) => !s.participants.some((p) => p.name === 'Later'), 4000);
    } finally {
      stop();
    }
  });
});

describe('D1 variant: a watcher that pings only every 400 ms with a 1 s heartbeat', () => {
  it('facilitator offline, then Later leaves', async () => {
    const { id, fac } = await setup();
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    await setTimers(id, { offlinePurgeMs: 500, heartbeatTimeoutMs: 1000 });
    const t = setInterval(() => {
      if (!watcher.closed) watcher.send({ type: 'ping' });
    }, 400);
    try {
      fac.close();
      await watcher.waitForState(
        (s) => s.participants.find((p) => p.name === 'Fac')?.online === false,
      );
      later.close();
      await watcher.waitForState((s) => !s.participants.some((p) => p.name === 'Later'), 4000);
    } finally {
      clearInterval(t);
    }
  });
});

describe('alarm scheduling (QA D1 follow-up)', () => {
  it('a removed participant leaves no stale timer behind: the next alarm is the real earliest deadline', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { heartbeatTimeoutMs: 20_000 });
    const bob = await Client.join(id, 'Bob');
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    await bob.waitForClose();
    await sleep(100);
    const stub = getRoomStub(env, id);
    const alarm = await runInDurableObject(stub, (_i, s) => s.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeGreaterThan(2000); // heartbeat deadline, not a 10 ms spin
  });

  it('with nobody connected, purge is applied lazily on the next entry and the facilitator stays', async () => {
    const { id, fac, room } = await setup();
    await setTimers(id, { offlinePurgeMs: 300, heartbeatTimeoutMs: 600 });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    fac.close();
    later.close();
    watcher.close();
    await sleep(900);
    const back = await Client.rejoin(id, room.token);
    expect(names(back)).toEqual(['Fac']);
    expect(back.state!.facilitatorId).toBe(back.participantId);
  });

  it('a silent watcher (no pings) is closed by the heartbeat and so cannot be pushed the purge', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 1500, heartbeatTimeoutMs: 400 });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    fac.close();
    later.close();
    expect((await watcher.waitForClose(3000)).code).toBe(1001);
    expect(names(watcher)).toContain('Later'); // frozen view: the socket is gone
  });

  it('the alarm moves to the purge deadline when an earlier-scheduled alarm was for the exempt facilitator', async () => {
    const { id, fac } = await setup();
    await setTimers(id, {
      offlinePurgeMs: 300,
      heartbeatTimeoutMs: 20_000,
      facilitatorClaimMs: 20_000,
    });
    const watcher = await Client.join(id, 'Watcher');
    const later = await Client.join(id, 'Later');
    fac.close();
    await watcher.waitForState((s) => s.participants[0]!.online === false);
    const stub = getRoomStub(env, id);
    const claimAlarm = await runInDurableObject(stub, (_i, s) => s.storage.getAlarm());
    expect(claimAlarm! - Date.now()).toBeGreaterThan(5000);
    later.close();
    await watcher.waitForState((s) => !s.participants.some((p) => p.name === 'Later'), 3000);
  });
});
