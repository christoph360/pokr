import { TestBed } from '@angular/core/testing';
import { computeSummary } from '@pokr/shared';
import type { RoomState } from '@pokr/shared';
import { extremesFor } from '../core/room-logic';
import { makeState, participant } from '../testing/fixtures';
import { ParticipantList } from './participant-list';

function render(state: RoomState, canManage = false) {
  const fixture = TestBed.createComponent(ParticipantList);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('canManage', canManage);
  if (state.round.phase === 'revealed') {
    fixture.componentRef.setInput(
      'extremes',
      extremesFor(computeSummary(state.settings.deck, state.round.votes)),
    );
  }
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const rows = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-testid=participant-row]'));

describe('ParticipantList', () => {
  it('F01-AC8 shows the server-assigned suffix in the visible and accessible name', () => {
    const el = render(
      makeState({
        participants: [
          participant('p1', { name: 'Alex' }),
          participant('p2', { name: 'Alex (2)' }),
          participant('p3', { name: 'Alex (3)' }),
        ],
      }),
      true,
    );
    const names = rows(el).map((r) =>
      r.querySelector('[data-testid=participant-name]')?.textContent?.trim(),
    );
    expect(names).toEqual(['Alex', 'Alex (2)', 'Alex (3)']);
    expect(el.querySelector('[data-testid=remove-p2]')?.getAttribute('aria-label')).toContain(
      'Alex (2)',
    );
    expect(el.querySelector('[data-testid=handover-p3]')?.getAttribute('aria-label')).toContain(
      'Alex (3)',
    );
  });

  it('F01-AC9 shows a voted indicator without the value, and marks you', () => {
    const el = render(
      makeState({
        participants: [participant('p1', { hasVoted: true }), participant('p2')],
        myVote: '8',
      }),
    );
    const [mine, other] = rows(el);
    expect(mine!.dataset['voted']).toBe('true');
    expect(mine!.dataset['you']).toBe('true');
    expect(mine!.querySelector('[data-testid=participant-vote]')?.textContent).toContain('Voted');
    expect(mine!.textContent).not.toContain('8');
    expect(other!.dataset['voted']).toBe('false');
  });

  it('F01-AC21 online and offline have text, not only color', () => {
    const el = render(
      makeState({ participants: [participant('p1'), participant('p2', { online: false })] }),
    );
    const [on, off] = rows(el);
    expect(on!.dataset['online']).toBe('true');
    expect(on!.textContent).toContain('Online');
    expect(off!.dataset['online']).toBe('false');
    expect(off!.textContent).toContain('Offline');
  });

  it('F01-AC15 labels lowest and highest voters with text and data-extreme', () => {
    const el = render(
      makeState({
        participants: [participant('p1'), participant('p2'), participant('p3')],
        round: {
          phase: 'revealed',
          number: 1,
          votes: [
            { participantId: 'p1', card: '2' },
            { participantId: 'p2', card: '8' },
            { participantId: 'p3', card: '?' },
          ],
          left: [],
        },
      }),
    );
    const [a, b, c] = rows(el);
    expect(a!.dataset['extreme']).toBe('lowest');
    expect(a!.textContent).toContain('Lowest');
    expect(b!.dataset['extreme']).toBe('highest');
    expect(b!.textContent).toContain('Highest');
    expect(c!.dataset['extreme']).toBeUndefined();
    expect(a!.querySelector('[data-testid=participant-vote]')?.textContent?.trim()).toBe('2');
  });

  it('F01-AC33 flip animation flag follows reduced motion (data-animated)', () => {
    const state = makeState({
      round: {
        phase: 'revealed',
        number: 1,
        votes: [{ participantId: 'p1', card: '3' }],
        left: [],
      },
    });
    const el = render(state);
    expect(el.querySelector('[data-testid=participant-vote]')?.getAttribute('data-animated')).toBe(
      'true',
    );
  });

  it('F01-AC18 a removed participant keeps their revealed vote with a left marker', () => {
    const el = render(
      makeState({
        participants: [participant('p1')],
        round: {
          phase: 'revealed',
          number: 1,
          votes: [{ participantId: 'gone', card: '5' }],
          left: [{ participantId: 'gone', name: 'Sam' }],
        },
      }),
      true,
    );
    const gone = rows(el).find((r) => r.dataset['participantId'] === 'gone')!;
    expect(gone.textContent).toContain('Sam');
    expect(gone.querySelector('[data-testid=participant-left]')).not.toBeNull();
    expect(gone.querySelector('[data-testid=participant-vote]')?.textContent?.trim()).toBe('5');
    expect(gone.querySelector('[data-testid=remove-gone]')).toBeNull();
  });

  it('F01-AC23/AC24 only the facilitator gets hand over and remove, never for themselves', () => {
    const state = makeState();
    expect(render(state, false).querySelector('[data-testid=remove-p2]')).toBeNull();
    const el = render(state, true);
    expect(el.querySelector('[data-testid=remove-p2]')).not.toBeNull();
    expect(el.querySelector('[data-testid=remove-p1]')).toBeNull();
  });

  it('F01-AC24 hand over is disabled for offline participants', () => {
    const el = render(
      makeState({ participants: [participant('p1'), participant('p2', { online: false })] }),
      true,
    );
    expect(el.querySelector('[data-testid=handover-p2]')?.getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});
