/**
 * Concurrency stress for the room Durable Object (F01 retro; use before every DO handoff and for the
 * SQLite-contention check on staging).
 *
 * Creates ROOMS rooms, joins CLIENTS participants per room at the same time, then every participant
 * fires VOTES votes back to back. Passes only if: no `internal_error` (the local `SQLITE_BUSY` of
 * D3), every command is answered exactly once and in send order (no command overtakes another),
 * snapshot versions never go backwards, all connections of a room converge on the same version and
 * participant list, and the revealed round holds exactly the last card of every voter.
 *
 * Usage (Node >= 24; no dependencies, no build):
 *
 *   cd apps/api && pnpm exec wrangler dev --port 8787 --var POKR_TEST_MODE:1   # terminal 1; test mode lifts the per-IP limits
 *   pnpm --filter @pokr/api stress                                              # terminal 2; defaults below
 *   pnpm --filter @pokr/api stress -- --rooms 5 --clients 30 --votes 15
 *   pnpm --filter @pokr/api stress -- --url https://staging.example --rooms 1   # staging: needs POKR_TEST_MODE too
 *
 * Scenarios (--scenario all|votes|stories, default all): `votes` is the burst above; `stories` (F02) runs
 * per room two facilitator tabs with the same token plus voters: concurrent add_story from both tabs,
 * then concurrent move, select, next, reveal and accept while the voters vote. Races such as
 * stale_round or confirmation_required are legitimate answers; internal_error, out-of-order answers,
 * an agenda frame that would need a resync, and tabs that end with different agendas are failures.
 *
 * Options: --url (default http://localhost:8787), --rooms (3), --clients per room incl. the
 * facilitator (20, max 50), --votes per client (10, max 18: the per-connection limit is 20
 * messages per 10 s), --timeout ms per wait (10000). Exit code 0 = pass, 1 = fail.
 * Stop the dev server when done. The script creates rooms; it never deletes them (they expire).
 */
import type { ClientMessage, RoomState, ServerMessage } from '@pokr/shared';

type AgendaRow = NonNullable<RoomState['stories']['agenda']>['rows'][number];

// Node provides these; the Workers typings used by this package do not.
declare const process: { argv: string[]; exit(code: number): never };

interface Options {
  url: string;
  rooms: number;
  clients: number;
  votes: number;
  timeout: number;
  scenario: 'all' | 'votes' | 'stories';
}

function scenario(value: string | undefined): Options['scenario'] {
  if (value === undefined || value === 'all') return 'all';
  if (value === 'votes' || value === 'stories') return value;
  return fail('--scenario must be all, votes or stories');
}

function parseOptions(argv: string[]): Options {
  const raw = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (!arg.startsWith('--') || argv[i + 1] === undefined) fail(`bad argument: ${arg}`);
    raw.set(arg.slice(2), argv[++i]!);
  }
  const num = (name: string, def: number, max: number) => {
    const n = raw.has(name) ? Number(raw.get(name)) : def;
    if (!Number.isInteger(n) || n < 1 || n > max) fail(`--${name} must be an integer 1..${max}`);
    return n;
  };
  for (const key of raw.keys()) {
    if (!['url', 'rooms', 'clients', 'votes', 'timeout', 'scenario'].includes(key))
      fail(`unknown option --${key}`);
  }
  return {
    url: (raw.get('url') ?? 'http://localhost:8787').replace(/\/$/, ''),
    rooms: num('rooms', 3, 50),
    clients: num('clients', 20, 50),
    votes: num('votes', 10, 18),
    timeout: num('timeout', 10_000, 120_000),
    scenario: scenario(raw.get('scenario')),
  };
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const opts = parseOptions(process.argv.slice(2));
const problems: string[] = [];
const problem = (text: string) => {
  if (problems.length < 30) problems.push(text);
};
const runId = Math.random().toString(36).slice(2, 8);
let keySeq = 0;
/** Unique rate-limit key per request/connection (test mode only). */
const freshKey = () => `stress-${runId}-${keySeq++}`;

const CARDS = ['1', '2', '3', '5', '8'];
const latencies: number[] = [];
const errorCodes = new Map<string, number>();

