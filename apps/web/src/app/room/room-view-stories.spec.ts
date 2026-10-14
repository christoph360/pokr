import { TestBed } from '@angular/core/testing';
import type { RoomState } from '@pokr/shared';
import { CommandError } from '../core/room-connection';
import { connStub } from '../testing/conn-stub';
import { getByRole, queryByRole } from '../testing/dom';
import { heldFrom, makeState, makeStoryState, participant, story } from '../testing/fixtures';
import { SettingsDialog } from './settings-dialog';
import { RoomView } from './room-view';
import type { snapshotOf } from './story-announcer';
import { storyAnnouncement } from './story-announcer';

const rows = [
  story('a', { title: 'Login page', link: 'https://tracker.example/1', hasDescription: true }),
  story('b', { title: 'Search' }),
  story('c', { title: 'Export', status: 'estimated', estimate: '5' }),
];

const revealed = (cards: string[]): RoomState['round'] => ({
  phase: 'revealed',
  number: 1,
  votes: cards.map((card, i) => ({ participantId: `p${i + 1}`, card })),
  left: [],
});

function setup(state: RoomState, reply?: Parameters<typeof connStub>[1]) {
  const c = connStub(state, reply);
  TestBed.configureTestingModule({ providers: [c.provider] });
  const fixture = TestBed.createComponent(RoomView);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('agenda', heldFrom(state));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  return { fixture, el, q, ...c };
}

describe('RoomView in Story list mode', () => {
  it('F02-AC1 replaces the topic with the active story: topic-display is absent', () => {
    const state = makeStoryState(
      rows,
      { activeId: 'a', activeDescription: 'Do **this**' },
      { topic: 'Old topic' },
    );
    const { q, el } = setup(state);
    expect(q('topic-display')).toBeNull();
    expect(q('topic-input')).toBeNull();
    expect(q('active-story-title')?.textContent).toBe('Login page');
    expect(q('active-story-description')?.querySelector('strong')?.textContent).toBe('this');
    const link = getByRole(el, 'link', /tracker\.example/);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('opens in new tab');
  });

  it('F02-AC1 in Free topic mode the topic UI stays and there is no active-story area', () => {
    const { q } = setup(makeState({ topic: 'Mine' }));
    expect(q('topic-display')?.textContent).toBe('Mine');
    expect(q('active-story')).toBeNull();
    expect(q('no-active-story')).toBeNull();
  });

  it('F02-AC7 idle: "No story selected", cards disabled, reveal and reset disabled', async () => {
    const { q, el, sent, fixture } = setup(makeStoryState(rows, { activeId: null }));
    expect(q('no-active-story')?.textContent).toContain('No story selected');
    const card = getByRole(el, 'button', '5');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    card.click();
    getByRole(el, 'button', 'Reveal votes').click();
    getByRole(el, 'button', 'Reset round').click();
    await fixture.whenStable();
    expect(sent).toEqual([]);
  });

  it('F02-AC9 Next is disabled with an explanation when nothing is pending', () => {
    const done = [
      story('a', { status: 'estimated', estimate: '3' }),
      story('b', { status: 'skipped' }),
    ];
    const { el, q, sent } = setup(makeStoryState(done, { activeId: null }));
    const next = getByRole(el, 'button', 'Next story');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(q('next-story-hint')?.textContent).toContain('All stories are estimated or skipped');
    next.click();
    expect(sent).toEqual([]);
  });

  it('F02-AC9 Next sends next_story with the round id', async () => {
    const { el, sent, fixture } = setup(
      makeStoryState(rows, { activeId: 'a' }, { round: { phase: 'voting', number: 6 } }),
    );
    getByRole(el, 'button', 'Next story').click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'next_story', round: 6, confirmReset: false }]);
  });

  it('F02 unsaved round: Next asks for confirmation and Cancel sends nothing', async () => {
    const state = makeStoryState(
      rows,
      { activeId: 'a' },
      { participants: [participant('p1', { hasVoted: true }), participant('p2')], myVote: '5' },
    );
    const { el, q, sent, fixture } = setup(state);
    getByRole(el, 'button', 'Next story').click();
    fixture.detectChanges();
    expect(q('round-confirm')).not.toBeNull();
    getByRole(el, 'button', 'Cancel').click();
    fixture.detectChanges();
    expect(sent).toEqual([]);
    getByRole(el, 'button', 'Next story').click();
    fixture.detectChanges();
    getByRole(el, 'button', 'Discard votes and continue').click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'next_story', round: 1, confirmReset: true }]);
  });

  it('F02-AC13 Skip and Skip and next on the active story', async () => {
    const { el, sent, fixture } = setup(makeStoryState(rows, { activeId: 'a' }));
    getByRole(el, 'button', 'Skip story').click();
    getByRole(el, 'button', 'Skip and next').click();
    await fixture.whenStable();
    expect(sent.map((c) => c.type === 'skip_story' && c.advance)).toEqual([false, true]);
  });

  it('F02-AC4 deleting an estimated story asks, naming the estimate, then sends confirmDelete', async () => {
    const { el, q, sent, fixture } = setup(makeStoryState(rows, { activeId: 'a' }));
    getByRole(el, 'button', 'Delete Export').click();
    fixture.detectChanges();
    expect(q('story-delete-confirm')?.textContent).toContain('estimate 5');
    getByRole(el, 'button', 'Delete story').click();
    await fixture.whenStable();
    expect(sent).toEqual([
      { type: 'delete_story', storyId: 'c', confirmReset: false, confirmDelete: true },
    ]);
  });

  it('F02-AC6 everyone mode: a voter can reveal and reset but sees no story management', () => {
    const state = makeStoryState(
      rows,
      { activeId: 'a' },
      {
        selfId: 'p2',
        settings: { ...makeState().settings, controlMode: 'everyone' },
      },
    );
    const { el, q } = setup(state);
    expect(queryByRole(el, 'button', 'Reveal votes')).not.toBeNull();
    expect(queryByRole(el, 'button', 'Reset round')).not.toBeNull();
    for (const name of [
      'Next story',
      'Skip story',
      'Add story',
      'Add several',
      'Accept an estimate',
    ]) {
      expect(queryByRole(el, 'button', name), name).toBeNull();
    }
    expect(q('accept-open')).toBeNull();
    expect(queryByRole(el, 'button', 'Edit Login page')).toBeNull();
  });
});

