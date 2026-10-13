import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RoomState } from '@pokr/shared';
import { RoomConnection } from '../core/room-connection';
import type { CommandInput } from '../core/room-connection';
import { makeState, participant } from '../testing/fixtures';
import { RoomView } from './room-view';

function setup(state: RoomState, connected = true) {
  const sent: CommandInput[] = [];
  const isConnected = signal(connected);
  const stub = {
    connected: isConnected,
    notice: signal(null),
    serverNow: () => Date.now(),
    send: (cmd: CommandInput) => {
      sent.push(cmd);
      return Promise.resolve(1);
    },
  };
  TestBed.configureTestingModule({ providers: [{ provide: RoomConnection, useValue: stub }] });
  const fixture = TestBed.createComponent(RoomView);
  fixture.componentRef.setInput('state', state);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  return { fixture, el, q, sent, isConnected };
}

const as = (
  state: RoomState,
  selfId: string,
  settings: Partial<RoomState['settings']> = {},
): RoomState => ({
  ...state,
  selfId,
  settings: { ...state.settings, ...settings },
});

describe('RoomView control visibility', () => {
  const base = makeState({
    participants: [participant('p1'), participant('p2'), participant('p3', { role: 'observer' })],
  });

  it('F01-AC13 facilitator-only: facilitator sees reveal, reset, settings and topic input', () => {
    const { q } = setup(base);
    for (const id of ['reveal', 'reset', 'settings-open', 'topic-input', 'topic-save']) {
      expect(q(id), id).not.toBeNull();
    }
  });

  it('F01-AC13 facilitator-only: a voter sees none of them', () => {
    const { q } = setup(as(base, 'p2'));
    for (const id of ['reveal', 'reset', 'settings-open', 'topic-input'])
      expect(q(id), id).toBeNull();
    expect(q('card-5')).not.toBeNull();
  });

  it('F01-AC13 everyone mode: voters get reveal and reset but not settings or topic', () => {
    const { q } = setup(as(base, 'p2', { controlMode: 'everyone' }));
    expect(q('reveal')).not.toBeNull();
    expect(q('reset')).not.toBeNull();
    expect(q('settings-open')).toBeNull();
    expect(q('topic-input')).toBeNull();
  });

  it('F01-AC13 everyone mode: observers still cannot reveal or reset', () => {
    const { q } = setup(as(base, 'p3', { controlMode: 'everyone' }));
    expect(q('reveal')).toBeNull();
    expect(q('reset')).toBeNull();
  });

  it('F01-AC12 observers see no cards but see the counter', () => {
    const { q } = setup(as(base, 'p3'));
    expect(q('card-grid')).toBeNull();
    expect(q('voted-count')?.textContent).toContain('0 of 2');
  });

  it('F01-AC35 facilitator with voting off sees no cards but keeps reveal', () => {
    const { q } = setup(as(base, 'p1', { facilitatorVotes: false }));
    expect(q('card-grid')).toBeNull();
    expect(q('reveal')).not.toBeNull();
  });

  it('F01-AC25 claim button only after the threshold, for non-facilitators', () => {
    const waiting = { ...as(base, 'p3'), canClaimAt: Date.now() + 60_000 };
    expect(setup(waiting).q('claim-facilitator')).toBeNull();
    TestBed.resetTestingModule();
    const open = { ...as(base, 'p3'), canClaimAt: Date.now() - 1 };
    expect(setup(open).q('claim-facilitator')).not.toBeNull();
  });

  it('R-F2 exposes the state version and the room name', () => {
    const { q } = setup({ ...base, version: 42 });
    expect(q('room')?.getAttribute('data-state-version')).toBe('42');
    expect(q('room-name')?.textContent).toBe('Sprint 42');
  });
});

describe('RoomView topic and rename forms', () => {
  it('F01-AC20 the facilitator saves a topic with the save button', async () => {
    const { q, sent, fixture } = setup(makeState());
    const input = q<HTMLInputElement>('topic-input')!;
    input.value = '  Story   1 ';
    input.dispatchEvent(new Event('input'));
    q('topic-save')!.click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'set_topic', topic: 'Story 1' }]);
  });

  it('F01-AC36 renaming sends the normalized name', async () => {
    const { q, sent, fixture } = setup(makeState());
    q('rename-open')!.click();
    fixture.detectChanges();
    const input = q<HTMLInputElement>('rename-input')!;
    input.value = ' Sam ';
    input.dispatchEvent(new Event('input'));
    q('rename-save')!.click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'rename', name: 'Sam' }]);
  });
});

describe('RoomView voting', () => {
  it('F01-AC10 clicking a different card votes it; clicking the held card withdraws', async () => {
    const { q, sent, fixture } = setup({ ...makeState(), myVote: '5' });
    q('card-8')!.click();
    await fixture.whenStable();
    q('card-5')!.click();
    await fixture.whenStable();
    expect(sent).toEqual([
      { type: 'vote', card: '8' },
      { type: 'vote', card: null },
    ]);
  });

  it('F01-AC29 cards are disabled while disconnected and send nothing', () => {
    const { q, sent } = setup(makeState(), false);
    expect(q('card-5')!.getAttribute('aria-disabled')).toBe('true');
    q('card-5')!.click();
    expect(sent).toEqual([]);
    expect(q('cards-paused')).not.toBeNull();
  });

  it('F01-AC19 reset asks for confirmation only when unrevealed votes exist', async () => {
    const empty = setup(makeState());
    empty.q('reset')!.click();
    await empty.fixture.whenStable();
    expect(empty.sent).toEqual([{ type: 'reset' }]);

    TestBed.resetTestingModule();
    const voted = setup(
      makeState({ participants: [participant('p1', { hasVoted: true }), participant('p2')] }),
    );
    voted.q('reset')!.click();
    voted.fixture.detectChanges();
    expect(voted.sent).toEqual([]);
    expect(voted.q('reset-confirm-ok')).not.toBeNull();
    voted.q('reset-confirm-ok')!.click();
    await voted.fixture.whenStable();
    expect(voted.sent).toEqual([{ type: 'reset' }]);
  });

  it('F01-AC14 reveal announces once through the live region with the summary', () => {
    const revealed = makeState({
      round: {
        phase: 'revealed',
        number: 1,
        votes: [
          { participantId: 'p1', card: '5' },
          { participantId: 'p2', card: '5' },
        ],
        left: [],
      },
    });
    const { q } = setup(revealed);
    const text = q('reveal-announcer')!.textContent!;
    expect(text).toContain('Votes revealed');
    expect(text).toContain('Average 5.0');
    expect(text).toContain('Consensus');
    expect(q('summary')).not.toBeNull();
    expect(q('reveal')!.getAttribute('aria-disabled')).toBe('true');
  });
});
