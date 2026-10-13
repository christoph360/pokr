import {
  ChangeDetectionStrategy,
  Component,
  afterRenderEffect,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';

/**
 * Modal built on the native `<dialog>`: it traps focus, closes on Escape, and returns focus to the
 * opener. Content is only rendered while open, so hidden dialogs never duplicate test ids.
 */
@Component({
  selector: 'app-modal-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dlg
      class="modal"
      [attr.data-testid]="testId()"
      [attr.aria-labelledby]="titleId()"
      (cancel)="onCancel($event)"
      (close)="onNativeClose()"
    >
      @if (open()) {
        <div class="modal__body">
          <h2 class="modal__title" [id]="titleId()">{{ heading() }}</h2>
          <ng-content />
        </div>
      }
    </dialog>
  `,
})
export class ModalDialog {
  readonly open = input.required<boolean>();
  readonly heading = input.required<string>();
  readonly testId = input<string>('');
  readonly titleId = input<string>('modal-title');
  /** Emitted when the user dismisses with Escape (or the browser closes the dialog). */
  readonly dismissed = output<void>();

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    afterRenderEffect(() => {
      const el = this.dlg().nativeElement;
      if (this.open()) {
        if (!el.open) {
          if (typeof el.showModal === 'function') el.showModal();
          else el.setAttribute('open', '');
        }
      } else if (el.open) {
        if (typeof el.close === 'function') el.close();
        else el.removeAttribute('open');
      }
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.dismissed.emit();
  }

  protected onNativeClose(): void {
    if (this.open()) this.dismissed.emit();
  }
}
