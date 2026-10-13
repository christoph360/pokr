import type { RoomDurableObject } from './room';

type RoomNamespace = DurableObjectNamespace<RoomDurableObject>;
type RoomBinding = { ROOM: RoomNamespace };

let warned = false;

/**
 * The EU sub-namespace (ADR 0002). The local runtime (workerd: `wrangler dev`, vitest) does not
 * implement jurisdictions and throws a specific error; only that error falls back to the bare
 * namespace, so local development works. Cloudflare's production runtime never throws it, and
 * any other failure propagates.
 */
function euNamespace(env: RoomBinding): RoomNamespace {
  try {
    return env.ROOM.jurisdiction('eu');
  } catch (err) {
    if (err instanceof Error && /not implemented in workerd/i.test(err.message)) {
      if (!warned) {
        warned = true;
        console.warn(JSON.stringify({ event: 'jurisdiction_unsupported_locally' }));
      }
      return env.ROOM;
    }
    throw err;
  }
}

/**
 * The ONLY way to reach a room Durable Object (F01-AC31, ADR 0002). The same name yields a
 * different ID without a jurisdiction, so no other code may call `idFromName` / `newUniqueId` /
 * `get` on `env.ROOM`.
 */
export function getRoomId(env: RoomBinding, normalizedRoomId: string): DurableObjectId {
  return euNamespace(env).idFromName(normalizedRoomId);
}

export function getRoomStub(
  env: RoomBinding,
  normalizedRoomId: string,
): DurableObjectStub<RoomDurableObject> {
  const ns = euNamespace(env);
  return ns.get(ns.idFromName(normalizedRoomId));
}
