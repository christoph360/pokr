import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { getRoomStub } from '../src/room-stub';
import { Client, closeAll, expectAck, expectCode, setup, sleep } from './helpers';

afterEach(async () => {
  closeAll();
  await sleep(150); // let close handlers finish before the worker is torn down
});

type Patchable = Record<string, (...args: unknown[]) => unknown>;
const patch = <T>(id: string, fn: (instance: Patchable) => T) =>
  runInDurableObject(getRoomStub(env, id), (instance) => fn(instance as unknown as Patchable));

describe('D3: transient storage failures never fail a committed command', () => {
  it('alarm calls that throw do not turn commands or joins into internal_error, and the next entry re-arms the alarm', async () => {
    const errors: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void errors.push(a.join(' ')));
    const { id, fac } = await setup();
    await patch(id, (o) => {
      o['rescheduleOnce'] = () => Promise.reject(new Error('internal error; reference = x'));
    });
    const bob = await Client.join(id, 'Bobsecret');
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'Topicsecret' }));
    for (const c of [fac, bob]) {
      expect(c.messages.filter((m) => m.type === 'error')).toEqual([]);
    }
    // Final failure is logged with IDs only.
    const failure = errors.find((e) => e.includes('reschedule_failed'));
    expect(failure).toBeDefined();
    expect(errors.join('\n')).not.toMatch(/Bobsecret|Topicsecret|reference/);
    spy.mockRestore();
    // Recovery: remove the fault; the next command re-arms heartbeat/purge.
    await patch(id, (o) => {
      delete o['rescheduleOnce'];
    });
    expectAck(await bob.cmd_({ type: 'vote', card: '8' }));
    const alarm = await runInDurableObject(getRoomStub(env, id), (_i, s) => s.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });

  it('a single alarm failure is retried once and succeeds silently', async () => {
    const { id, fac } = await setup();
    await patch(id, (o) => {
      const real = o['rescheduleOnce']!;
      let n = 0;
      o['rescheduleOnce'] = function (this: unknown) {
        if (n++ === 0) return Promise.reject(new Error('internal error'));
        return real.call(this) as Promise<void>;
      };
    });
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'x' }));
    await sleep(100);
    const alarm = await runInDurableObject(getRoomStub(env, id), (_i, s) => s.storage.getAlarm());
    expect(alarm).not.toBeNull();
  });

  it('SQLITE_BUSY on a transaction is retried; a join is applied exactly once', async () => {
    const { id, fac } = await setup();
    await patch(id, (o) => {
      const real = o['transact']!;
      let failures = 0;
      o['transact'] = function (this: unknown, ...args: unknown[]) {
        if (failures < 2) {
          failures++;
          throw new Error('database is locked: SQLITE_BUSY');
        }
        return real.apply(this, args);
      };
    });
    const bob = await Client.join(id, 'Bob');
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    expect(bob.messages.filter((m) => m.type === 'error')).toEqual([]);
    await fac.waitForState((s) => s.participants.length === 2);
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fac', 'Bob']);
    expect(fac.state!.participants[1]!.hasVoted).toBe(true);
  });

  it('persistent SQLITE_BUSY surfaces as internal_error without applying the command, and the room recovers', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await patch(id, (o) => {
      const real = o['transact']!;
      o['__real'] = real;
      o['transact'] = () => {
        throw new Error('database is locked: SQLITE_BUSY');
      };
    });
    expectCode(await bob.cmd_({ type: 'vote', card: '3' }), 'internal_error');
    await patch(id, (o) => {
      o['transact'] = o['__real']!;
    });
    expect(fac.state!.participants[1]!.hasVoted).toBe(false);
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    await fac.waitForState((s) => s.participants[1]!.hasVoted);
  });
});

