import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { normalizeRoomId } from '@pokr/shared';
import { RoomApi } from '../core/room-api';
import { RoomConnection } from '../core/room-connection';
import { TokenStore } from '../core/token-store';
import { STRINGS } from '../i18n/strings';
import { JoinForm } from './join-form';
import type { JoinRequest } from './join-form';
import { NoticePage } from './notice-page';
import { RoomView } from './room-view';

type Phase = 'checking' | 'not-found' | 'full' | 'join' | 'room';

/** Route `/r/:roomId`: decides between join form, notices and the live room (F01-AC4 to AC7, AC23, AC29). */
@Component({
  selector: 'app-room-page',
  imports: [JoinForm, NoticePage, RoomView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (view()) {
      @case ('not-found') {
        <app-notice-page kind="not-found" />
      }
      @case ('full') {
        <app-notice-page kind="full" />
      }
      @case ('removed') {
        <app-notice-page kind="removed" (rejoin)="restart()" />
      }
      @case ('join') {
        <app-join-form [roomName]="roomName()" (joined)="join($event)" />
      }
      @case ('room') {
        <div
          class="connection"
          data-testid="connection-indicator"
          role="status"
          aria-live="polite"
          [attr.data-state]="conn.indicator()"
        >
          @if (conn.indicator() === 'reconnecting') {
            <span class="spinner" aria-hidden="true"></span>{{ t.connection.reconnecting }}
          }
        </div>
        <div
          class="visually-hidden"
          role="status"
          aria-live="polite"
          data-testid="connection-announcer"
        >
          {{ conn.restored() ? t.connection.restored : '' }}
        </div>
        @if (conn.state(); as s) {
          <app-room-view [state]="s" />
        } @else {
          <p class="panel panel--narrow" role="status" data-testid="room-loading">
            {{ t.room.loading }}
          </p>
        }
      }
      @default {
        <p class="panel panel--narrow" role="status">{{ t.room.loading }}</p>
      }
    }
  `,
})
export class RoomPage {
  protected readonly t = STRINGS;
  protected readonly conn = inject(RoomConnection);
  private readonly api = inject(RoomApi);
  private readonly tokens = inject(TokenStore);
  private readonly title = inject(Title);

  readonly roomId = input.required<string>();

  private readonly phase = signal<Phase>('checking');
  protected readonly roomName = signal('');
  private canonicalId: string | null = null;

  protected view(): Phase | 'removed' {
    const terminal = this.conn.terminal();
    if (terminal === 'removed') return 'removed';
    if (terminal === 'room_not_found') return 'not-found';
    if (terminal === 'room_full') return 'full';
    if (terminal === 'invalid_token') return 'checking';
    return this.phase();
  }

  constructor() {
    effect(() => {
      const raw = this.roomId();
      untracked(() => void this.start(raw));
    });

    // A rejected token (purged or removed) means a fresh join with the name prompt (F01-AC5).
    effect(() => {
      if (this.conn.terminal() === 'invalid_token') untracked(() => this.restart());
    });

    effect(() => {
      const s = this.conn.state();
      this.title.setTitle(s ? `${s.settings.name} - ${STRINGS.appName}` : STRINGS.appName);
    });

    inject(DestroyRef).onDestroy(() => {
      this.conn.close();
      this.title.setTitle(STRINGS.appName);
    });
  }

  protected restart(): void {
    this.conn.close();
    void this.start(this.roomId());
  }

  private async start(raw: string): Promise<void> {
    this.conn.close();
    const id = normalizeRoomId(raw);
    this.canonicalId = id;
    if (id === null) {
      this.phase.set('not-found');
      return;
    }
    if (this.tokens.get(id)) {
      this.phase.set('room');
      this.conn.open(id, { kind: 'rejoin' });
      return;
    }
    this.phase.set('checking');
    const info = await this.api.roomInfo(id);
    if (this.canonicalId !== id) return;
    if (info.kind === 'not_found') this.phase.set('not-found');
    else if (info.kind === 'ok' && info.info.full) this.phase.set('full');
    else {
      this.roomName.set(info.kind === 'ok' ? info.info.name : '');
      this.phase.set('join');
    }
  }

  protected join(request: JoinRequest): void {
    if (this.canonicalId === null) return;
    this.phase.set('room');
    this.conn.open(this.canonicalId, { kind: 'join', name: request.name, role: request.role });
  }
}
