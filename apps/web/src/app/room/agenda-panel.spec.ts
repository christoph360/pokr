import { TestBed } from '@angular/core/testing';
import type { RoomState } from '@pokr/shared';
import { MAX_STORIES } from '@pokr/shared';
import { connStub } from '../testing/conn-stub';
import { getByRole, queryAllByRole, queryByRole, typeInto } from '../testing/dom';
import { heldFrom, makeStoryState, participant, story } from '../testing/fixtures';
import { AgendaPanel } from './agenda-panel';

const rows = [
  story('a', { title: 'Login page' }),
  story('b', { title: 'Search', status: 'estimated', estimate: '5' }),
  story('c', { title: 'Export', status: 'skipped' }),
  story('d', { title: 'Billing', hasDescription: true }),
];

function setup(state: RoomState, { manage = true } = {}) {
  const c = connStub(state);
  TestBed.configureTestingModule({ providers: [c.provider] });
  const fixture = TestBed.createComponent(AgendaPanel);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('agenda', heldFrom(state));
  fixture.componentRef.setInput('canManage', manage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string | RegExp) => getByRole(el, 'button', name);
  const rowEl = (id: string) => el.querySelector<HTMLElement>(`li[data-story-id="${id}"]`)!;
  return { fixture, el, button, rowEl, ...c };
}

const stateWith = (r = rows, activeId: string | null = 'a', overrides: Partial<RoomState> = {}) =>
  makeStoryState(r, { activeId }, overrides);