class Conn {
  state: RoomState | null = null;
  participantId = '';
  token = '';
  lastVote: string | null = null;
  /** Error codes that are a legitimate answer in the current phase (races between commands). */
  allowed = new Set<string>();
  /** Agenda as the client rule keeps it (see mergeAgenda in @pokr/shared). */
  held: { version: number; rows: AgendaRow[] } | null = null;
  readonly acks: string[] = [];
  private readonly pending = new Map<string, { sentAt: number; resolve: () => void }>();
  private readonly sendOrder: string[] = [];
  private seq = 0;
  private lastVersion = 0;
  private waiters: (() => void)[] = [];

  readonly label: string;
  readonly ws: WebSocket;

  private constructor(label: string, ws: WebSocket) {
    this.label = label;
    this.ws = ws;
    ws.addEventListener('message', (e) => this.onFrame(String(e.data)));
  }

  static async open(label: string, roomId: string): Promise<Conn> {
    // Node's (undici) WebSocket accepts a headers option; the Workers typings do not know it.
    const Ctor = WebSocket as unknown as new (
      url: string,
      init: { headers: Record<string, string> },
    ) => WebSocket;
    const ws = new Ctor(`${opts.url.replace(/^http/, 'ws')}/api/rooms/${roomId}/ws`, {
      headers: { 'x-pokr-test-client-key': freshKey() },
    });
    const conn = new Conn(label, ws);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(`${label}: websocket error`)));
    });
    return conn;
  }

  private onFrame(raw: string): void {
    const msg = JSON.parse(raw) as ServerMessage;
    switch (msg.type) {
      case 'joined':
        this.participantId = msg.participantId;
        if (msg.token) this.token = msg.token;
        break;
      case 'state':
        if (msg.state.version < this.lastVersion) {
          problem(
            `${this.label}: version went backwards ${this.lastVersion} -> ${msg.state.version}`,
          );
        }
        this.lastVersion = Math.max(this.lastVersion, msg.state.version);
        this.state = msg.state;
        this.trackAgenda(msg.state);
        break;
      case 'ack':
      case 'error':
        if (msg.type === 'error') {
          errorCodes.set(msg.code, (errorCodes.get(msg.code) ?? 0) + 1);
          if (msg.code !== 'rate_limited' && msg.id === undefined)
            problem(`${this.label}: ${msg.code}`);
        }
        if (msg.id !== undefined) this.answer(msg.id, msg.type === 'error' ? msg.code : null);
        break;
      default:
        break;
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  private answer(id: string, errorCode: string | null): void {
    const entry = this.pending.get(id);
    if (!entry) {
      problem(`${this.label}: duplicate or unknown answer for ${id}`);
      return;
    }
    this.pending.delete(id);
    latencies.push(Date.now() - entry.sentAt);
    const expected = this.sendOrder.shift();
    if (expected !== id) problem(`${this.label}: answer for ${id} overtook ${expected}`);
    if (errorCode === 'internal_error') problem(`${this.label}: internal_error answering ${id}`);
    else if (errorCode !== null && errorCode !== 'rate_limited' && !this.allowed.has(errorCode)) {
      problem(`${this.label}: unexpected ${errorCode} answering ${id}`);
    }
    entry.resolve();
  }

  private trackAgenda(state: RoomState): void {
    const st = state.stories;
    if (st.agenda) this.held = { version: st.agendaVersion, rows: st.agenda.rows };
    else if (!this.held || this.held.version !== st.agendaVersion) {
      problem(
        `${this.label}: state without agenda for version ${st.agendaVersion} (held ${this.held?.version})`,
      );
    } else if (st.agendaVersion < this.held.version) {
      problem(`${this.label}: agendaVersion went backwards`);
    }
  }

  /** Send without waiting; the returned promise settles when the command is answered. */
  command(msg: Record<string, unknown>): Promise<void> {
    const id = `${this.label}-${++this.seq}`;
    return new Promise<void>((resolve) => {
      this.pending.set(id, { sentAt: Date.now(), resolve });
      this.sendOrder.push(id);
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(pred: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + opts.timeout;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`${this.label}: timeout waiting for ${what}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

async function createRoom(
  settings: Record<string, unknown> = {},
): Promise<{ roomId: string; token: string }> {
  const res = await fetch(`${opts.url}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pokr-test-client-key': freshKey() },
    body: JSON.stringify({ displayName: 'Facilitator', settings }),
  });
  if (res.status !== 201) {
    throw new Error(
      `create room failed: ${res.status} (is the server in test mode? POKR_TEST_MODE:1)`,
    );
  }
  const body = (await res.json()) as { roomId: string; token: string };
  return body;
}

async function runRoom(index: number): Promise<void> {
  const { roomId, token } = await createRoom();
  const label = (n: number) => `r${index}c${n}`;

  // Everyone connects and joins at the same time.
  const conns = await Promise.all(
    Array.from({ length: opts.clients }, async (_, n) => {
      const conn = await Conn.open(label(n), roomId);
      if (n === 0) conn.send({ type: 'rejoin', token });
      else conn.send({ type: 'join', name: `Voter ${n}`, role: 'voter' });
      await conn.waitFor(() => conn.state !== null, 'first state');
      return conn;
    }),
  );

  // Vote burst: each client sends all its votes without waiting for answers.
  await Promise.all(
    conns.map(async (conn, n) => {
      const answers: Promise<void>[] = [];
      for (let k = 0; k < opts.votes; k++) {
        const card = CARDS[(n + k) % CARDS.length]!;
        conn.lastVote = card;
        answers.push(conn.command({ type: 'vote', card }));
      }
      await Promise.all(answers);
    }),
  );

  // Convergence: all connections reach the same version, the votes are in.
  const facilitator = conns[0]!;
  await facilitator.waitFor(
    () => facilitator.state?.participants.every((p) => p.hasVoted) === true,
    'all votes visible',
  );
  await facilitator.command({ type: 'reveal' });
  await Promise.all(
    conns.map((c) => c.waitFor(() => c.state?.round.phase === 'revealed', 'revealed round')),
  );
  const finalVersion = facilitator.state!.version;
  await Promise.all(
    conns.map((c) => c.waitFor(() => c.state!.version === finalVersion, 'same version')),
  );

  const expectedVotes = new Map(conns.map((c) => [c.participantId, c.lastVote]));
  for (const c of conns) {
    const s = c.state!;
    if (s.participants.length !== opts.clients) {
      problem(`${c.label}: sees ${s.participants.length} participants, expected ${opts.clients}`);
    }
    if (s.round.phase !== 'revealed') continue;
    const got = new Map(s.round.votes.map((v) => [v.participantId, v.card]));
    for (const [pid, card] of expectedVotes) {
      if (got.get(pid) !== card)
        problem(`${c.label}: vote of ${pid} is ${got.get(pid)}, expected ${card}`);
    }
  }
  conns.forEach((c) => c.close());
}

/** Races between concurrent story commands are legitimate answers, internal_error never is. */
const STORY_RACE_CODES = [
  'stale_round',
  'confirmation_required',
  'no_next_story',
  'round_not_revealed',
  'invalid_story_state',
  'no_active_story',
  'unknown_story',
  'round_revealed',
];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

/**
 * Story list scenario (F02): two facilitator tabs (same token) and voters. Concurrent adds, then
 * concurrent moves, select, Next, reveal and accept from both tabs while the voters vote. Checks
 * the same properties as the vote burst plus: agenda frames stay in sync (the client rule never
 * needs a resync), all connections end with the same agenda, story ids are unique, and the
 * progress counter matches the rows.
 */
async function runStoryRoom(index: number): Promise<void> {
  const { roomId, token } = await createRoom({ storySource: 'stories' });
  const label = (n: string) => `s${index}${n}`;
  const open = async (name: string, join: boolean) => {
    const conn = await Conn.open(label(name), roomId);
    conn.allowed = new Set(STORY_RACE_CODES);
    if (join) conn.send({ type: 'join', name: `Voter ${name}`, role: 'voter' });
    else conn.send({ type: 'rejoin', token });
    await conn.waitFor(() => conn.state !== null && conn.held !== null, 'first state');
    return conn;
  };
  const tabA = await open('A', false);
  const tabB = await open('B', false);
  const voters = await Promise.all(
    Array.from({ length: Math.max(1, opts.clients - 2) }, (_, n) => open(`v${n}`, true)),
  );
  const tabs = [tabA, tabB];
  const adds = Math.min(8, Math.floor(opts.votes));

  // 1. Both tabs add at the same time.
  await Promise.all(
    tabs.flatMap((tab, t) =>
      Array.from({ length: adds }, (_, k) =>
        tab.command({ type: 'add_story', title: `Story ${t}-${k}` }),
      ),
    ),
  );
  await tabA.waitFor(() => tabA.held!.rows.length === adds * 2, 'all stories added');

  // 2. Moves, select, Next, reveal and accept from both tabs, while voters vote.
  const ids = tabA.held!.rows.map((r) => r.id);
  await tabA.command({ type: 'select_story', storyId: ids[0]! }); // a round to vote in
  const work: Promise<void>[] = [];
  for (const tab of tabs) {
    for (let k = 0; k < 5; k++) {
      work.push(
        tab.command({ type: 'move_story', storyId: pick(ids), beforeId: pick([...ids, null]) }),
      );
    }
    const round = () => tab.state!.round.number;
    work.push(tab.command({ type: 'select_story', storyId: pick(ids), confirmReset: true }));
    work.push(tab.command({ type: 'next_story', round: round(), confirmReset: true }));
    work.push(tab.command({ type: 'reveal' }));
    work.push(
      tab.command({
        type: 'accept_estimate',
        storyId: tab.state!.stories.activeId ?? ids[0]!,
        round: round(),
        estimate: pick(CARDS),
      }),
    );
  }
  for (const voter of voters) {
    for (let k = 0; k < Math.min(opts.votes, 6); k++) {
      work.push(voter.command({ type: 'vote', card: CARDS[k % CARDS.length]! }));
    }
  }
  await Promise.all(work);

  // 3. Everyone converges on one version and one agenda.
  const everyone = [...tabs, ...voters];
  const target = Math.max(...everyone.map((c) => c.state!.version));
  await Promise.all(
    everyone.map((c) => c.waitFor(() => c.state!.version === target, 'same version')),
  );
  const fingerprint = (c: Conn) =>
    JSON.stringify([c.held!.version, c.held!.rows, c.state!.stories.activeId]);
  const expected = fingerprint(tabA);
  for (const c of everyone) {
    if (fingerprint(c) !== expected) problem(`${c.label}: agenda differs from tab A`);
  }
  const rows = tabA.held!.rows;
  if (new Set(rows.map((r) => r.id)).size !== rows.length) problem('duplicate story ids');
  if (rows.length !== adds * 2) problem(`expected ${adds * 2} stories, found ${rows.length}`);
  const estimated = rows.filter((r) => r.estimate !== null).length;
  if (tabA.state!.stories.progress.estimated !== estimated)
    problem('progress does not match the rows');
  everyone.forEach((c) => c.close());
}

function percentile(sorted: number[], p: number): number {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

const started = Date.now();
console.log(
  `stress: ${opts.rooms} rooms x ${opts.clients} clients x ${opts.votes} votes against ${opts.url}`,
);
const scenarios: Promise<void>[] = [];
for (let i = 0; i < opts.rooms; i++) {
  if (opts.scenario !== 'stories') scenarios.push(runRoom(i));
  if (opts.scenario !== 'votes') scenarios.push(runStoryRoom(i));
}
const results = await Promise.allSettled(scenarios);
for (const r of results) {
  if (r.status === 'rejected')
    problem(String(r.reason instanceof Error ? r.reason.message : r.reason));
}
const sorted = [...latencies].sort((a, b) => a - b);
console.log(
  `${sorted.length} commands answered in ${Date.now() - started} ms; latency p50 ${percentile(sorted, 0.5)} ms, p95 ${percentile(sorted, 0.95)} ms, max ${sorted.at(-1) ?? 0} ms`,
);
if (errorCodes.size > 0) {
  console.log(`error answers: ${[...errorCodes].map(([c, n]) => `${c}=${n}`).join(', ')}`);
}
if (problems.length > 0) {
  console.error(`FAIL (${problems.length}${problems.length >= 30 ? '+' : ''} problems):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('PASS');
process.exit(0);
