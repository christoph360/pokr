import { Injectable } from '@angular/core';
import * as v from 'valibot';
import {
  API_PATHS,
  CreateRoomResponseSchema,
  ErrorResponseSchema,
  RoomInfoResponseSchema,
} from '@pokr/shared';
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  RoomInfoResponse,
} from '@pokr/shared';

export type CreateRoomResult =
  | { ok: true; data: CreateRoomResponse }
  | { ok: false; code: ErrorCode | 'network'; field?: string; retryAfterMs?: number };

export type RoomInfoResult =
  { kind: 'ok'; info: RoomInfoResponse } | { kind: 'not_found' } | { kind: 'error' };

/** HTTP side of the contract (POST /api/rooms, GET /api/rooms/:id). */
@Injectable({ providedIn: 'root' })
export class RoomApi {
  async createRoom(request: CreateRoomRequest): Promise<CreateRoomResult> {
    let res: Response;
    try {
      res = await fetch(API_PATHS.createRoom, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      return { ok: false, code: 'network' };
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 201) {
      const parsed = v.safeParse(CreateRoomResponseSchema, body);
      if (parsed.success) return { ok: true, data: parsed.output };
      return { ok: false, code: 'internal_error' };
    }
    const err = v.safeParse(ErrorResponseSchema, body);
    if (!err.success) return { ok: false, code: 'internal_error' };
    const { code, field, retryAfterMs } = err.output.error;
    return {
      ok: false,
      code,
      ...(field !== undefined ? { field } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  async roomInfo(roomId: string): Promise<RoomInfoResult> {
    try {
      const res = await fetch(API_PATHS.roomInfo(roomId));
      if (res.status === 404) return { kind: 'not_found' };
      if (!res.ok) return { kind: 'error' };
      const parsed = v.safeParse(RoomInfoResponseSchema, await res.json());
      return parsed.success ? { kind: 'ok', info: parsed.output } : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }
}
