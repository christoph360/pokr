import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { MAX_STORIES } from '@pokr/shared';
import { StoryActions } from '../core/story-actions';
import { bulkServerError, previewBulk } from '../core/story-logic';
import { STRINGS } from '../i18n/strings';
import { ModalDialog } from '../ui/modal-dialog';

/**
 * "Add several" (F02-AC3). The client previews the count and per-line errors with `parseBulkLines`
 * but sends the raw text; the server splits and validates it. The paste is all or nothing, and the
 * text stays in the field when the server rejects it.
 */
@Component({
  selector: 'app-bulk-add-dialog',
  imports: [ModalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal-dialog
      [open]="open()"
      [heading]="t.bulkHeading"
      testId="story-bulk-dialog"
      titleId="story-bulk-title"
      (dismissed)="closed.emit()"
    >
      <form class="form" (submit)="$event.preventDefault(); submit()" novalidate>
        <div class="field">
          <label for="story-bulk-text">{{ t.bulkLabel }}</label>
          <textarea
            id="story-bulk-text"
            data-testid="story-bulk-text"
            rows="8"
            name="text"
            autocomplete="off"
            spellcheck="false"
            [value]="text()"
            (input)="onInput($event)"
            [attr.aria-invalid]="problems().length > 0 ? 'true' : null"
            aria-describedby="story-bulk-hint story-bulk-preview story-bulk-error"
          ></textarea>
          <p id="story-bulk-hint" class="hint">{{ t.bulkHint }}</p>
          <p id="story-bulk-preview" class="muted" data-testid="story-bulk-preview">
            {{ previewText() }}
          </p>
          <div id="story-bulk-error" data-testid="story-bulk-error">
            @if (problems().length > 0) {
              <p class="error">{{ t.bulkErrors }}</p>
              <ul class="error-list">
                @for (problem of problems(); track $index) {
                  <li>{{ problem }}</li>
                }
              </ul>
            }
          </div>
        </div>
        @if (failure()) {
          <p class="error" role="alert" data-testid="story-bulk-failure">{{ failure() }}</p>
        }
        <div class="actions">
          <button
            type="submit"
            class="btn btn--primary"
            data-testid="story-bulk-submit"
            [attr.aria-disabled]="busy() ? 'true' : null"
          >
            {{ preview().count > 0 ? t.bulkSubmit(preview().count) : t.bulkSubmitEmpty }}
          </button>
          <button type="button" class="btn" data-testid="story-bulk-cancel" (click)="closed.emit()">
            {{ t.cancel }}
          </button>
        </div>
      </form>
    </app-modal-dialog>
  `,
})
export class BulkAddDialog {
  protected readonly t = STRINGS.stories;
  readonly open = input.required<boolean>();
  /** Stories in the agenda now, for the room-left check. */
  readonly existing = input.required<number>();
  readonly closed = output<void>();

  private readonly actions = inject(StoryActions);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly serverProblems = signal<string[]>([]);

  protected readonly preview = computed(() => previewBulk(this.text(), this.existing()));
  protected readonly problems = computed(() => [
    ...this.preview().errors,
    ...this.serverProblems(),
  ]);
  protected readonly previewText = computed(() => {
    const p = this.preview();
    if (p.count === 0 && p.errors.length === 0) return this.t.bulkNone;
    return this.t.bulkPreview(p.count);
  });

  constructor() {
    // A fresh paste box every time the dialog opens.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.text.set('');
        this.failure.set(null);
        this.serverProblems.set([]);
        this.busy.set(false);
      });
    });
    // Editing the text makes an old server verdict obsolete.
    effect(() => {
      this.text();
      untracked(() => this.serverProblems.set([]));
    });
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.failure.set(null);
    if (!this.preview().ok) {
      this.host.nativeElement.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    this.busy.set(true);
    // The raw text goes out; the server splits and validates it (F02-AC3).
    const result = await this.actions.run({ type: 'add_stories', text: this.text() });
    this.busy.set(false);
    if (result.ok) {
      this.actions.announcement.set(STRINGS.stories.added(this.preview().count));
      this.closed.emit();
      return;
    }
    const line = bulkServerError(result.code, result.field);
    if (line) this.serverProblems.set([line]);
    else if (result.code === 'story_limit_reached') {
      this.serverProblems.set([this.t.bulkRoom(MAX_STORIES - this.existing())]);
    } else {
      this.failure.set(STRINGS.errors[result.code] ?? STRINGS.errors['internal_error'] ?? null);
    }
  }
}
