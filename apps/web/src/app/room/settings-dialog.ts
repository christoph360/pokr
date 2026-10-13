import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RoomNameSchema, decksEqual } from '@pokr/shared';
import type {
  ControlMode,
  Deck,
  DeckId,
  RoomSettings,
  RoomSettingsInput,
  RoomState,
} from '@pokr/shared';
import { CommandError, RoomConnection } from '../core/room-connection';
import { DECK_OPTIONS, checkText, parseCustomDeck, roundHasVotes } from '../core/room-logic';
import { errorText, textValidator } from '../core/text-validator';
import { STRINGS } from '../i18n/strings';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { ModalDialog } from '../ui/modal-dialog';

const sameSettings = (a: RoomSettings, b: RoomSettings) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Facilitator settings (F01-AC27, AC28). Every control applies on change; a deck change that would
 * discard votes goes through the confirmation dialog, whether the client or the server asks for it.
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [ReactiveFormsModule, ModalDialog, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal-dialog
      [open]="open() && !pendingDeck()"
      [heading]="t.settings.heading"
      testId="settings-dialog"
      titleId="settings-title"
      (dismissed)="closed.emit()"
    >
      <div class="form">
        <div class="field">
          <label for="setting-room-name">{{ t.settings.roomName }}</label>
          <input
            id="setting-room-name"
            data-testid="setting-room-name"
            type="text"
            [formControl]="nameCtl"
            [attr.aria-invalid]="nameCtl.invalid ? 'true' : null"
            [attr.aria-describedby]="nameCtl.invalid ? 'setting-room-name-error' : null"
            (change)="applyName()"
          />
          @if (nameCtl.invalid) {
            <p id="setting-room-name-error" class="error" data-testid="setting-room-name-error">
              {{ nameError() }}
            </p>
          }
        </div>

        <div class="field">
          <label for="setting-deck">{{ t.settings.deck }}</label>
          <select
            id="setting-deck"
            data-testid="setting-deck"
            [formControl]="deckCtl"
            (change)="onDeckChange()"
          >
            @for (id of decks; track id) {
              <option [value]="id">{{ t.decks[id] }}</option>
            }
          </select>
        </div>

        @if (deckChoice() === 'custom') {
          <div class="field">
            <label for="setting-custom-deck">{{ t.settings.customDeck }}</label>
            <input
              id="setting-custom-deck"
              data-testid="setting-custom-deck"
              type="text"
              autocomplete="off"
              [formControl]="customCtl"
              [attr.aria-invalid]="customError() ? 'true' : null"
              [attr.aria-describedby]="
                customError() ? 'setting-custom-deck-error' : 'setting-custom-deck-hint'
              "
            />
            <p id="setting-custom-deck-hint" class="hint">{{ t.start.customDeckHint }}</p>
            @if (customError()) {
              <p
                id="setting-custom-deck-error"
                class="error"
                data-testid="setting-custom-deck-error"
              >
                {{ customError() }}
              </p>
            }
            <button
              type="button"
              class="btn btn--small"
              data-testid="setting-custom-deck-apply"
              (click)="applyCustom()"
            >
              {{ t.settings.customApply }}
            </button>
          </div>
        }

        <div class="field">
          <label for="setting-control-mode">{{ t.settings.controlMode }}</label>
          <select
            id="setting-control-mode"
            data-testid="setting-control-mode"
            [formControl]="modeCtl"
            (change)="applyMode()"
          >
            @for (mode of modes; track mode) {
              <option [value]="mode">{{ t.controlModes[mode] }}</option>
            }
          </select>
        </div>

        <div class="field field--check">
          <input
            id="setting-auto-reveal"
            data-testid="setting-auto-reveal"
            type="checkbox"
            [formControl]="autoRevealCtl"
            (change)="applyAutoReveal()"
          />
          <label for="setting-auto-reveal">{{ t.settings.autoReveal }}</label>
        </div>
        <div class="field field--check">
          <input
            id="setting-facilitator-votes"
            data-testid="setting-facilitator-votes"
            type="checkbox"
            [formControl]="facVotesCtl"
            (change)="applyFacilitatorVotes()"
          />
          <label for="setting-facilitator-votes">{{ t.settings.facilitatorVotes }}</label>
        </div>

        @if (failure()) {
          <p class="error" role="alert" data-testid="settings-error">{{ failure() }}</p>
        }

        <div class="actions">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="settings-close"
            (click)="closed.emit()"
          >
            {{ t.room.close }}
          </button>
        </div>
      </div>
    </app-modal-dialog>

    <app-confirm-dialog
      [open]="open() && !!pendingDeck()"
      prefix="deck-confirm"
      [heading]="t.confirm.deckTitle"
      [message]="t.confirm.deckBody"
      [okLabel]="t.confirm.deckOk"
      [cancelLabel]="t.confirm.cancel"
      (confirmed)="confirmDeck()"
      (cancelled)="cancelDeck()"
    />
  `,
})
export class SettingsDialog {
  protected readonly t = STRINGS;
  protected readonly decks = DECK_OPTIONS;
  protected readonly modes: readonly ControlMode[] = ['facilitator', 'everyone'];

  readonly state = input.required<RoomState>();
  readonly open = input.required<boolean>();
  readonly closed = output<void>();

  private readonly conn = inject(RoomConnection);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly nameCtl = this.fb.control('', textValidator(RoomNameSchema, 'roomName'));
  protected readonly deckCtl = this.fb.control<DeckId>('fibonacci');
  protected readonly customCtl = this.fb.control('');
  protected readonly modeCtl = this.fb.control<ControlMode>('facilitator');
  protected readonly autoRevealCtl = this.fb.control(false);
  protected readonly facVotesCtl = this.fb.control(true);

  protected readonly deckChoice = signal<DeckId>('fibonacci');
  protected readonly customError = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  /** A deck change waiting for the user's confirmation. */
  protected readonly pendingDeck = signal<Deck | null>(null);

  private readonly settings = computed(() => this.state().settings, { equal: sameSettings });

  constructor() {
    effect(() => {
      const s = this.settings();
      this.syncFrom(s);
    });
  }

  protected nameError(): string | null {
    return errorText(this.nameCtl);
  }

  private syncFrom(s: RoomSettings): void {
    this.nameCtl.setValue(s.name, { emitEvent: false });
    this.deckCtl.setValue(s.deck.id, { emitEvent: false });
    this.deckChoice.set(s.deck.id);
    this.customCtl.setValue(s.deck.id === 'custom' ? s.deck.cards.join(', ') : '', {
      emitEvent: false,
    });
    this.customError.set(null);
    this.modeCtl.setValue(s.controlMode, { emitEvent: false });
    this.autoRevealCtl.setValue(s.autoReveal, { emitEvent: false });
    this.facVotesCtl.setValue(s.facilitatorVotes, { emitEvent: false });
  }

  protected applyName(): void {
    const checked = checkText(RoomNameSchema, 'roomName', this.nameCtl.value);
    if (!checked.ok) return;
    if (checked.value !== this.settings().name) void this.apply({ name: checked.value });
    else this.nameCtl.setValue(checked.value, { emitEvent: false });
  }

  protected onDeckChange(): void {
    const id = this.deckCtl.value;
    this.deckChoice.set(id);
    this.customError.set(null);
    if (id === 'custom') return;
    this.requestDeck({ id });
  }

  protected applyCustom(): void {
    const parsed = parseCustomDeck(this.customCtl.value);
    if (!parsed.ok) {
      this.customError.set(parsed.message);
      return;
    }
    this.customError.set(null);
    this.requestDeck(parsed.deck);
  }

  private requestDeck(deck: Deck): void {
    if (decksEqual(deck, this.settings().deck)) return;
    if (roundHasVotes(this.state())) {
      this.pendingDeck.set(deck);
      return;
    }
    void this.apply({ deck });
  }

  protected confirmDeck(): void {
    const deck = this.pendingDeck();
    this.pendingDeck.set(null);
    if (deck) void this.apply({ deck }, true);
  }

  protected cancelDeck(): void {
    this.pendingDeck.set(null);
    this.syncFrom(this.settings());
  }

  protected applyMode(): void {
    void this.apply({ controlMode: this.modeCtl.value });
  }

  protected applyAutoReveal(): void {
    void this.apply({ autoReveal: this.autoRevealCtl.value });
  }

  protected applyFacilitatorVotes(): void {
    void this.apply({ facilitatorVotes: this.facVotesCtl.value });
  }

  private async apply(settings: RoomSettingsInput, confirmReset = false): Promise<void> {
    this.failure.set(null);
    try {
      await this.conn.send({ type: 'update_settings', settings, confirmReset });
    } catch (error) {
      const code = error instanceof CommandError ? error.code : 'internal_error';
      if (code === 'confirmation_required' && settings.deck) {
        // The server saw votes the client did not know about yet (race): ask now.
        this.pendingDeck.set(settings.deck);
        return;
      }
      this.failure.set(this.t.errors[code] ?? this.t.errors['internal_error'] ?? null);
      this.syncFrom(this.settings());
    }
  }
}
