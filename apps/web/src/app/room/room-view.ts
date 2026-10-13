import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  DisplayNameSchema,
  TopicSchema,
  computeSummary,
  resolveDeck,
  roomPagePath,
} from '@pokr/shared';
import type { Role, RoomState } from '@pokr/shared';
import { CommandError, RoomConnection } from '../core/room-connection';
import type { CommandInput } from '../core/room-connection';
import {
  checkText,
  controlsFor,
  counterFor,
  extremesFor,
  hasUnrevealedVotes,
} from '../core/room-logic';
import { errorText, textValidator } from '../core/text-validator';
import { STRINGS } from '../i18n/strings';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ModalDialog } from '../ui/modal-dialog';
import { CardGrid } from './card-grid';
import { ParticipantList } from './participant-list';
import { SettingsDialog } from './settings-dialog';
import { SummaryPanel } from './summary-panel';

/** The room screen: header and share link, topic, cards, controls, summary and participants. */
@Component({
  selector: 'app-room-view',
  imports: [
    ReactiveFormsModule,
    CardGrid,
    ParticipantList,
    SummaryPanel,
    SettingsDialog,
    ConfirmDialog,
    ModalDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = state();
    @let c = controls();
    <div
      class="room"
      data-testid="room"
      [attr.data-state-version]="s.version"
      [attr.data-phase]="s.round.phase"
      [attr.data-round]="s.round.number"
      [attr.data-role]="c.self?.role"
      [attr.data-facilitator]="c.isFacilitator"
    >
      <header class="room__header">
        <div class="room__title-row">
          <h2 class="room__title" data-testid="room-name">{{ s.settings.name }}</h2>
          <span class="muted">{{ t.room.roundNumber(s.round.number) }}</span>
          @if (c.canManage) {
            <button
              type="button"
              class="btn btn--small"
              data-testid="settings-open"
              (click)="settingsOpen.set(true)"
            >
              {{ t.room.settings }}
            </button>
          }
        </div>
        <div class="share">
          <span id="room-url-label" class="visually-hidden">{{ t.room.linkLabel }}</span>
          <code #urlEl class="share__url" data-testid="room-url" aria-labelledby="room-url-label">{{
            url()
          }}</code>
          <button type="button" class="btn btn--small" data-testid="copy-link" (click)="copy()">
            {{ t.room.copy }}
          </button>
          <span
            class="share__feedback"
            data-testid="copy-feedback"
            role="status"
            aria-live="polite"
            >{{ copyFeedback() }}</span
          >
        </div>
      </header>

      <section class="topic" aria-labelledby="topic-heading">
        <h3 id="topic-heading" class="visually-hidden">{{ t.room.topic }}</h3>
        @if (s.topic) {
          <p class="topic__text" data-testid="topic-display">{{ s.topic }}</p>
        } @else {
          <p class="topic__text topic__text--empty" data-testid="topic-empty">
            {{ t.room.noTopic }}
          </p>
        }
        @if (c.canManage) {
          <form class="topic__form" (submit)="$event.preventDefault(); saveTopic()" novalidate>
            <label for="topic-input" class="visually-hidden">{{ t.room.topicInput }}</label>
            <input
              id="topic-input"
              data-testid="topic-input"
              type="text"
              autocomplete="off"
              [placeholder]="t.room.topicInput"
              [formControl]="topicCtl"
              [attr.aria-invalid]="topicCtl.invalid ? 'true' : null"
              [attr.aria-describedby]="topicCtl.invalid ? 'topic-error' : 'topic-hint'"
            />
            <button type="submit" class="btn btn--small" data-testid="topic-save">
              {{ t.room.topicSave }}
            </button>
            @if (topicCtl.invalid) {
              <p id="topic-error" class="error" data-testid="topic-error">{{ topicError() }}</p>
            } @else {
              <p id="topic-hint" class="hint">{{ t.room.topicHint }}</p>
            }
          </form>
        }
      </section>

      <div class="room__layout">
        <div class="room__main">
          <section aria-labelledby="vote-heading" class="vote">
            <h3 id="vote-heading" class="visually-hidden">{{ t.room.cards }}</h3>
            @if (c.canVote) {
              <app-card-grid
                [cards]="cards()"
                [myVote]="s.myVote"
                [pendingCard]="pendingCard()"
                [disabled]="cardsDisabled()"
                (picked)="onPick($event)"
              />
              @if (!conn.connected()) {
                <p class="hint" role="status" data-testid="cards-paused">
                  {{ t.room.cardsPaused }}
                </p>
              } @else if (s.round.phase === 'revealed') {
                <p class="hint" data-testid="cards-revealed">{{ t.room.cardsRevealed }}</p>
              }
            } @else if (c.self?.role === 'observer') {
              <p class="hint" data-testid="cards-none">{{ t.room.cardsObserver }}</p>
            } @else {
              <p class="hint" data-testid="cards-none">{{ t.room.cardsFacilitatorNoVote }}</p>
            }
          </section>

          <section class="controls" aria-label="Round controls">
            <p class="counter" data-testid="voted-count">{{ counterText() }}</p>
            @if (c.canRevealOrReset) {
              <button
                type="button"
                class="btn btn--primary"
                data-testid="reveal"
                [attr.aria-disabled]="s.round.phase === 'revealed' ? 'true' : null"
                (click)="reveal()"
              >
                {{ t.room.reveal }}
              </button>
              <button type="button" class="btn" data-testid="reset" (click)="onReset()">
                {{ t.room.reset }}
              </button>
            }
            @if (c.self) {
              <button type="button" class="btn" data-testid="role-switch" (click)="switchRole()">
                {{ c.self.role === 'voter' ? t.room.switchToObserver : t.room.switchToVoter }}
              </button>
              <button type="button" class="btn" data-testid="rename-open" (click)="openRename()">
                {{ t.room.rename }}
              </button>
            }
            @if (c.canClaim) {
              <button
                type="button"
                class="btn btn--primary"
                data-testid="claim-facilitator"
                (click)="claim()"
              >
                {{ t.room.claim }}
              </button>
            }
          </section>

          @if (failure()) {
            <p class="error" role="alert" data-testid="command-error">{{ failure() }}</p>
          }

          @if (summary(); as sum) {
            <app-summary-panel [summary]="sum" />
          }
          @if (!c.canManage) {
            <p class="hint" data-testid="settings-summary">
              {{
                t.settings.summaryLine(
                  t.decks[s.settings.deck.id],
                  t.controlModes[s.settings.controlMode]
                )
              }}
            </p>
          }
        </div>

        <aside class="room__side">
          <app-participant-list
            [state]="s"
            [extremes]="extremes()"
            [canManage]="c.canManage"
            (handOver)="handOver($event)"
            (remove)="remove($event)"
          />
        </aside>
      </div>

      <div class="visually-hidden" role="status" aria-live="polite" data-testid="reveal-announcer">
        {{ announcement() }}
      </div>

      @if (c.canManage) {
        <app-settings-dialog
          [state]="s"
          [open]="settingsOpen()"
          (closed)="settingsOpen.set(false)"
        />
      }

      <app-confirm-dialog
        [open]="resetConfirmOpen()"
        prefix="reset-confirm"
        [heading]="t.confirm.resetTitle"
        [message]="t.confirm.resetBody"
        [okLabel]="t.confirm.resetOk"
        [cancelLabel]="t.confirm.cancel"
        (confirmed)="confirmReset()"
        (cancelled)="resetConfirmOpen.set(false)"
      />

      <app-modal-dialog
        [open]="renameOpen()"
        [heading]="t.room.rename"
        testId="rename-dialog"
        titleId="rename-title"
        (dismissed)="renameOpen.set(false)"
      >
        <form class="form" (submit)="$event.preventDefault(); saveRename()" novalidate>
          <div class="field">
            <label for="rename-input">{{ t.room.renameLabel }}</label>
            <input
              id="rename-input"
              data-testid="rename-input"
              type="text"
              autocomplete="nickname"
              [formControl]="renameCtl"
              [attr.aria-invalid]="renameCtl.invalid ? 'true' : null"
              [attr.aria-describedby]="renameCtl.invalid ? 'rename-error' : null"
            />
            @if (renameCtl.invalid) {
              <p id="rename-error" class="error" data-testid="rename-error">{{ renameError() }}</p>
            }
          </div>
          <div class="actions">
            <button type="submit" class="btn btn--primary" data-testid="rename-save">
              {{ t.room.renameSave }}
            </button>
            <button
              type="button"
              class="btn"
              data-testid="rename-cancel"
              (click)="renameOpen.set(false)"
            >
              {{ t.room.cancel }}
            </button>
          </div>
        </form>
      </app-modal-dialog>
    </div>
  `,
})
export class RoomView {
  protected readonly t = STRINGS;
  protected readonly conn = inject(RoomConnection);
  private readonly doc = inject(DOCUMENT);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly state = input.required<RoomState>();

  private readonly urlEl = viewChild<ElementRef<HTMLElement>>('urlEl');

  protected readonly settingsOpen = signal(false);
  protected readonly renameOpen = signal(false);
  protected readonly resetConfirmOpen = signal(false);
  protected readonly pendingCard = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly copyFeedback = signal('');

  /** Bumped when the facilitator-claim threshold passes, so `controls` re-evaluates. */
  private readonly clockTick = signal(0);
  private voteSeq = 0;
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly topicCtl = this.fb.control('', textValidator(TopicSchema, 'topic'));
  protected readonly renameCtl = this.fb.control('', textValidator(DisplayNameSchema, 'name'));

  protected readonly controls = computed(() => {
    this.clockTick();
    return controlsFor(this.state(), this.conn.serverNow());
  });
  protected readonly cards = computed(() => resolveDeck(this.state().settings.deck));
  protected readonly cardsDisabled = computed(
    () => !this.conn.connected() || this.state().round.phase === 'revealed',
  );
  protected readonly summary = computed(() => {
    const round = this.state().round;
    return round.phase === 'revealed'
      ? computeSummary(this.state().settings.deck, round.votes)
      : null;
  });
  protected readonly extremes = computed(() => extremesFor(this.summary()));
  protected readonly counterText = computed(() => {
    const { voted, total } = counterFor(this.state());
    return this.t.room.voted(voted, total);
  });
  protected readonly announcement = computed(() => {
    const sum = this.summary();
    if (!sum) return '';
    return this.t.room.votesRevealedAnnouncement(
      this.t.summary.announcement({
        total: sum.totalVotes,
        average: sum.average,
        median: sum.median,
        consensus: sum.consensus,
      }),
    );
  });
  protected readonly url = computed(
    () => `${this.doc.location.origin}${roomPagePath(this.state().roomId)}`,
  );

  constructor() {
    // Keep the topic field in step with the room unless the facilitator is editing it.
    effect(() => {
      const topic = this.state().topic;
      if (this.topicCtl.pristine) this.topicCtl.setValue(topic, { emitEvent: false });
    });

    // Rate-limit and similar notices that did not answer a command.
    effect(() => {
      const notice = this.conn.notice();
      if (notice)
        this.failure.set(this.t.errors[notice.code] ?? this.t.errors['internal_error'] ?? null);
    });

    // Make the claim button appear the moment the server-computed threshold passes (F01-AC25).
    effect((onCleanup) => {
      const at = this.state().canClaimAt;
      if (at === null) return;
      const wait = at - this.conn.serverNow();
      if (wait <= 0) return;
      const id = setTimeout(() => this.clockTick.update((n) => n + 1), wait + 20);
      onCleanup(() => clearTimeout(id));
    });

    inject(DestroyRef).onDestroy(() => clearTimeout(this.copyTimer));
  }

  protected topicError(): string | null {
    return errorText(this.topicCtl);
  }

  protected renameError(): string | null {
    return errorText(this.renameCtl);
  }

  /** Run a command, surfacing the error text instead of throwing. */
  private async run(command: CommandInput): Promise<boolean> {
    try {
      await this.conn.send(command);
      this.failure.set(null);
      return true;
    } catch (error) {
      const code = error instanceof CommandError ? error.code : 'internal_error';
      this.failure.set(this.t.errors[code] ?? this.t.errors['internal_error'] ?? null);
      return false;
    }
  }

  protected async onPick(card: string): Promise<void> {
    const seq = ++this.voteSeq;
    this.pendingCard.set(card);
    await this.run({ type: 'vote', card: card === this.state().myVote ? null : card });
    if (seq === this.voteSeq) this.pendingCard.set(null);
  }

  protected reveal(): void {
    if (this.state().round.phase === 'revealed') return;
    void this.run({ type: 'reveal' });
  }

  protected onReset(): void {
    if (hasUnrevealedVotes(this.state())) this.resetConfirmOpen.set(true);
    else void this.doReset();
  }

  protected confirmReset(): void {
    this.resetConfirmOpen.set(false);
    void this.doReset();
  }

  private async doReset(): Promise<void> {
    // An edited, valid topic is applied together with the reset (F01-AC19).
    let topic: string | undefined;
    if (this.topicCtl.dirty) {
      const checked = checkText(TopicSchema, 'topic', this.topicCtl.value);
      if (checked.ok && checked.value !== this.state().topic) topic = checked.value;
    }
    const ok = await this.run(topic === undefined ? { type: 'reset' } : { type: 'reset', topic });
    if (ok && topic !== undefined) this.topicCtl.markAsPristine();
  }

  protected async saveTopic(): Promise<void> {
    const checked = checkText(TopicSchema, 'topic', this.topicCtl.value);
    if (!checked.ok) return;
    const ok = await this.run({ type: 'set_topic', topic: checked.value });
    if (ok) {
      this.topicCtl.markAsPristine();
      this.topicCtl.setValue(checked.value, { emitEvent: false });
    }
  }

  protected switchRole(): void {
    const role: Role = this.controls().self?.role === 'voter' ? 'observer' : 'voter';
    void this.run({ type: 'set_role', role });
  }

  protected openRename(): void {
    this.renameCtl.setValue(this.controls().self?.name ?? '');
    this.renameCtl.markAsPristine();
    this.renameOpen.set(true);
  }

  protected async saveRename(): Promise<void> {
    const checked = checkText(DisplayNameSchema, 'name', this.renameCtl.value);
    if (!checked.ok) {
      this.renameCtl.markAsTouched();
      return;
    }
    if (await this.run({ type: 'rename', name: checked.value })) this.renameOpen.set(false);
  }

  protected claim(): void {
    void this.run({ type: 'claim_facilitator' });
  }

  protected handOver(participantId: string): void {
    void this.run({ type: 'hand_over', participantId });
  }

  protected remove(participantId: string): void {
    void this.run({ type: 'remove_participant', participantId });
  }

  protected async copy(): Promise<void> {
    clearTimeout(this.copyTimer);
    try {
      await navigator.clipboard.writeText(this.url());
      this.copyFeedback.set(this.t.room.copied);
    } catch {
      this.copyFeedback.set(this.t.room.copyFailed);
      const el = this.urlEl()?.nativeElement;
      const selection = this.doc.defaultView?.getSelection();
      if (el && selection) selection.selectAllChildren(el);
    }
    this.copyTimer = setTimeout(() => this.copyFeedback.set(''), 6000);
  }
}