describe('D3: work is serialized in arrival order across storage retries', () => {
  const failTransactions = (id: string, times: number, skip = 0) =>
    patch(id, (o) => {
      const real = o['transact']!;
      let calls = 0;
      let failures = 0;
      o['transact'] = function (this: unknown, ...args: unknown[]) {
        if (calls++ >= skip && failures < times) {
          failures++;
          throw new Error('database is locked: SQLITE_BUSY');
        }
        return real.apply(this, args);
      };
    });

  it('a vote that hits SQLITE_BUSY is not overtaken by a withdraw sent right after it', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    // Skip the vote's housekeeping tick, fail its own commit once: without a queue the withdraw overtakes it.
    await failTransactions(id, 1, 1);
    const from = bob.messages.length;
    bob.send({ type: 'vote', id: 'v1', card: '5' });
    bob.send({ type: 'vote', id: 'v2', card: null });
    await bob.waitFor((m) => m.type === 'ack' && m.id === 'v2', from, 5000);
    const acks = bob.messages.slice(from).filter((m) => m.type === 'ack');
    expect(acks.map((m) => (m.type === 'ack' ? m.id : ''))).toEqual(['v1', 'v2']);
    const versions = acks.map((m) => (m.type === 'ack' ? m.version : 0));
    expect(versions[1]!).toBeGreaterThan(versions[0]!);
    expect(bob.state!.myVote).toBeNull();
    await fac.waitForState((s) => !s.participants[1]!.hasVoted);
    expect(bob.messages.filter((m) => m.type === 'error')).toEqual([]);
  });

  it('an alarm firing during a command retry runs after that command', async () => {
    const { id } = await setup();
    const bob = await Client.join(id, 'Bob');
    await patch(id, (o) => {
      const order: string[] = [];
      o['__order'] = order as unknown as () => unknown;
      for (const name of ['execute', 'onAlarm']) {
        const real = o[name]!;
        o[name] = function (this: unknown, ...args: unknown[]) {
          order.push(name);
          return real.apply(this, args);
        };
      }
    });
    await failTransactions(id, 4);
    bob.send({ type: 'vote', id: 'v1', card: '5' });
    await sleep(30); // the vote is now waiting between retries
    const ran = await runDurableObjectAlarm(getRoomStub(env, id));
    expect(ran).toBe(true);
    await bob.waitFor((m) => m.type === 'ack' && m.id === 'v1', 0, 5000);
    const order = await patch(id, (o) => [...(o['__order'] as unknown as string[])]);
    expect(order.indexOf('execute')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('onAlarm')).toBeGreaterThan(order.indexOf('execute'));
  });

  it('a failing task does not break the queue', async () => {
    const { id, fac } = await setup();
    await failTransactions(id, 100); // every attempt fails: exhausted retries -> internal_error
    expectCode(await fac.cmd_({ type: 'set_topic', topic: 'a' }), 'internal_error');
    await patch(id, (o) => {
      o['transact'] = Object.getPrototypeOf(o)['transact'];
    });
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'b' }));
    expect(fac.state!.topic).toBe('b');
  });
});

describe('D3 stress: concurrent joins, votes and closes on one room', () => {
  it('no internal_error under load', async () => {
    for (let round = 0; round < 4; round++) {
      const { id, fac } = await setup();
      const clients = await Promise.all(Array.from({ length: 20 }, () => Client.connect(id)));
      clients.forEach((c, i) => c.send({ type: 'join', name: `P${i}`, role: 'voter' }));
      await Promise.all(
        clients.map((c) => c.waitFor((m) => m.type === 'state' || m.type === 'error')),
      );
      await Promise.all(clients.map((c, i) => c.cmd_({ type: 'vote', card: i % 2 ? '3' : '5' })));
      clients.slice(0, 10).forEach((c) => c.close());
      await Promise.all(clients.slice(10).map((c) => c.cmd_({ type: 'vote', card: null })));
      await fac.cmd_({ type: 'reveal' });
      for (const c of [fac, ...clients]) {
        expect(c.messages.filter((m) => m.type === 'error' && m.code === 'internal_error')).toEqual(
          [],
        );
      }
    }
  }, 60_000);
});
