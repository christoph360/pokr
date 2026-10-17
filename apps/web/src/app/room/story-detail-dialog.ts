import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { AgendaStory, StoryDetail } from '@pokr/shared';
import { MarkdownRenderer, safeHttpUrl } from '../core/markdown';
import { RoomConnection } from '../core/room-connection';
import { STRINGS } from '../i18n/strings';
import { ModalDialog } from '../ui/modal-dialog';
import { MarkdownNodes } from './markdown-nodes';

/**
 * "Last round" and details of one story (F02-AC11), loaded on demand with `get_story`. Open to
 * everyone. A vote whose participant was removed shows "Removed participant".
 */
@Component({
  selector: 'app-story-detail-dialog',
  imports: [ModalDialog, MarkdownNodes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal-dialog
      [open]="story() !== null"
      [heading]="heading()"
      testId="story-history"
      titleId="story-history-title"
      (dismissed)="closed.emit()"
    >
      @if (failed()) {
        <p class="error" role="alert" data-testid="story-history-error">{{ t.historyFailed }}</p>
      } @else if (detail(); as d) {
        @if (safeLink(); as href) {
          <p class="story-link" data-testid="story-history-link">
            <a [href]="href" target="_blank" rel="noopener noreferrer nofollow"
              >{{ d.link }}<span class="visually-hidden"> {{ t.opensInNewTab }}</span></a
            >
          </p>
        }
        <h3 class="modal__sub">{{ t.descriptionHeading }}</h3>
        @if (nodes().length > 0) {
          <div class="markdown" data-testid="story-history-description">
            <app-markdown-nodes [nodes]="nodes()" />
          </div>
        } @else {
          <p class="muted">{{ t.noDescription }}</p>
        }
        @if (d.finalRound; as round) {
          <h3 class="modal__sub">{{ t.history }}</h3>
          @if (d.estimate !== null) {
            <p data-testid="story-history-estimate">{{ t.historyEstimate(d.estimate) }}</p>
          }
          @if (round.votes.length === 0) {
            <p class="muted" data-testid="story-history-empty">{{ t.historyNoVotes }}</p>
          } @else {
            <ul
              class="history-votes"
              [attr.aria-label]="t.historyVotes"
              data-testid="story-history-votes"
            >
              @for (vote of round.votes; track vote.participantId) {
                <li data-testid="story-history-vote">
                  <span class="history-votes__name">{{ vote.name ?? t.removedParticipant }}</span>
                  <span class="vote-tile">{{ vote.card }}</span>
                </li>
              }
            </ul>
          }
        }
      } @else {
        <p role="status" class="muted" data-testid="story-history-loading">
          {{ t.historyLoading }}
        </p>
      }
      <div class="actions">
        <button type="button" class="btn" data-testid="story-history-close" (click)="closed.emit()">
          {{ t.close }}
        </button>
      </div>
    </app-modal-dialog>
  `,
})
export class StoryDetailDialog {
  protected readonly t = STRINGS.stories;
  /** The story to show; null keeps the dialog closed. */
  readonly story = input<AgendaStory | null>(null);
  readonly closed = output<void>();

  private readonly conn = inject(RoomConnection);
  private readonly markdown = inject(MarkdownRenderer);

  protected readonly detail = signal<StoryDetail | null>(null);
  protected readonly failed = signal(false);

  protected readonly heading = computed(() => {
    const s = this.story();
    if (!s) return '';
    return s.status === 'estimated'
      ? this.t.historyHeading(s.title)
      : this.t.detailsHeading(s.title);
  });
  protected readonly nodes = computed(() => this.markdown.render(this.detail()?.description ?? ''));
  protected readonly safeLink = computed(() => {
    const link = this.detail()?.link;
    return link ? safeHttpUrl(link) : null;
  });

  constructor() {
    effect(() => {
      const story = this.story();
      untracked(() => {
        this.detail.set(null);
        this.failed.set(false);
        if (story) void this.load(story);
      });
    });
  }

  private async load(story: AgendaStory): Promise<void> {
    try {
      const detail = await this.conn.getStory(story.id);
      if (this.story()?.id === story.id) this.detail.set(detail);
    } catch {
      if (this.story()?.id === story.id) this.failed.set(true);
    }
  }
}