describe('AgendaPanel view', () => {
  it('F02-AC14 lists stories with status text, estimate and progress', () => {
    const { el, rowEl } = setup(stateWith());
    expect(queryAllByRole(el, 'listitem').filter((li) => li.dataset['storyId'])).toHaveLength(4);
    expect(rowEl('a').textContent).toContain('Active');
    expect(rowEl('a').getAttribute('aria-current')).toBe('true');
    expect(rowEl('b').textContent).toContain('Estimated');
    expect(rowEl('b').querySelector('[data-testid=story-estimate]')?.textContent).toBe('5');
    expect(rowEl('c').textContent).toContain('Skipped');
    expect(rowEl('d').textContent).toContain('Pending');
    expect(el.querySelector('[data-testid=agenda-progress]')?.textContent).toBe(
      '1 of 3 estimated, 1 skipped',
    );
  });

  it('F02-AC14 an empty agenda says "No stories yet"', () => {
    const { el } = setup(stateWith([], null));
    expect(el.querySelector('[data-testid=agenda-progress]')?.textContent).toBe('No stories yet');
    expect(queryByRole(el, 'list', 'Stories')).toBeNull();
  });

  it('F02-AC12 a re-voted story is active and keeps its estimate, marked re-voting', () => {
    const { rowEl } = setup(stateWith(rows, 'b'));
    const b = rowEl('b');
    expect(b.dataset['status']).toBe('active');
    expect(b.dataset['estimate']).toBe('5');
    expect(b.textContent).toContain('Re-voting');
  });

  it('F02-AC15 shows the sum and the number of estimates not counted', () => {
    const state = stateWith();
    state.stories = { ...state.stories, sum: { value: '34', excluded: 2 } };
    const { el } = setup(state);
    expect(el.querySelector('[data-testid=agenda-sum]')?.textContent).toContain('34');
    expect(el.querySelector('[data-testid=agenda-sum-excluded]')?.textContent).toContain(
      '2 estimates not counted',
    );
    TestBed.resetTestingModule();
    const noSum = stateWith();
    noSum.stories = { ...noSum.stories, sum: { value: null, excluded: 0 } };
    const none = setup(noSum);
    expect(none.el.querySelector('[data-testid=agenda-sum]')).toBeNull();
  });

  it('F02-AC19 the mobile toggle exposes expanded state', () => {
    const { button, fixture } = setup(stateWith());
    const toggle = button(/^Agenda \(/);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('AgendaPanel permissions', () => {
  it('F02-AC6 a voter gets no management controls, only the read-only detail buttons', () => {
    const { el } = setup(stateWith(rows, 'a', { selfId: 'p2' }), { manage: false });
    const names = queryAllByRole(el, 'button').map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    );
    expect(
      names.some((n) => /Edit|Delete|Move|Skip|Vote|Add story|Add several/.test(String(n))),
    ).toBe(false);
    expect(queryByRole(el, 'button', 'Last round of Search')).not.toBeNull();
    expect(queryByRole(el, 'button', 'Details of Billing')).not.toBeNull();
  });

  it('F02-AC6 the facilitator sees the actions for each row, by story title', () => {
    const { el } = setup(stateWith());
    for (const name of [
      'Edit Login page',
      'Delete Login page',
      'Move Login page down',
      'Skip Login page',
      'Vote on Search'.replace('Vote on', 'Re-vote'),
      'Restore Export to pending',
      'Vote on Billing',
    ]) {
      expect(queryByRole(el, 'button', name), name).not.toBeNull();
    }
    // The active story cannot be selected again.
    expect(queryByRole(el, 'button', 'Vote on Login page')).toBeNull();
  });

  it('F02-AC1 in Free topic mode select and skip are not offered, edit and move still are', () => {
    const state = stateWith();
    state.settings = { ...state.settings, storySource: 'topic' };
    const { el } = setup(state);
    expect(queryByRole(el, 'button', 'Vote on Billing')).toBeNull();
    expect(queryByRole(el, 'button', 'Skip Billing')).toBeNull();
    expect(queryByRole(el, 'button', 'Edit Billing')).not.toBeNull();
    expect(queryByRole(el, 'button', 'Move Billing up')).not.toBeNull();
  });
});

describe('AgendaPanel commands', () => {
  it('F02-AC7 Vote on a story sends select_story', async () => {
    const { button, sent, fixture } = setup(stateWith());
    button('Vote on Billing').click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'select_story', storyId: 'd', confirmReset: false }]);
  });

  it('F02-AC13 Skip and Restore send skip_story and restore_story', async () => {
    const { button, sent, fixture } = setup(stateWith());
    button('Skip Billing').click();
    button('Restore Export to pending').click();
    await fixture.whenStable();
    expect(sent).toEqual([
      { type: 'skip_story', storyId: 'd', round: 1, advance: false, confirmReset: false },
      { type: 'restore_story', storyId: 'c' },
    ]);
  });

  it('F02-AC5 at 200 stories the add controls are disabled and the limit is explained', () => {
    const many = Array.from({ length: MAX_STORIES }, (_, i) => story(`s${i}`));
    const { el, button } = setup(stateWith(many, null));
    expect(button('Add story').getAttribute('aria-disabled')).toBe('true');
    expect(button('Add several').getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[data-testid=story-limit-notice]')?.textContent).toContain('200');
    button('Add story').click();
    expect(queryByRole(el, 'textbox', 'Title')).toBeNull();
  });
});

describe('AgendaPanel reorder (F02-AC4, AC19, AC20)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('F02-AC19 the first row cannot move up and the last cannot move down', () => {
    const { button } = setup(stateWith());
    expect(button('Move Login page up').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move Login page to the top').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move Billing down').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move Search up').getAttribute('aria-disabled')).toBeNull();
  });

  it('F02-AC4 clicking Move down reorders at once, announces the position and sends one move_story', async () => {
    const { fixture, el, button, sent } = setup(stateWith());
    button('Move Login page down').click();
    fixture.detectChanges();
    const order = () =>
      Array.from(el.querySelectorAll<HTMLElement>('li[data-story-id]')).map(
        (li) => li.dataset['storyId'],
      );
    expect(order()).toEqual(['b', 'a', 'c', 'd']);
    expect(el.querySelector('[data-testid=agenda-announcer]')?.textContent).toContain(
      'Login page moved to position 2 of 4',
    );
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([{ type: 'move_story', storyId: 'a', beforeId: 'c' }]);
  });

  it('F02-AC19 focus stays on the moved story control after the list re-renders', async () => {
    const { fixture, button } = setup(stateWith());
    const down = button('Move Login page down');
    down.focus();
    down.click();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
    expect(document.activeElement).toBe(button('Move Login page down'));
    expect(document.activeElement?.closest('li')?.dataset['storyId']).toBe('a');
  });

  it('F02-AC20 25 quick presses send a single message', async () => {
    const { fixture, button, sent } = setup(stateWith());
    for (let i = 0; i < 25; i++) {
      const name = i % 2 === 0 ? 'Move Billing up' : 'Move Billing down';
      button(name).click();
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.filter((c) => c.type === 'move_story')).toHaveLength(1);
  });

  it('F02-AC19 a press at the edge announces "already first" without sending', async () => {
    const { el, button, sent } = setup(stateWith());
    button('Move Login page up').click();
    await vi.advanceTimersByTimeAsync(400);
    expect(el.querySelector('[data-testid=agenda-announcer]')?.textContent).toContain(
      'already first',
    );
    expect(sent).toEqual([]);
  });
});

