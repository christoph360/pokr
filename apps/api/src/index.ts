import { Hono } from 'hono';

export { RoomDurableObject } from './room';

const app = new Hono<{ Bindings: Env }>();

// Placeholder route; backend-dev owns real routes.
app.get('/api/health', (c) => c.json({ ok: true }));

export default app;
