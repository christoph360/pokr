import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  afterRenderEffect,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';

const CONTROL = 'button, a[href], input, select, textarea, [tabindex="0"]';

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

  private opener: HTMLElement | null = null;
  private lastClicked: HTMLElement | null = null;
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    const doc = inject(DOCUMENT);
    const onClick = (event: Event) => {
      this.lastClicked = event.target instanceof Element ? event.target.closest('button') : null;
    };
    doc.addEventListener('click', onClick, true);
    inject(DestroyRef).onDestroy(() => doc.removeEventListener('click', onClick, true));

    afterRenderEffect(() => {
      const el = this.dlg().nativeElement;
      if (this.open()) {
        if (!el.open) {
          // Remember the opener: not every browser returns focus to it when a dialog closes. Safari
          // does not focus a button on click (it may focus an ancestor such as <main>), so fall
          // back to the last clicked button.
          const active = el.ownerDocument.activeElement;
          this.opener =
            active instanceof HTMLElement && active.matches(CONTROL) ? active : this.lastClicked;
          if (typeof el.showModal === 'function') el.showModal();
          else el.setAttribute('open', '');
        }
      } else if (el.open) {
        if (typeof el.close === 'function') el.close();
        else el.removeAttribute('open');
        const opener = this.opener;
        this.opener = null;
        if (opener?.isConnected && el.ownerDocument.activeElement !== opener) {
          // Only when focus was not already moved somewhere sensible (e.g. a following dialog).
          const now = el.ownerDocument.activeElement;
          if (!now || now === el.ownerDocument.body || el.contains(now) || !now.matches(CONTROL)) {
            opener.focus();
          }
        }
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
