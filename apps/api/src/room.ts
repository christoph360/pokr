import { DurableObject } from 'cloudflare:workers';

/**
 * Placeholder for the per-room Durable Object (ADR 0001: WebSockets + Hibernation API).
 * Obtain stubs only through env.ROOM.jurisdiction("eu") (ADR 0002).
 */
export class RoomDurableObject extends DurableObject<Env> {
  override fetch(_request: Request): Response {
    return new Response('Not implemented', { status: 501 });
  }
}
