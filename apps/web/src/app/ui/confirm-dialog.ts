import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ModalDialog } from './modal-dialog';

/** Confirm/cancel dialog. Test ids: `<prefix>`, `<prefix>-ok`, `<prefix>-cancel`. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [ModalDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal-dialog
      [open]="open()"
      [heading]="heading()"
      [testId]="prefix()"
      [titleId]="prefix() + '-title'"
      (dismissed)="cancelled.emit()"
    >
      <p>{{ message() }}</p>
      <div class="actions">
        <button
          type="button"
          class="btn btn--primary"
          [attr.data-testid]="prefix() + '-ok'"
          (click)="confirmed.emit()"
        >
          {{ okLabel() }}
        </button>
        <button
          type="button"
          class="btn"
          [attr.data-testid]="prefix() + '-cancel'"
          (click)="cancelled.emit()"
        >
          {{ cancelLabel() }}
        </button>
      </div>
    </app-modal-dialog>
  `,
})
export class ConfirmDialog {
  readonly open = input.required<boolean>();
  readonly prefix = input.required<string>();
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly okLabel = input.required<string>();
  readonly cancelLabel = input.required<string>();
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
