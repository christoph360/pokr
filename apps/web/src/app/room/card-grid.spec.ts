import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { resolveDeck } from '@pokr/shared';
import { CardGrid } from './card-grid';

function setup(
  inputs: { myVote?: string | null; pendingCard?: string | null; disabled?: boolean } = {},
) {
  const fixture: ComponentFixture<CardGrid> = TestBed.createComponent(CardGrid);
  fixture.componentRef.setInput('cards', resolveDeck({ id: 'fibonacci' }));
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const card = (slug: string) =>
    el.querySelector<HTMLButtonElement>(`[data-testid="card-${slug}"]`)!;
  return { fixture, el, card };
}

describe('CardGrid', () => {
  it('F01-AC33 cards are toggle buttons with names for symbols, slugs as test ids', () => {
    const { card } = setup();
    expect(card('5').getAttribute('aria-pressed')).toBe('false');
    expect(card('half').getAttribute('aria-label')).toBe('one half');
    expect(card('coffee').getAttribute('aria-label')).toBe('coffee break');
    expect(card('question')).not.toBeNull();
  });

  it('F01-AC9 only the server-confirmed vote is shown as pressed; pending is separate', () => {
    const { card } = setup({ myVote: '3', pendingCard: '8' });
    expect(card('3').getAttribute('aria-pressed')).toBe('true');
    expect(card('8').getAttribute('aria-pressed')).toBe('false');
    expect(card('8').dataset['pending']).toBe('true');
  });

  it('F01-AC10 a click emits the picked card', () => {
    const { fixture, card } = setup();
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((c) => picked.push(c));
    card('5').click();
    expect(picked).toEqual(['5']);
  });

  it('F01-AC29 disabled cards (offline or revealed) ignore clicks and say so', () => {
    const { fixture, card } = setup({ disabled: true });
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((c) => picked.push(c));
    card('5').click();
    expect(picked).toEqual([]);
    expect(card('5').getAttribute('aria-disabled')).toBe('true');
  });

  it('F01-AC33 arrow keys move focus between cards', () => {
    const { fixture, card } = setup();
    document.body.appendChild(fixture.nativeElement);
    card('0').focus();
    card('0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(card('half'));
    fixture.nativeElement.remove();
  });

  it.each(['fibonacci', 'modified-fibonacci', 'tshirt', 'powers-of-2'] as const)(
    'F01-AC33 every card in the %s deck has a non-empty accessible name',
    (id) => {
      const fixture = TestBed.createComponent(CardGrid);
      fixture.componentRef.setInput('cards', resolveDeck({ id }));
      fixture.detectChanges();
      const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button.card');
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of Array.from(buttons)) {
        // aria-label wins; otherwise the visible text must not be hidden from assistive tech.
        const label = b.getAttribute('aria-label')?.trim();
        const visible = Array.from(b.querySelectorAll('.card__face'))
          .filter((n) => !n.closest('[aria-hidden="true"]'))
          .map((n) => n.textContent?.trim())
          .join('');
        expect(label || visible, b.outerHTML).toBeTruthy();
      }
    },
  );
});
