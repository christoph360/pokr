import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { cardSlug } from '@pokr/shared';
import type { AgendaStory, RoomState } from '@pokr/shared';
import { cardName } from '../core/room-logic';
import { StoryActions } from '../core/story-actions';
import { acceptChoices } from '../core/story-logic';
import { STRINGS } from '../i18n/strings';
import { ModalDialog } from '../ui/modal-dialog';

/**
 * Final estimate (F02-AC10, AC11), facilitator only, after reveal. A dialog with the quick picks
 * (consensus, median; shown once when they agree) and every value card of the deck, never `?` or
 * the coffee card. Accepting again in the same round overwrites the estimate.
 */
@Component({
  selector: 'app-estimate-picker',
  imports: [ModalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="estimate" aria-labelledby="estimate-heading" data-testid="estimate">
      <h3 id="estimate-heading" class="estimate__heading">{{ t.acceptHeading }}</h3>
      @if (acceptedValue(); as value) {
        <p class="estimate__value" data-testid="accepted-estimate">{{ t.acceptedValue(value) }}</p>
      }
      <button
        type="button"
        class="btn btn--primary"
        data-testid="accept-open"
        [attr.aria-disabled]="!connected() ? 'true' : null"
        (click)="openPicker()"
      >
        {{ acceptedValue() ? t.acceptChange : t.acceptOpen }}
      </button>
    </section>

    <app-modal-dialog
      [open]="open()"
      [heading]="t.acceptDialog"
      testId="accept-dialog"
      titleId="accept-title"
      (dismissed)="open.set(false)"
    >
      <form class="form" (submit)="$event.preventDefault(); confirm()" novalidate>
        <p class="hint">{{ t.acceptHelp }}</p>
        @if (choices().quick.length > 0) {
          <div role="group" class="field" [attr.aria-label]="t.quickPicks">
            <div class="estimate__cards">
              @for (pick of choices().quick; track pick.card) {
                <button
                  type="button"
                  class="btn estimate__card"
                  [attr.data-testid]="
                    pick.kind === 'median' ? 'quickpick-median' : 'quickpick-consensus'
                  "
                  [attr.data-card]="pick.card"
                  [attr.data-kind]="pick.kind"
                  [attr.aria-pressed]="chosen() === pick.card ? 'true' : 'false'"
                  (click)="choose(pick.card)"
                >
                  {{ pick.label }}
                </button>
              }
            </div>
          </div>
        }
        <div role="group" class="field" [attr.aria-label]="t.allCards">
          <div class="estimate__cards">
            @for (card of choices().cards; track card) {
              <button
                type="button"
                class="btn estimate__card"
                [attr.data-testid]="'accept-card-' + slug(card)"
                [attr.aria-pressed]="chosen() === card ? 'true' : 'false'"
                [attr.aria-label]="cardLabel(card)"
                (click)="choose(card)"
              >
                {{ card }}
              </button>
            }
          </div>
        </div>
        @if (failure()) {
          <p class="error" role="alert" data-testid="accept-error">{{ failure() }}</p>
        }
        <div class="actions">
          <button
            type="submit"
            class="btn btn--primary"
            data-testid="accept-confirm"
            [attr.aria-disabled]="chosen() === null || busy() ? 'true' : null"
          >
            {{ chosen() === null ? t.acceptConfirm : t.acceptConfirmValue(chosen()!) }}
          </button>
          <button type="button" class="btn" data-testid="accept-cancel" (click)="open.set(false)">
            {{ t.cancel }}
          </button>
        </div>
      </form>
    </app-modal-dialog>
  `,
})
export class EstimatePicker {
  protected readonly t = STRINGS.stories;
  readonly state = input.required<RoomState>();
  /** The active story's row, to show the accepted value. */
  readonly story = input.required<AgendaStory | null>();
  readonly connected = input(true);

  private readonly actions = inject(StoryActions);

  protected readonly open = signal(false);
  protected readonly chosen = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly choices = computed(() => {
    const round = this.state().round;
    return acceptChoices(this.state().settings.deck, round.phase === 'revealed' ? round.votes : []);
  });
  /** The estimate accepted in this very round, if any (re-voting keeps an older one in the agenda). */
  protected readonly acceptedValue = computed(() => {
    const s = this.state();
    return s.stories.acceptedRound === s.round.number ? (this.story()?.estimate ?? null) : null;
  });

  protected slug(card: string): string {
    return cardSlug(card);
  }

  protected cardLabel(card: string): string {
    return this.t.acceptCardLabel(cardName(card));
  }

  protected openPicker(): void {
    if (!this.connected()) return;
    this.chosen.set(null);
    this.failure.set(null);
    this.open.set(true);
  }

  protected choose(card: string): void {
    this.chosen.set(card);
    this.failure.set(null);
  }

  protected async confirm(): Promise<void> {
    const card = this.chosen();
    const story = this.story();
    if (this.busy() || !story) return;
    if (card === null) {
      this.failure.set(this.t.acceptNothingChosen);
      return;
    }
    this.busy.set(true);
    const result = await this.actions.accept(story.id, card);
    this.busy.set(false);
    if (result.ok) {
      this.open.set(false);
      return;
    }
    this.failure.set(STRINGS.errors[result.code] ?? STRINGS.errors['internal_error'] ?? null);
  }
}
