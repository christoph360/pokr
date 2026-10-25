import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import type { AgendaStory } from '@pokr/shared';
import { RoomConnection } from '../core/room-connection';
import { StoryActions } from '../core/story-actions';
import {
  checkStoryDescription,
  checkStoryLink,
  checkStoryTitle,
  type FieldResult,
} from '../core/story-logic';
import { STRINGS } from '../i18n/strings';
import { ModalDialog } from '../ui/modal-dialog';

type Field = 'title' | 'description' | 'link';

function validator(check: (input: string) => FieldResult<unknown>) {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = check(String(control.value ?? ''));
    return result.ok ? null : { text: result.message };
  };
}

/**
 * Add or edit a story (F02-AC2, AC4). Fields are validated inline with the shared schemas; on a
 * server rejection (`not_allowed`, `story_limit_reached`, ...) the dialog stays open and keeps the
 * text. Test ids are `<prefix>-dialog`, `-title`, `-description`, `-link`, `-submit`, `-cancel`,
 * `-error` and `-<field>-error`, with prefix `story-add` or `story-edit`.
 */
@Component({
  selector: 'app-story-form-dialog',
  imports: [ReactiveFormsModule, ModalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal-dialog
      [open]="open()"
      [heading]="mode() === 'add' ? t.addHeading : t.editHeading"
      [testId]="prefix() + '-dialog'"
      [titleId]="prefix() + '-title-heading'"
      (dismissed)="closed.emit()"
    >
      <form class="form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        @if (loading()) {
          <p role="status" class="muted">{{ t.loadingStory }}</p>
        }
        <div class="field">
          <label [for]="prefix() + '-title'">{{ t.titleLabel }}</label>
          <input
            [id]="prefix() + '-title'"
            [attr.data-testid]="prefix() + '-title'"
            type="text"
            autocomplete="off"
            formControlName="title"
            [attr.aria-invalid]="show('title') ? 'true' : null"
            [attr.aria-describedby]="show('title') ? prefix() + '-title-error' : null"
          />
          @if (show('title')) {
            <p
              class="error"
              [id]="prefix() + '-title-error'"
              [attr.data-testid]="prefix() + '-title-error'"
            >
              {{ message('title') }}
            </p>
          }
        </div>
        <div class="field">
          <label [for]="prefix() + '-description'">{{ t.descriptionLabel }}</label>
          <textarea
            [id]="prefix() + '-description'"
            [attr.data-testid]="prefix() + '-description'"
            rows="5"
            formControlName="description"
            [attr.aria-invalid]="show('description') ? 'true' : null"
            [attr.aria-describedby]="
              show('description') ? prefix() + '-description-error' : prefix() + '-description-hint'
            "
          ></textarea>
          <p class="hint" [id]="prefix() + '-description-hint'">{{ t.descriptionHint }}</p>
          @if (show('description')) {
            <p
              class="error"
              [id]="prefix() + '-description-error'"
              [attr.data-testid]="prefix() + '-description-error'"
            >
              {{ message('description') }}
            </p>
          }
        </div>
        <div class="field">
          <label [for]="prefix() + '-link'">{{ t.linkLabel }}</label>
          <input
            [id]="prefix() + '-link'"
            [attr.data-testid]="prefix() + '-link'"
            type="text"
            inputmode="url"
            autocomplete="off"
            formControlName="link"
            [attr.aria-invalid]="show('link') ? 'true' : null"
            [attr.aria-describedby]="
              show('link') ? prefix() + '-link-error' : prefix() + '-link-hint'
            "
          />
          <p class="hint" [id]="prefix() + '-link-hint'">{{ t.linkHint }}</p>
          @if (show('link')) {
            <p
              class="error"
              [id]="prefix() + '-link-error'"
              [attr.data-testid]="prefix() + '-link-error'"
            >
              {{ message('link') }}
            </p>
          }
        </div>
        @if (failure()) {
          <p class="error" role="alert" [attr.data-testid]="prefix() + '-error'">
            {{ failure() }}
          </p>
        }
        <div class="actions">
          <button
            type="submit"
            class="btn btn--primary"
            [attr.data-testid]="prefix() + '-submit'"
            [attr.aria-disabled]="busy() || loading() ? 'true' : null"
          >
            {{ mode() === 'add' ? t.addSubmit : t.editSubmit }}
          </button>
          <button
            type="button"
            class="btn"
            [attr.data-testid]="prefix() + '-cancel'"
            (click)="closed.emit()"
          >
            {{ t.cancel }}
          </button>
        </div>
      </form>
    </app-modal-dialog>
  `,
})
export class StoryFormDialog {
  protected readonly t = STRINGS.stories;
  readonly open = input.required<boolean>();
  readonly mode = input.required<'add' | 'edit'>();
  /** The story being edited (edit mode). */
  readonly story = input<AgendaStory | null>(null);
  readonly closed = output<void>();

  private readonly conn = inject(RoomConnection);
  private readonly actions = inject(StoryActions);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly form = this.fb.group({
    title: this.fb.control('', validator(checkStoryTitle)),
    description: this.fb.control('', validator(checkStoryDescription)),
    link: this.fb.control('', validator(checkStoryLink)),
  });
  protected readonly busy = signal(false);
  protected readonly loading = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly serverErrors = signal<Partial<Record<Field, string>>>({});
  private readonly submitted = signal(false);
  /** The values the edit started from, to send only what changed. */
  private original: { title: string; description: string; link: string | null } | null = null;

  protected prefix(): string {
    return this.mode() === 'add' ? 'story-add' : 'story-edit';
  }

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const story = untracked(() => this.story());
      const mode = untracked(() => this.mode());
      untracked(() => this.reset(mode, story));
    });
  }

  private reset(mode: 'add' | 'edit', story: AgendaStory | null): void {
    this.form.reset({ title: '', description: '', link: '' });
    this.submitted.set(false);
    this.busy.set(false);
    this.failure.set(null);
    this.serverErrors.set({});
    this.original = null;
    if (mode === 'edit' && story) {
      this.form.controls.title.setValue(story.title);
      this.form.controls.link.setValue(story.link ?? '');
      this.original = { title: story.title, description: '', link: story.link };
      if (story.hasDescription) void this.loadDescription(story);
    }
  }

  private async loadDescription(story: AgendaStory): Promise<void> {
    this.loading.set(true);
    try {
      const detail = await this.conn.getStory(story.id);
      // Fill only what the user has not started editing.
      if (this.form.controls.description.pristine && this.story()?.id === story.id) {
        this.form.controls.description.setValue(detail.description);
        this.form.controls.description.markAsPristine();
      }
      if (this.original) this.original.description = detail.description;
    } catch {
      this.failure.set(STRINGS.stories.historyFailed);
    } finally {
      this.loading.set(false);
    }
  }

  protected show(field: Field): boolean {
    const control = this.form.controls[field];
    const server = this.serverErrors()[field];
    return !!server || (control.invalid && (control.touched || control.dirty || this.submitted()));
  }

  protected message(field: Field): string {
    const server = this.serverErrors()[field];
    if (server) return server;
    const e = this.form.controls[field].errors?.['text'];
    return typeof e === 'string' ? e : '';
  }

  protected async submit(): Promise<void> {
    if (this.busy() || this.loading()) return;
    this.submitted.set(true);
    this.failure.set(null);
    this.serverErrors.set({});
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const raw = this.form.getRawValue();
    const title = checkStoryTitle(raw.title);
    const description = checkStoryDescription(raw.description);
    const link = checkStoryLink(raw.link);
    if (!title.ok || !description.ok || !link.ok) return;

    this.busy.set(true);
    const result =
      this.mode() === 'add'
        ? await this.actions.run({
            type: 'add_story',
            title: title.value,
            ...(description.value !== '' ? { description: description.value } : {}),
            ...(link.value !== null ? { link: link.value } : {}),
          })
        : await this.sendEdit(title.value, description.value, link.value);
    this.busy.set(false);

    if (result.ok) {
      if (this.mode() === 'add') this.actions.announcement.set(STRINGS.stories.added(1));
      this.closed.emit();
      return;
    }
    if (result.code === 'invalid_input' && result.field && result.field in this.form.controls) {
      this.serverErrors.set({ [result.field]: STRINGS.errors['invalid_input'] ?? '' });
      return;
    }
    this.failure.set(STRINGS.errors[result.code] ?? STRINGS.errors['internal_error'] ?? null);
  }

  private async sendEdit(title: string, description: string, link: string | null) {
    const story = this.story();
    if (!story) return { ok: false as const, code: 'unknown_story' };
    const before = this.original;
    const changes = {
      ...(before === null || title !== before.title ? { title } : {}),
      ...(before === null || description !== before.description ? { description } : {}),
      ...(before === null || link !== before.link ? { link } : {}),
    };
    if (Object.keys(changes).length === 0) return { ok: true as const };
    return this.actions.run({ type: 'edit_story', storyId: story.id, ...changes });
  }
}
