import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RoomApi } from '../core/room-api';
import type { CreateRoomResult } from '../core/room-api';
import { TokenStore } from '../core/token-store';
import { StartPage } from './start-page';

describe('StartPage', () => {
  let created: unknown[];
  let result: CreateRoomResult;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    created = [];
    result = {
      ok: true,
      data: { roomId: 'abcdefghjkmnpqrs', participantId: 'p1', token: 't'.repeat(40) },
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: RoomApi,
          useValue: {
            createRoom: (req: unknown) => {
              created.push(req);
              return Promise.resolve(result);
            },
          },
        },
      ],
    });
  });

  function render() {
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StartPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
    const type = async (id: string, value: string) => {
      const input = q<HTMLInputElement>(id)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    const submit = async () => {
      q('start-create')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, q, type, submit };
  }

  it('F01-AC4 requires a name: empty and whitespace-only show an inline error and nothing is sent', async () => {
    const { q, type, submit } = render();
    await submit();
    expect(q('start-name-error')?.textContent).toContain('Enter a name');
    await type('start-name', '   ');
    await submit();
    expect(q('start-name-error')).not.toBeNull();
    expect(created).toEqual([]);
  });

  it('F01-AC4 rejects names over 30 characters, counting graphemes', async () => {
    const { q, type, submit } = render();
    await type('start-name', '👩‍👩‍👧‍👦'.repeat(30));
    await submit();
    expect(q('start-name-error')).toBeNull();
    created.length = 0;
    await type('start-name', 'x'.repeat(31));
    await submit();
    expect(q('start-name-error')?.textContent).toContain('at most 30');
  });

  it('F01-AC3 room name over 80 is invalid; empty falls back to the default name', async () => {
    const { q, type, submit } = render();
    await type('start-name', 'Alex');
    await type('start-room-name', 'r'.repeat(81));
    await submit();
    expect(q('start-room-name-error')).not.toBeNull();
    await type('start-room-name', '   ');
    await submit();
    const req = created[0] as { settings: { name: string } };
    expect(req.settings.name).toBe('Planning session');
  });

  it('F01-AC1 creates the room with normalized input, stores the token and navigates', async () => {
    const { type, submit, fixture } = render();
    await type('start-name', '  Alex   B ');
    await submit();
    expect(created[0]).toMatchObject({
      displayName: 'Alex B',
      settings: {
        deck: { id: 'fibonacci' },
        controlMode: 'facilitator',
        autoReveal: false,
        facilitatorVotes: true,
      },
    });
    expect(TestBed.inject(TokenStore).get('abcdefghjkmnpqrs')).toBe('t'.repeat(40));
    expect(navigate).toHaveBeenCalledWith(['/r', 'abcdefghjkmnpqrs']);
    fixture.destroy();
  });

  it('F01-AC34 a custom deck shows an inline error and blocks creation until valid', async () => {
    const { q, type, submit } = render();
    await type('start-name', 'Alex');
    const deck = q<HTMLSelectElement>('start-deck')!;
    deck.value = 'custom';
    deck.dispatchEvent(new Event('change'));
    await submit();
    expect(q('start-custom-deck-error')).not.toBeNull();
    await type('start-custom-deck', '1, 2, ?');
    await submit();
    expect(q('start-custom-deck-error')?.textContent).toContain('added automatically');
    expect(created).toEqual([]);
    await type('start-custom-deck', '1, 2, 4');
    await submit();
    expect(created[0]).toMatchObject({
      settings: { deck: { id: 'custom', cards: ['1', '2', '4'] } },
    });
  });

  it('F01-AC34 an empty segment, including a trailing comma, is an inline error', async () => {
    const { q, type, submit, fixture } = render();
    await type('start-name', 'Alex');
    const deck = q<HTMLSelectElement>('start-deck')!;
    deck.value = 'custom';
    deck.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await type('start-custom-deck', 'a, , b');
    await submit();
    expect(q('start-custom-deck-error')?.textContent).toContain('Card 2 is empty');
    await type('start-custom-deck', '1, 2,');
    await submit();
    expect(q('start-custom-deck-error')?.textContent).toContain('Card 3 is empty');
    expect(created).toEqual([]);
  });

  it('F01-AC37 a rate limit answer is shown as an alert', async () => {
    result = { ok: false, code: 'rate_limited', retryAfterMs: 12_000 };
    const { q, type, submit } = render();
    await type('start-name', 'Alex');
    await submit();
    expect(q('start-error')?.textContent).toContain('12 seconds');
  });
});
