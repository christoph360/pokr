import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DisplayNameSchema } from '@pokr/shared';
import type { Role } from '@pokr/shared';
import { checkText } from '../core/room-logic';
import { errorText, textValidator } from '../core/text-validator';
import { STRINGS } from '../i18n/strings';

export interface JoinRequest {
  name: string;
  role: Role;
}

/** Name prompt shown when no token is stored for the room (F01-AC4). */
@Component({
  selector: 'app-join-form',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel panel--narrow" aria-labelledby="join-heading" data-testid="join-form">
      <h2 id="join-heading">{{ t.join.heading }}</h2>
      @if (roomName()) {
        <p class="muted">{{ t.join.roomLabel(roomName()) }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="form">
        <div class="field">
          <label for="join-name">{{ t.join.name }}</label>
          <input
            id="join-name"
            data-testid="join-name"
            type="text"
            formControlName="name"
            autocomplete="nickname"
            [attr.aria-invalid]="showError() ? 'true' : null"
            [attr.aria-describedby]="showError() ? 'join-name-error' : null"
          />
          @if (showError()) {
            <p id="join-name-error" class="error" data-testid="join-name-error">{{ error() }}</p>
          }
        </div>

        <fieldset class="field">
          <legend>{{ t.join.role }}</legend>
          <label class="choice">
            <input
              type="radio"
              formControlName="role"
              value="voter"
              data-testid="join-role-voter"
            />
            <span
              ><strong>{{ t.join.voter }}</strong>
              <span class="hint">{{ t.join.voterHint }}</span></span
            >
          </label>
          <label class="choice">
            <input
              type="radio"
              formControlName="role"
              value="observer"
              data-testid="join-role-observer"
            />
            <span
              ><strong>{{ t.join.observer }}</strong>
              <span class="hint">{{ t.join.observerHint }}</span></span
            >
          </label>
        </fieldset>

        <button type="submit" class="btn btn--primary" data-testid="join-submit">
          {{ t.join.submit }}
        </button>
      </form>
    </section>
  `,
})
export class JoinForm {
  protected readonly t = STRINGS;
  readonly roomName = input('');
  readonly joined = output<JoinRequest>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    name: this.fb.control('', textValidator(DisplayNameSchema, 'name')),
    role: this.fb.control<Role>('voter'),
  });

  protected showError(): boolean {
    const c = this.form.controls.name;
    return c.invalid && (c.touched || c.dirty);
  }

  protected error(): string | null {
    return errorText(this.form.controls.name);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const { name, role } = this.form.getRawValue();
    const checked = checkText(DisplayNameSchema, 'name', name);
    if (!checked.ok) {
      this.host.nativeElement.querySelector<HTMLElement>('#join-name')?.focus();
      return;
    }
    this.joined.emit({ name: checked.value, role });
  }
}
