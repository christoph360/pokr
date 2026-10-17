import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { getByRole } from '../testing/dom';
import { ModalDialog } from './modal-dialog';

@Component({
  imports: [ModalDialog],
  template: `
    <button type="button" (click)="open.set(true)">Open it</button>
    <app-modal-dialog [open]="open()" heading="Hello" (dismissed)="open.set(false)">
      <button type="button" (click)="open.set(false)">Done</button>
    </app-modal-dialog>
  `,
})
class Host {
  readonly open = signal(false);
}

describe('ModalDialog focus', () => {
  it('F02-AC19 returns focus to the opener when it closes', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const opener = getByRole(el, 'button', 'Open it');
    opener.focus();
    opener.click();
    fixture.detectChanges();
    await fixture.whenStable();
    getByRole(el, 'button', 'Done').focus();
    getByRole(el, 'button', 'Done').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });
});
