import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isVoter } from '@pokr/shared';
import type { RoomState } from '@pokr/shared';
import { MotionPreference } from '../core/motion';
import type { Extreme } from '../core/room-logic';
import { STRINGS } from '../i18n/strings';

interface Row {
  id: string;
  name: string;
  role: 'voter' | 'observer';
  online: boolean;
  isYou: boolean;
  isFacilitator: boolean;
  left: boolean;
  /** Has a vote cell (voters only). */
  showVote: boolean;
  hasVoted: boolean;
  /** Revealed card, if any. */
  card: string | null;
  extreme: Extreme | null;
}

/**
 * Participant list (F01-AC8, AC9, AC12, AC15, AC18, AC21, AC23, AC24). Names arrive from the
 * server with their "(2)" suffix already applied and are rendered as they are.
 */
@Component({
  selector: 'app-participant-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="participants"
      [attr.data-expanded]="expanded()"
      aria-labelledby="participants-heading"
    >
      <h3 id="participants-heading" class="participants__heading">{{ t.participants.heading }}</h3>
      <button
        type="button"
        class="btn btn--small participants__toggle"
        data-testid="participants-toggle"
        aria-controls="participant-list"
        [attr.aria-expanded]="expanded()"
        (click)="expanded.set(!expanded())"
      >
        {{ t.participants.toggle(rows().length) }}
      </button>
      <ul
        id="participant-list"
        class="participants__list"
        data-testid="participant-list"
        [attr.aria-label]="t.participants.heading"
      >
        @for (row of rows(); track row.id) {
          <li
            class="participant"
            data-testid="participant-row"
            [attr.data-participant-id]="row.id"
            [attr.data-role]="row.role"
            [attr.data-online]="row.online"
            [attr.data-voted]="row.hasVoted"
            [attr.data-you]="row.isYou"
            [attr.data-left]="row.left ? 'true' : null"
            [attr.data-facilitator]="row.isFacilitator"
            [attr.data-extreme]="row.extreme"
          >
            <span
              class="presence"
              [class.presence--online]="row.online"
              [attr.title]="row.online ? t.participants.online : t.participants.offline"
            >
              <span aria-hidden="true">{{ row.online ? '●' : '○' }}</span>
              <span class="visually-hidden">{{
                row.online ? t.participants.online : t.participants.offline
              }}</span>
            </span>
            <span class="participant__main">
              <span class="participant__name" data-testid="participant-name">{{ row.name }}</span>
              @if (row.isYou) {
                <span class="muted" data-testid="participant-you"> {{ t.room.youMarker }}</span>
              }
              <span class="participant__tags">
                @if (row.isFacilitator) {
                  <span class="badge" data-testid="participant-facilitator">{{
                    t.participants.facilitator
                  }}</span>
                }
                @if (row.role === 'observer') {
                  <span class="badge badge--muted">{{ t.participants.observer }}</span>
                }
                @if (row.left) {
                  <span class="badge badge--muted" data-testid="participant-left">{{
                    t.participants.left
                  }}</span>
                }
                @if (row.extreme) {
                  <span class="badge badge--extreme" data-testid="participant-extreme">
                    <span aria-hidden="true">{{ row.extreme === 'lowest' ? '▼' : '▲' }} </span
                    >{{ row.extreme === 'lowest' ? t.participants.lowest : t.participants.highest }}
                  </span>
                }
              </span>
            </span>
            @if (row.showVote) {
              @if (revealed()) {
                <span
                  class="vote-tile"
                  data-testid="participant-vote"
                  [attr.data-animated]="animated()"
                  [attr.data-empty]="row.card === null ? 'true' : null"
                >
                  @if (row.card !== null) {
                    <span [attr.aria-label]="t.participants.revealedCardLabel(row.card)">{{
                      row.card
                    }}</span>
                  } @else {
                    <span class="muted">{{ t.participants.noVote }}</span>
                  }
                </span>
              } @else {
                <span
                  class="vote-status"
                  data-testid="participant-vote"
                  [attr.data-state]="row.hasVoted ? 'voted' : 'waiting'"
                >
                  <span aria-hidden="true">{{ row.hasVoted ? '✓' : '…' }}</span>
                  {{ row.hasVoted ? t.participants.voted : t.participants.notVoted }}
                </span>
              }
            }
            @if (canManage() && !row.isYou && !row.left) {
              <span class="participant__actions">
                <button
                  type="button"
                  class="btn btn--small"
                  [attr.data-testid]="'handover-' + row.id"
                  [attr.aria-disabled]="row.online ? null : 'true'"
                  [attr.title]="row.online ? null : t.participants.offlineCannotHandOver"
                  [attr.aria-label]="t.participants.makeFacilitatorFor(row.name)"
                  (click)="row.online && handOver.emit(row.id)"
                >
                  {{ t.participants.makeFacilitator }}
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--danger"
                  [attr.data-testid]="'remove-' + row.id"
                  [attr.aria-label]="t.participants.removeFor(row.name)"
                  (click)="remove.emit(row.id)"
                >
                  {{ t.participants.remove }}
                </button>
              </span>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class ParticipantList {
  protected readonly t = STRINGS;
  private readonly motion = inject(MotionPreference);

  readonly state = input.required<RoomState>();
  readonly extremes = input<ReadonlyMap<string, Extreme>>(new Map());
  readonly canManage = input(false);
  readonly handOver = output<string>();
  readonly remove = output<string>();

  /** Collapsed by default on small screens; CSS keeps the list open on wide screens. */
  protected readonly expanded = signal(false);
  protected readonly revealed = computed(() => this.state().round.phase === 'revealed');
  protected readonly animated = computed(() => !this.motion.reduced());

  protected readonly rows = computed<Row[]>(() => {
    const s = this.state();
    const cards = new Map<string, string>();
    if (s.round.phase === 'revealed')
      for (const vote of s.round.votes) cards.set(vote.participantId, vote.card);
    const extremes = this.extremes();
    const rows: Row[] = s.participants.map((p) => {
      const card = cards.get(p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        online: p.online,
        isYou: p.id === s.selfId,
        isFacilitator: p.id === s.facilitatorId,
        left: false,
        showVote: isVoter(p, s.facilitatorId, s.settings) || card !== null,
        hasVoted: p.hasVoted || card !== null,
        card,
        extreme: extremes.get(p.id) ?? null,
      };
    });
    if (s.round.phase === 'revealed') {
      for (const gone of s.round.left) {
        const card = cards.get(gone.participantId) ?? null;
        rows.push({
          id: gone.participantId,
          name: gone.name,
          role: 'voter',
          online: false,
          isYou: false,
          isFacilitator: false,
          left: true,
          showVote: true,
          hasVoted: card !== null,
          card,
          extreme: extremes.get(gone.participantId) ?? null,
        });
      }
    }
    return rows;
  });
}
