import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { cardSlug } from '@pokr/shared';
import type { Summary } from '@pokr/shared';
import { STRINGS } from '../i18n/strings';

/** Round summary after reveal (F01-AC15). Numbers come from `computeSummary`; this only renders. */
@Component({
  selector: 'app-summary-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel summary" data-testid="summary" aria-labelledby="summary-heading">
      <h3 id="summary-heading">{{ t.summary.heading }}</h3>
      @if (summary().totalVotes === 0) {
        <p data-testid="summary-no-votes">{{ t.summary.noVotes }}</p>
      } @else {
        <ul class="distribution" [attr.aria-label]="t.summary.distribution">
          @for (item of summary().distribution; track item.card) {
            <li
              [attr.data-testid]="'summary-distribution-' + slug(item.card)"
              [attr.data-count]="item.count"
            >
              <span class="distribution__card">{{ item.card }}</span>
              <span class="distribution__count">{{ t.summary.votes(item.count) }}</span>
            </li>
          }
        </ul>
        <dl class="stats">
          @if (summary().average !== null) {
            <div>
              <dt>{{ t.summary.average }}</dt>
              <dd data-testid="summary-average">{{ summary().average }}</dd>
            </div>
          }
          @if (summary().median !== null) {
            <div>
              <dt>{{ t.summary.median }}</dt>
              <dd data-testid="summary-median">{{ summary().median }}</dd>
            </div>
          }
          @if (summary().lowest; as low) {
            <div>
              <dt>{{ t.summary.lowest }}</dt>
              <dd data-testid="summary-lowest">{{ low.card }}</dd>
            </div>
          }
          @if (summary().highest; as high) {
            <div>
              <dt>{{ t.summary.highest }}</dt>
              <dd data-testid="summary-highest">{{ high.card }}</dd>
            </div>
          }
        </dl>
        @if (summary().consensus) {
          <p class="badge badge--consensus" data-testid="summary-consensus">
            <span aria-hidden="true">✓ </span>{{ t.summary.consensus }}
          </p>
        }
      }
    </section>
  `,
})
export class SummaryPanel {
  protected readonly t = STRINGS;
  readonly summary = input.required<Summary>();

  protected slug(card: string): string {
    return cardSlug(card);
  }
}