describe('AgendaPanel keyboard (F02-AC19)', () => {
  it('F02-AC19 the whole list is one tab stop and arrow keys move between actions', () => {
    const { el, button } = setup(stateWith());
    const stops = queryAllByRole(el, 'button').filter(
      (b) => b.dataset['key'] && b.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    const first = stops[0]!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.closest('li')).toBe(first.closest('li'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement?.closest('li')).not.toBe(first.closest('li'));
    expect(button('Edit Login page')).toBeTruthy();
  });
});

describe('AgendaPanel add and edit forms', () => {
  it('F02-AC2 the add form validates inline, then sends the story and closes', async () => {
    const { fixture, el, button, sent } = setup(stateWith());
    button('Add story').click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-add-dialog]')!;
    getByRole(dialog, 'button', 'Add story').click();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('Enter a title.');
    expect(sent).toEqual([]);

    typeInto(getByRole(dialog, 'textbox', 'Title'), '  New   story ');
    typeInto(getByRole(dialog, 'textbox', 'Description (optional, Markdown)'), 'Some *text*');
    typeInto(getByRole(dialog, 'textbox', 'Link (optional)'), 'javascript:alert(1)');
    getByRole(dialog, 'button', 'Add story').click();
    fixture.detectChanges();
    expect(dialog.textContent).toContain('http or https');
    expect(sent).toEqual([]);

    typeInto(getByRole(dialog, 'textbox', 'Link (optional)'), 'https://tracker.example/12');
    getByRole(dialog, 'button', 'Add story').click();
    await fixture.whenStable();
    expect(sent).toEqual([
      {
        type: 'add_story',
        title: 'New story',
        description: 'Some *text*',
        link: 'https://tracker.example/12',
      },
    ]);
  });

  it('F02-AC6 a not_allowed answer keeps the dialog open with the typed text', async () => {
    const state = stateWith();
    const c = connStub(state, () => Promise.reject(Object.assign(new Error('x'), {})));
    TestBed.configureTestingModule({ providers: [c.provider] });
    const { CommandError } = await import('../core/room-connection');
    c.stub.send = () => Promise.reject(new CommandError('not_allowed'));
    const fixture = TestBed.createComponent(AgendaPanel);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('agenda', heldFrom(state));
    fixture.componentRef.setInput('canManage', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    getByRole(el, 'button', 'Add story').click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-add-dialog]')!;
    typeInto(getByRole(dialog, 'textbox', 'Title'), 'Keep me');
    getByRole(dialog, 'button', 'Add story').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getByRole(dialog, 'alert').textContent).toContain('not allowed');
    expect((getByRole(dialog, 'textbox', 'Title') as HTMLInputElement).value).toBe('Keep me');
  });

  it('F02-AC4 edit sends only the changed fields', async () => {
    const { fixture, el, button, sent } = setup(stateWith());
    button('Edit Login page').click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-edit-dialog]')!;
    const title = getByRole(dialog, 'textbox', 'Title') as HTMLInputElement;
    expect(title.value).toBe('Login page');
    typeInto(title, 'Login screen');
    getByRole(dialog, 'button', 'Save story').click();
    await fixture.whenStable();
    expect(sent).toEqual([{ type: 'edit_story', storyId: 'a', title: 'Login screen' }]);
  });
});

