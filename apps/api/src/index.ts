import { Hono } from 'hono';
import type { Context } from 'hono';
import * as v from 'valibot';
import {
  CreateRoomRequestSchema,
  DEFAULT_SETTINGS,
  ERROR_HTTP_STATUS,
  MAX_MESSAGE_CHARS,
  RATE_LIMITS,
  TestEvictRequestSchema,
  TestTimersRequestSchema,
  applySettings,
  generateRoomId,
  normalizeRoomId,
} from '@pokr/shared';
import type { CreateRoomResponse, ErrorCode, RoomInfoResponse } from '@pokr/shared';
import { clientKey, isTestMode } from './env';
import type { AppEnv } from './env';
import { logError } from './log';
import { getRoomStub } from './room-stub';

export { RoomDurableObject } from './room';

type Ctx = Context<{ Bindings: AppEnv }>;

function errorResponse(
  c: Ctx,
  code: ErrorCode,
  extra: { message?: string; field?: string; retryAfterMs?: number } = {},
): Response {
  const headers: Record<string, string> = {};
  if (extra.retryAfterMs !== undefined)
    headers['Retry-After'] = String(Math.ceil(extra.retryAfterMs / 1000));
  return c.json({ error: { code, ...extra } }, ERROR_HTTP_STATUS[code] as 400, headers);
}

/** True if the request may proceed. Fails open (with a log line) if the binding itself errors. */
async function withinLimit(
  limiter: RateLimit | undefined,
  key: string,
  name: string,
): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (err) {
    logError(`rate_limit_unavailable_${name}`, err);
    return true;
  }
}

function rateLimited(c: Ctx, windowMs: number): Response {
  return errorResponse(c, 'rate_limited', { message: 'too many requests', retryAfterMs: windowMs });
}

const app = new Hono<{ Bindings: AppEnv }>();

app.get('/api/health', (c) => c.json({ ok: true }));

// POST /api/rooms: create (F01-AC1..3, AC37)
app.post('/api/rooms', async (c) => {
  if (
    !(await withinLimit(c.env.RATE_LIMIT_CREATE, clientKey(c.env, c.req.raw.headers), 'create'))
  ) {
    return rateLimited(c, RATE_LIMITS.roomCreate.windowMs);
  }
  const text = await c.req.text();
  if (text.length > MAX_MESSAGE_CHARS)
    return errorResponse(c, 'invalid_input', { message: 'body too large' });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse(c, 'invalid_input', { message: 'not valid JSON' });
  }
  const parsed = v.safeParse(CreateRoomRequestSchema, json);
  if (!parsed.success) {
    const issue = parsed.issues[0]!;
    const field = v.getDotPath(issue);
    return errorResponse(c, 'invalid_input', {
      message: issue.message.replace(/Received: .*$/s, '').trim(),
      ...(field ? { field } : {}),
    });
  }
  const settings = applySettings(DEFAULT_SETTINGS, parsed.output.settings);
  for (let attempt = 0; attempt < 3; attempt++) {
    const roomId = generateRoomId();
    const result = await getRoomStub(c.env, roomId).create({
      roomId,
      displayName: parsed.output.displayName,
      settings,
    });
    if (result.ok) {
      const body: CreateRoomResponse = {
        roomId,
        participantId: result.participantId,
        token: result.token,
      };
      return c.json(body, 201);
    }
  }
  return errorResponse(c, 'internal_error', { message: 'could not allocate a room' });
});

// GET /api/rooms/:roomId: existence + full check (F01-AC6, AC7). Not rate limited by the join binding (not a join).
app.get('/api/rooms/:roomId', async (c) => {
  const roomId = normalizeRoomId(c.req.param('roomId'));
  if (!roomId) return errorResponse(c, 'room_not_found');
  const info = await getRoomStub(c.env, roomId).info();
  if (!info) return errorResponse(c, 'room_not_found');
  const body: RoomInfoResponse = { roomId, name: info.name, full: info.full };
  return c.json(body);
});

// GET /api/rooms/:roomId/ws: WebSocket upgrade. The first frame must be join or rejoin.
app.get('/api/rooms/:roomId/ws', async (c) => {
  const roomId = normalizeRoomId(c.req.param('roomId'));
  if (!roomId) return errorResponse(c, 'room_not_found');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: { code: 'invalid_input', message: 'WebSocket upgrade required' } }, 426);
  }
  if (!(await withinLimit(c.env.RATE_LIMIT_JOIN, clientKey(c.env, c.req.raw.headers), 'join'))) {
    return rateLimited(c, RATE_LIMITS.join.windowMs);
  }
  return getRoomStub(c.env, roomId).fetch(c.req.raw);
});

// ---- Test-mode hooks: 404 unless POKR_TEST_MODE === "1" ----
// Mounted only at /api/__test: assets use `run_worker_first: ["/api/*"]`, so other paths hit the SPA.
const testApp = new Hono<{ Bindings: AppEnv }>();

testApp.post('/rooms/:roomId/timers', async (c) => {
  const roomId = normalizeRoomId(c.req.param('roomId'));
  if (!roomId) return errorResponse(c, 'room_not_found');
  const body = v.safeParse(TestTimersRequestSchema, await c.req.json().catch(() => null));
  if (!body.success) return errorResponse(c, 'invalid_input', { message: 'invalid timers' });
  const ok = await getRoomStub(c.env, roomId).testSetTimers(body.output);
  return ok ? c.body(null, 204) : errorResponse(c, 'room_not_found');
});

testApp.post('/rooms/:roomId/evict', async (c) => {
  const roomId = normalizeRoomId(c.req.param('roomId'));
  if (!roomId) return errorResponse(c, 'room_not_found');
  const body = v.safeParse(TestEvictRequestSchema, await c.req.json().catch(() => null));
  if (!body.success) return errorResponse(c, 'invalid_input', { message: 'invalid mode' });
  return c.json(await getRoomStub(c.env, roomId).testEvict(body.output.mode));
});

testApp.get('/rooms/:roomId/instance', async (c) => {
  const roomId = normalizeRoomId(c.req.param('roomId'));
  if (!roomId) return errorResponse(c, 'room_not_found');
  return c.json({ instanceId: await getRoomStub(c.env, roomId).testInstance() });
});

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!isTestMode(c.env)) return c.notFound();
  await next();
  return undefined;
};
app.use('/api/__test/*', guard);
app.route('/api/__test', testApp);

app.onError((err, c) => {
  logError('unhandled', err);
  return c.json({ error: { code: 'internal_error' } }, 500);
});

export default app;
