import { TestBed } from '@angular/core/testing';
import { computeSummary } from '@pokr/shared';
import type { Deck } from '@pokr/shared';
import { SummaryPanel } from './summary-panel';

function render(deck: Deck, cards: string[]) {
  const fixture = TestBed.createComponent(SummaryPanel);
  fixture.componentRef.setInput(
    'summary',
    computeSummary(
      deck,
      cards.map((card, i) => ({ participantId: `p${i}`, card })),
    ),
  );
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;
  return { el, text };
}

describe('SummaryPanel (F01-AC15)', () => {
  it('F01-AC15 shows distribution, average with one decimal, and median', () => {
    const { text } = render({ id: 'fibonacci' }, ['5', '5', '3', '?']);
    expect(text('summary-average')).toBe('4.3');
    expect(text('summary-median')).toBe('5');
    expect(text('summary-distribution-5')).toContain('2 votes');
    expect(text('summary-distribution-question')).toContain('1 vote');
    expect(text('summary-consensus')).toBeNull();
  });

  it('F01-AC15 even count median is the mean of the middle values; halves are decimals', () => {
    const { text } = render({ id: 'fibonacci' }, ['1', '2', '3', '½']);
    expect(text('summary-median')).toBe('1.5');
    expect(text('summary-distribution-half')).not.toBeNull();
  });

  it('F01-AC15 consensus needs two matching value cards; specials do not break it', () => {
    expect(render({ id: 'fibonacci' }, ['5', '5', '?']).text('summary-consensus')).toContain(
      'Consensus',
    );
    expect(render({ id: 'fibonacci' }, ['5']).text('summary-consensus')).toBeNull();
    expect(render({ id: 'fibonacci' }, ['5', '8']).text('summary-consensus')).toBeNull();
  });

  it('F01-AC15 non-numeric decks have no average or median', () => {
    const { text } = render({ id: 'tshirt' }, ['S', 'M']);
    expect(text('summary-average')).toBeNull();
    expect(text('summary-median')).toBeNull();
  });

  it('F01-AC17 zero votes shows "no votes"', () => {
    const { text } = render({ id: 'fibonacci' }, []);
    expect(text('summary-no-votes')).toBe('No votes');
    expect(text('summary-average')).toBeNull();
  });
});
