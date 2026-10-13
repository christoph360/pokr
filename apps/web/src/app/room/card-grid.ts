import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { cardSlug } from '@pokr/shared';
import { cardName } from '../core/room-logic';
import { STRINGS } from '../i18n/strings';

/**
 * The voting cards (F01-AC9, AC10, AC33). Each card is a toggle button (`aria-pressed`) that works
 * with Space and Enter; arrow keys move focus between cards. A card shows as selected only when
 * `myVote` (server state) says so; `pendingCard` marks the click that is waiting for its ack.
 */
@Component({
  selector: 'app-card-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="card-grid"
      role="group"
      data-testid="card-grid"
      [attr.aria-label]="t.room.cards"
      [attr.aria-busy]="pendingCard() !== null ? 'true' : null"
      (keydown)="onKeydown($event)"
    >
      @for (card of cards(); track card) {
        <button
          type="button"
          class="card"
          [class.card--selected]="card === myVote()"
          [attr.data-testid]="'card-' + slug(card)"
          [attr.aria-pressed]="card === myVote() ? 'true' : 'false'"
          [attr.aria-disabled]="disabled() ? 'true' : null"
          [attr.aria-label]="label(card)"
          [attr.data-pending]="card === pendingCard() ? 'true' : null"
          (click)="onClick(card)"
        >
          <span class="card__face">{{ card }}</span>
          @if (card === myVote()) {
            <span class="card__mark" aria-hidden="true">✓</span>
          }
          @if (card === pendingCard()) {
            <span class="card__pending" aria-hidden="true">…</span>
          }
        </button>
      }
    </div>
  `,
})
export class CardGrid {
  protected readonly t = STRINGS;
  readonly cards = input.required<readonly string[]>();
  readonly myVote = input<string | null>(null);
  readonly pendingCard = input<string | null>(null);
  /** Disabled after reveal and while disconnected; focus stays reachable (aria-disabled). */
  readonly disabled = input(false);
  readonly picked = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected slug(card: string): string {
    return cardSlug(card);
  }

  protected label(card: string): string | null {
    const name = cardName(card);
    return name === card ? null : name;
  }

  protected onClick(card: string): void {
    if (this.disabled()) return;
    this.picked.emit(card);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button.card'),
    );
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index < 0) return;
    const last = buttons.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowDown: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key] ?? index;
    event.preventDefault();
    buttons[next]?.focus();
  }
}