describe('AgendaPanel bulk add', () => {
  it('F02-AC3 previews the count, sends the raw text, and keeps it when the server says no', async () => {
    const state = stateWith();
    const { CommandError } = await import('../core/room-connection');
    const c = connStub(state);
    c.stub.send = (cmd) => {
      c.sent.push(cmd);
      return Promise.reject(new CommandError('invalid_input', 'text.2'));
    };
    TestBed.configureTestingModule({ providers: [c.provider] });
    const fixture = TestBed.createComponent(AgendaPanel);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('agenda', heldFrom(state));
    fixture.componentRef.setInput('canManage', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    getByRole(el, 'button', 'Add several').click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-bulk-dialog]')!;
    const box = getByRole(dialog, 'textbox', 'Stories, one title per line') as HTMLTextAreaElement;
    typeInto(box, 'One\n\n  \nTwo\nThree\n');
    fixture.detectChanges();
    expect(dialog.querySelector('[data-testid=story-bulk-preview]')?.textContent).toContain(
      '3 stories will be added',
    );
    getByRole(dialog, 'button', 'Add 3 stories').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.sent).toEqual([{ type: 'add_stories', text: 'One\n\n  \nTwo\nThree\n' }]);
    expect(dialog.querySelector('[data-testid=story-bulk-error]')?.textContent).toContain('Line 2');
    expect(box.value).toBe('One\n\n  \nTwo\nThree\n');
  });

  it('F02-AC3 a too long line is shown with its number and nothing is sent', async () => {
    const { fixture, el, button, sent } = setup(stateWith());
    button('Add several').click();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-bulk-dialog]')!;
    typeInto(getByRole(dialog, 'textbox', 'Stories, one title per line'), `ok\n${'x'.repeat(201)}`);
    fixture.detectChanges();
    expect(dialog.querySelector('[data-testid=story-bulk-error]')?.textContent).toContain('Line 2');
    getByRole(dialog, 'button', /^Add/).click();
    await fixture.whenStable();
    expect(sent).toEqual([]);
  });
});

describe('AgendaPanel details', () => {
  it('F02-AC11 Last round loads fresh and shows "Removed participant" for a null name', async () => {
    const state = stateWith();
    const c = connStub(state);
    c.stories.set('b', {
      ...rows[1]!,
      description: '**Notes**',
      finalRound: {
        number: 1,
        votes: [
          { participantId: 'p1', name: 'Alex', card: '5' },
          { participantId: 'gone', name: null, card: '8' },
        ],
      },
    });
    TestBed.configureTestingModule({ providers: [c.provider] });
    const fixture = TestBed.createComponent(AgendaPanel);
    fixture.componentRef.setInput('state', state);
    fixture.componentRef.setInput('agenda', heldFrom(state));
    fixture.componentRef.setInput('canManage', false);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    getByRole(el, 'button', 'Last round of Search').click();
    await fixture.whenStable();
    fixture.detectChanges();
    const dialog = el.querySelector<HTMLElement>('[data-testid=story-history]')!;
    expect(dialog.textContent).toContain('Alex');
    expect(dialog.textContent).toContain('Removed participant');
    expect(dialog.querySelector('strong')?.textContent).toBe('Notes');
    expect(participant('x').id).toBe('x');
  });
});