describe('RoomView final estimate (F02-AC10, AC11)', () => {
  const base = () => makeStoryState(rows, { activeId: 'a' }, { round: revealed(['5', '5', '5']) });

  it('F02-AC10 only the facilitator gets the picker', () => {
    const voter = { ...base(), selfId: 'p2' };
    expect(setup(voter).q('accept-open')).toBeNull();
  });

  it('F02-AC10 quick pick shown once when consensus and median agree; ? and coffee never offered', () => {
    const { el, fixture, q } = setup(base());
    getByRole(el, 'button', 'Accept an estimate').click();
    fixture.detectChanges();
    expect(q('quickpick-consensus')?.textContent).toContain('5');
    expect(q('quickpick-median')).toBeNull();
    expect(q('accept-card-question')).toBeNull();
    expect(queryByRole(el, 'button', 'Estimate 5')).not.toBeNull();
    expect(queryByRole(el, 'button', 'Estimate question mark')).toBeNull();
    expect(queryByRole(el, 'button', 'Estimate coffee break')).toBeNull();
  });

  it('F02-AC10 median and consensus differ: both are offered', () => {
    const state = makeStoryState(rows, { activeId: 'a' }, { round: revealed(['3', '5']) });
    const { el, fixture, q } = setup(state);
    getByRole(el, 'button', 'Accept an estimate').click();
    fixture.detectChanges();
    expect(q('quickpick-consensus')).toBeNull();
    expect(q('quickpick-median')?.textContent).toContain('5');
  });

  it('F02-AC11 choosing a card and confirming sends accept_estimate with the round', async () => {
    const { el, fixture, sent } = setup(base());
    getByRole(el, 'button', 'Accept an estimate').click();
    fixture.detectChanges();
    getByRole(el, 'button', 'Estimate 8').click();
    fixture.detectChanges();
    getByRole(el, 'button', 'Accept 8').click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'accept_estimate', storyId: 'a', round: 1, estimate: '8' }]);
  });

  it('F02-AC11 stale_round keeps the picker open with a message and resyncs', async () => {
    const { el, fixture, stub } = setup(base(), () =>
      Promise.reject(new CommandError('stale_round')),
    );
    getByRole(el, 'button', 'Accept an estimate').click();
    fixture.detectChanges();
    getByRole(el, 'button', 'Estimate 8').click();
    fixture.detectChanges();
    getByRole(el, 'button', 'Accept 8').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getByRole(el, 'alert').textContent).toContain('round changed');
    expect(stub.resync).toHaveBeenCalled();
  });

  it('F02-AC11 after accepting, the facilitator can change the estimate (re-accept)', () => {
    const state = makeStoryState(
      [story('a', { estimate: '5', status: 'estimated' })],
      { activeId: 'a', acceptedRound: 1 },
      { round: revealed(['5']) },
    );
    const { el, q } = setup(state);
    expect(q('accepted-estimate')?.textContent).toContain('5');
    expect(queryByRole(el, 'button', 'Change the estimate')).not.toBeNull();
  });
});

