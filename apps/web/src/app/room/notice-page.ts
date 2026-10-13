import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STRINGS } from '../i18n/strings';

export type NoticeKind = 'not-found' | 'full' | 'removed';

/** Full-page states: room not found (AC6), room full (AC7), removed (AC23). */
@Component({
  selector: 'app-notice-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (kind()) {
      @case ('not-found') {
        <section
          class="panel panel--narrow"
          data-testid="room-not-found"
          aria-labelledby="notice-heading"
        >
          <h2 id="notice-heading" tabindex="-1">{{ t.notFound.heading }}</h2>
          <p>{{ t.notFound.body }}</p>
          <a routerLink="/" class="btn btn--primary" data-testid="room-not-found-create">{{
            t.notFound.create
          }}</a>
        </section>
      }
      @case ('full') {
        <section
          class="panel panel--narrow"
          data-testid="room-full"
          aria-labelledby="notice-heading"
        >
          <h2 id="notice-heading" tabindex="-1">{{ t.full.heading }}</h2>
          <p>{{ t.full.body }}</p>
          <a routerLink="/" class="btn btn--primary" data-testid="room-full-create">{{
            t.full.create
          }}</a>
        </section>
      }
      @case ('removed') {
        <section
          class="panel panel--narrow"
          data-testid="removed-notice"
          role="alert"
          aria-labelledby="notice-heading"
        >
          <h2 id="notice-heading" tabindex="-1">{{ t.removed.heading }}</h2>
          <p>{{ t.removed.body }}</p>
          <button
            type="button"
            class="btn btn--primary"
            data-testid="removed-rejoin"
            (click)="rejoin.emit()"
          >
            {{ t.removed.rejoin }}
          </button>
        </section>
      }
    }
  `,
})
export class NoticePage {
  protected readonly t = STRINGS;
  readonly kind = input.required<NoticeKind>();
  readonly rejoin = output<void>();
}
