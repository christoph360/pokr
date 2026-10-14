import type { ElementRef } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { composeActiveStory, nextStoryId } from '@pokr/shared';
import type { HeldAgenda, RoomState } from '@pokr/shared';
import { MarkdownRenderer, safeHttpUrl } from '../core/markdown';
import { StoryActions } from '../core/story-actions';
import { STRINGS } from '../i18n/strings';
import { MarkdownNodes } from './markdown-nodes';

/** More lines than this, or this many characters, and the description starts collapsed. */
const COLLAPSE_LINES = 8;
const COLLAPSE_CHARS = 600;

/**
 * The story being voted on, above the cards (F02-AC1, AC7, AC8, AC9, AC13): title, link,
 * sanitized Markdown description with "Show more", and the facilitator's Next / Skip controls.
 * In Story list mode with no active story it explains that nothing is selected (idle).
 */
@Component({
  selector: 'app-active-story',
  imports: [MarkdownNodes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="active-story" aria-labelledby="active-story-heading">
      <h3 id="active-story-heading" class="visually-hidden">{{ t.activeHeading }}</h3>
      @if (active(); as story) {
        <div data-testid="active-story" [attr.data-story-id]="story.id">
          <p class="topic__text" data-testid="active-story-title">{{ story.title }}</p>
          @if (safeLink(); as href) {
            <p class="active-story__link">
              <a
                [href]="href"
                target="_blank"
                rel="noopener noreferrer nofollow"
                data-testid="active-story-link"
                >{{ story.link }}<span class="visually-hidden"> {{ t.opensInNewTab }}</span></a
              >
            </p>
          }
          @if (nodes().length > 0) {
            <div
              id="active-story-description"
              class="markdown"
              data-testid="active-story-description"
              [class.markdown--collapsed]="!expanded() && collapsible()"
              #description
            >
              <app-markdown-nodes [nodes]="nodes()" />
            </div>
            @if (collapsible()) {
              <button
                type="button"
                class="btn btn--small"
                data-testid="story-description-toggle"
                aria-controls="active-story-description"
                [attr.aria-expanded]="expanded()"
                (click)="expanded.set(!expanded())"
              >
                {{ expanded() ? t.showLess : t.showMore }}
              </button>
            }
          }
        </div>
      } @else if (waiting()) {
        <div data-testid="no-active-story">
          <p class="topic__text">{{ t.noActive }}</p>
          <p class="hint">{{ idleHint() }}</p>
        </div>
      }
      @if (canManage()) {
        <div class="story-controls">
          <button
            type="button"
            class="btn"
            data-testid="next-story"
            [attr.aria-disabled]="nextId() === null || !connected() ? 'true' : null"
            [attr.aria-describedby]="nextId() === null ? 'next-story-hint' : null"
            (click)="next()"
          >
            {{ t.next }}
          </button>
          @if (active(); as story) {
            @if (story.status === 'pending') {
              <button
                type="button"
                class="btn"
                data-testid="active-skip"
                [attr.aria-disabled]="!connected() ? 'true' : null"
                (click)="skip(false)"
              >
                {{ t.activeSkip }}
              </button>
              <button
                type="button"
                class="btn"
                data-testid="story-skip-next"
                [attr.aria-disabled]="!connected() ? 'true' : null"
                (click)="skip(true)"
              >
                {{ t.activeSkipNext }}
              </button>
            }
          }
          @if (nextId() === null) {
            <p id="next-story-hint" class="hint" data-testid="next-story-hint">
              {{ rows().length === 0 ? t.nextEmpty : t.nextNone }}
            </p>
          }
        </div>
      }
    </section>
  `,
})
export class ActiveStory {
  protected readonly t = STRINGS.stories;
  readonly state = input.required<RoomState>();
  readonly agenda = input.required<HeldAgenda | null>();
  readonly canManage = input(false);
  readonly connected = input(true);

  private readonly actions = inject(StoryActions);
  private readonly markdown = inject(MarkdownRenderer);
  private readonly descriptionEl = viewChild<ElementRef<HTMLElement>>('description');

  /** Collapsed again whenever another story becomes active. */
  protected readonly expanded = linkedSignal<string | null, boolean>({
    source: () => this.state().stories.activeId,
    computation: () => false,
  });
  private readonly overflowing = signal(false);

  protected readonly rows = computed(() => this.agenda()?.rows ?? []);
  protected readonly active = computed(() =>
    composeActiveStory(this.agenda(), this.state().stories.activeId),
  );
  /** Story list mode with nothing to show: idle (or the active row has not arrived yet). */
  protected readonly waiting = computed(() => this.state().stories.activeId === null);
  protected readonly nodes = computed(() => this.markdown.render(this.active()?.description ?? ''));
  protected readonly safeLink = computed(() => {
    const link = this.active()?.link;
    return link ? safeHttpUrl(link) : null;
  });
  protected readonly nextId = computed(() =>
    nextStoryId(this.rows(), this.state().stories.activeId),
  );
  protected readonly collapsible = computed(() => {
    const text = this.active()?.description ?? '';
    return (
      this.overflowing() || text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES
    );
  });
  protected readonly idleHint = computed(() => {
    if (this.rows().length === 0) return this.t.noActiveNoStories;
    return this.canManage() ? this.t.noActiveFacilitator : this.t.noActiveOthers;
  });

  constructor() {
    // The CSS clamp is about 8 lines; when the rendered text is taller, offer the toggle too.
    afterRenderEffect(() => {
      this.nodes();
      const el = this.descriptionEl()?.nativeElement;
      if (el && !this.expanded()) this.overflowing.set(el.scrollHeight > el.clientHeight + 2);
    });
  }

  protected next(): void {
    if (this.nextId() === null || !this.connected()) return;
    this.actions.next();
  }

  protected skip(advance: boolean): void {
    const story = this.active();
    if (story && this.connected()) this.actions.skip(story, advance);
  }
}
