import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  RoomInfoResponse,
  TestEvictRequest,
  TestSeedStoriesRequest,
  TestSeedStoriesResponse,
  TestStorageResponse,
  TestTimersRequest,
} from '@pokr/shared';
import { API_URL, CLIENT_KEY_HEADER } from '../helpers/env';

/** HTTP client for the API (direct to wrangler dev), with a rate-limit client key. */
export class ApiClient {
  constructor(
    readonly request: APIRequestContext,
    readonly clientKey: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { [CLIENT_KEY_HEADER]: this.clientKey, ...extra };
  }

  async createRoomRaw(body: unknown, headers?: Record<string, string>): Promise<APIResponse> {
    return this.request.post(`${API_URL}/api/rooms`, {
      data: body,
      headers: this.headers(headers),
    });
  }

  async createRoom(body: CreateRoomRequest): Promise<CreateRoomResponse> {
    const res = await this.createRoomRaw(body);
    expect(res.status(), `create room: ${await res.text()}`).toBe(201);
    return (await res.json()) as CreateRoomResponse;
  }

  async roomInfoRaw(roomId: string): Promise<APIResponse> {
    return this.request.get(`${API_URL}/api/rooms/${roomId}`, { headers: this.headers() });
  }

  async roomInfo(roomId: string): Promise<RoomInfoResponse> {
    const res = await this.roomInfoRaw(roomId);
    expect(res.status()).toBe(200);
    return (await res.json()) as RoomInfoResponse;
  }

  async setTimers(roomId: string, timers: TestTimersRequest): Promise<void> {
    const res = await this.request.post(`${API_URL}/api/__test/rooms/${roomId}/timers`, {
      data: timers,
      headers: this.headers(),
    });
    expect(res.status(), 'test hook /timers').toBe(204);
  }

  async evict(roomId: string, mode: TestEvictRequest['mode']): Promise<string> {
    const res = await this.request.post(`${API_URL}/api/__test/rooms/${roomId}/evict`, {
      data: { mode },
      headers: this.headers(),
    });
    expect(res.status(), 'test hook /evict').toBe(200);
    return ((await res.json()) as { previousInstanceId: string }).previousInstanceId;
  }

  async instanceId(roomId: string): Promise<string> {
    const res = await this.request.get(`${API_URL}/api/__test/rooms/${roomId}/instance`, {
      headers: this.headers(),
    });
    expect(res.status(), 'test hook /instance').toBe(200);
    return ((await res.json()) as { instanceId: string }).instanceId;
  }

  /** H1/H4: seed stories (test mode). Returns the status so cap tests can assert the 409. */
  async seedStoriesRaw(roomId: string, body: TestSeedStoriesRequest): Promise<APIResponse> {
    return this.request.post(`${API_URL}/api/__test/rooms/${roomId}/stories`, {
      data: body,
      headers: this.headers(),
    });
  }

  async seedStories(
    roomId: string,
    body: TestSeedStoriesRequest,
  ): Promise<TestSeedStoriesResponse> {
    const res = await this.seedStoriesRaw(roomId, body);
    expect(res.status(), `seed stories: ${await res.text()}`).toBe(201);
    return (await res.json()) as TestSeedStoriesResponse;
  }

  /** H2: what the room persists. */
  async storage(roomId: string): Promise<TestStorageResponse> {
    const res = await this.request.get(`${API_URL}/api/__test/rooms/${roomId}/storage`, {
      headers: this.headers(),
    });
    expect(res.status(), 'test hook /storage').toBe(200);
    return (await res.json()) as TestStorageResponse;
  }
}