describe('story announcements (F02-AC19)', () => {
  const snap = (activeId: string | null, extra: Partial<ReturnType<typeof snapshotOf>> = {}) => ({
    stories: true,
    activeId,
    title: activeId ? `Story ${activeId}` : null,
    acceptedRound: null,
    round: 1,
    estimate: null,
    ...extra,
  });

  it('F02-AC19 announces a new active story and idle once, and nothing at first sight', () => {
    expect(storyAnnouncement(null, snap('a'))).toBeNull();
    expect(storyAnnouncement(snap('a'), snap('b'))).toBe('Now voting: Story b');
    expect(storyAnnouncement(snap('a'), snap(null))).toBe('No story selected.');
    expect(storyAnnouncement(snap('a'), snap('a'))).toBeNull();
  });

  it('F02-AC19 announces an accepted estimate, not the same state twice', () => {
    const before = snap('a');
    const after = snap('a', { acceptedRound: 1, estimate: '8' });
    expect(storyAnnouncement(before, after)).toBe('Story a estimated 8');
    expect(storyAnnouncement(after, after)).toBeNull();
    expect(storyAnnouncement(after, snap('a', { acceptedRound: 1, estimate: '13' }))).toBe(
      'Story a estimated 13',
    );
  });

  it('F02-AC19 the live region is polite and says it once through the DOM', () => {
    const first = makeStoryState(rows, { activeId: 'a' });
    const { fixture, q } = setup(first);
    const region = q('story-announcer')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent?.trim()).toBe('');
    const next = makeStoryState(rows, { activeId: 'b', agendaVersion: 2 });
    fixture.componentRef.setInput('state', next);
    fixture.componentRef.setInput('agenda', heldFrom(next));
    fixture.detectChanges();
    expect(region.textContent?.trim()).toBe('Now voting: Search');
  });
});

describe('SettingsDialog story source (F02-AC1)', () => {
  function settings(state: RoomState, reply?: Parameters<typeof connStub>[1]) {
    const c = connStub(state, reply);
    TestBed.configureTestingModule({ providers: [c.provider] });
    const fixture = TestBed.createComponent(SettingsDialog);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = getByRole(el, 'combobox', 'What you estimate') as HTMLSelectElement;
    const choose = (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      fixture.detectChanges();
    };
    return { fixture, el, choose, select, ...c };
  }

  it('F02-AC1 switching without votes applies immediately', async () => {
    const { choose, sent, fixture } = settings(makeState());
    choose('stories');
    await fixture.whenStable();
    expect(sent).toEqual([
      { type: 'update_settings', settings: { storySource: 'stories' }, confirmReset: false },
    ]);
  });

  it('F02-AC1 with an unsaved round it asks first; Cancel changes nothing, OK sends confirmReset', async () => {
    const state = makeState({
      participants: [participant('p1', { hasVoted: true }), participant('p2')],
      myVote: '5',
    });
    const { choose, sent, fixture, el, select } = settings(state);
    choose('stories');
    expect(el.querySelector('[data-testid=mode-switch-confirm-ok]')).not.toBeNull();
    (el.querySelector('[data-testid=mode-switch-confirm-cancel]') as HTMLElement).click();
    fixture.detectChanges();
    expect(sent).toEqual([]);
    expect(select.value).toBe('topic');
    choose('stories');
    (el.querySelector('[data-testid=mode-switch-confirm-ok]') as HTMLElement).click();
    await fixture.whenStable();
    expect(sent).toEqual([
      { type: 'update_settings', settings: { storySource: 'stories' }, confirmReset: true },
    ]);
  });

  it('F02-AC1 a server confirmation_required (race) opens the same dialog', async () => {
    const { choose, fixture, el } = settings(makeState(), () =>
      Promise.reject(new CommandError('confirmation_required', 'confirmReset')),
    );
    choose('stories');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid=mode-switch-confirm-ok]')).not.toBeNull();
  });

  it('F02-AC1 only Free topic and Story list are offered', () => {
    const { select } = settings(makeState());
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Free topic',
      'Story list',
    ]);
  });
});
