import { TestBed } from '@angular/core/testing';
import { JoinForm } from './join-form';
import type { JoinRequest } from './join-form';

describe('JoinForm', () => {
  function render() {
    const fixture = TestBed.createComponent(JoinForm);
    const joined: JoinRequest[] = [];
    fixture.componentInstance.joined.subscribe((j) => joined.push(j));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
    const type = (value: string) => {
      const input = q<HTMLInputElement>('join-name')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = () => {
      q('join-submit')!.click();
      fixture.detectChanges();
    };
    return { q, type, submit, joined };
  }

  it('F01-AC4 asks for a name of 1 to 30 graphemes and shows an inline error otherwise', () => {
    const { q, type, submit, joined } = render();
    submit();
    expect(q('join-name-error')?.textContent).toContain('Enter a name');
    type('x'.repeat(31));
    submit();
    expect(q('join-name-error')?.textContent).toContain('at most 30');
    expect(joined).toEqual([]);
  });

  it('F01-AC4 rejects control characters', () => {
    const { q, type, submit, joined } = render();
    type('Al\tex');
    submit();
    expect(q('join-name-error')?.textContent).toContain('control characters');
    expect(joined).toEqual([]);
  });

  it('F01-AC4 joins as voter by default with the normalized name', () => {
    const { type, submit, joined } = render();
    type('  Alex   Smith ');
    submit();
    expect(joined).toEqual([{ name: 'Alex Smith', role: 'voter' }]);
  });

  it('F01-AC4 can join as observer', () => {
    const { q, type, submit, joined } = render();
    type('Obs');
    q<HTMLInputElement>('join-role-observer')!.click();
    submit();
    expect(joined).toEqual([{ name: 'Obs', role: 'observer' }]);
  });
});
