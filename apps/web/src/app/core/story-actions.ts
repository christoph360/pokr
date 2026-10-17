import { Injectable, inject, signal } from '@angular/core';
import { isRoundUnsaved } from '@pokr/shared';
import type { AgendaStory } from '@pokr/shared';
import { STRINGS } from '../i18n/strings';
import { CommandError, RoomConnection } from './room-connection';
import type { CommandInput } from './room-connection';

export type ActionResult = { ok: true } | { ok: false; code: string; field?: string };

/** Commands that can need the user's confirmation before the server applies them. */
export type ConfirmKind = 'select' | 'next' | 'skip' | 'skipNext' | 'delete';

/** What the confirmation dialog asks about. `needs*` are the acknowledgements to send on OK. */
export interface ConfirmRequest {
  kind: ConfirmKind;
  /** Null for `next`. */
  storyId: string | null;
  title: string;
  estimate: string | null;
  isActive: boolean;
  needsReset: boolean;
  needsDelete: boolean;
}

/** Error codes after which the held agenda may be out of date. */
const RESYNC_CODES = new Set(['stale_round', 'unknown_story', 'wrong_story_source']);

/**
 * The facilitator's story commands (F02-AC4, AC7, AC9, AC11, AC13) in one place. It decides when a
 * confirmation is needed (`isRoundUnsaved`, an estimated story), also when the server asks for one
 * after a race (`confirmation_required`), sends the round id where the contract wants it, and
 * resyncs on `stale_round`. Components bind to `confirm` and `error`.
 */
@Injectable({ providedIn: 'root' })
export class StoryActions {
  private readonly conn = inject(RoomConnection);

  /** The command waiting for the user's confirmation, if any. */
  readonly confirm = signal<ConfirmRequest | null>(null);
  /** Localized text of the last failed command, shown in an alert. */
  readonly error = signal<string | null>(null);
  /** Facilitator-side confirmations for the polite agenda live region ("3 stories added."). */
  readonly announcement = signal('');

  /** Send a command and map failures to a result; resyncs when the agenda may be stale. */
  async run(command: CommandInput): Promise<ActionResult> {
    try {
      await this.conn.send(command);
      return { ok: true };
    } catch (error) {
      const code = error instanceof CommandError ? error.code : 'internal_error';
      const field = error instanceof CommandError ? error.field : undefined;
      if (RESYNC_CODES.has(code)) this.conn.resync();
      return field === undefined ? { ok: false, code } : { ok: false, code, field };
    }
  }

  fail(code: string): void {
    this.error.set(STRINGS.errors[code] ?? STRINGS.errors['internal_error'] ?? null);
  }

  clearError(): void {
    this.error.set(null);
  }

  // ---- voting a story ----

  select(story: AgendaStory): void {
    const state = this.conn.state();
    if (!state || story.id === state.stories.activeId) return;
    const needsReset = isRoundUnsaved(state);
    this.start(this.request('select', story, state.stories.activeId, needsReset, false));
  }

  next(): void {
    const state = this.conn.state();
    if (!state) return;
    const needsReset = isRoundUnsaved(state);
    this.start({
      kind: 'next',
      storyId: null,
      title: '',
      estimate: null,
      isActive: false,
      needsReset,
      needsDelete: false,
    });
  }

  skip(story: AgendaStory, advance: boolean): void {
    const state = this.conn.state();
    if (!state) return;
    const isActive = story.id === state.stories.activeId;
    const needsReset = isActive && isRoundUnsaved(state);
    this.start(
      this.request(advance ? 'skipNext' : 'skip', story, state.stories.activeId, needsReset, false),
    );
  }

  remove(story: AgendaStory): void {
    const state = this.conn.state();
    if (!state) return;
    const isActive = story.id === state.stories.activeId;
    this.start(
      this.request(
        'delete',
        story,
        state.stories.activeId,
        isActive && isRoundUnsaved(state),
        story.status === 'estimated',
      ),
    );
  }

  async restore(story: AgendaStory): Promise<void> {
    this.error.set(null);
    const result = await this.run({ type: 'restore_story', storyId: story.id });
    if (result.ok) this.announcement.set(STRINGS.stories.restored(story.title));
    else this.fail(result.code);
  }

  /** Accept `card` as the final estimate of the active story in the current round (F02-AC10/AC11). */
  async accept(storyId: string, card: string): Promise<ActionResult> {
    const state = this.conn.state();
    if (!state) return { ok: false, code: 'disconnected' };
    return this.run({
      type: 'accept_estimate',
      storyId,
      round: state.round.number,
      estimate: card,
    });
  }

  confirmOk(): void {
    const request = this.confirm();
    this.confirm.set(null);
    if (request) void this.attempt(request, request.needsReset, request.needsDelete);
  }

  confirmCancel(): void {
    this.confirm.set(null);
  }

  // ---- internals ----

  private request(
    kind: ConfirmKind,
    story: AgendaStory,
    activeId: string | null,
    needsReset: boolean,
    needsDelete: boolean,
  ): ConfirmRequest {
    return {
      kind,
      storyId: story.id,
      title: story.title,
      estimate: story.estimate,
      isActive: story.id === activeId,
      needsReset,
      needsDelete,
    };
  }

  /** Ask first when the client already knows a confirmation is needed; otherwise just send. */
  private start(request: ConfirmRequest): void {
    this.error.set(null);
    if (request.needsReset || request.needsDelete) this.confirm.set(request);
    else void this.attempt(request, false, false);
  }

  private async attempt(
    request: ConfirmRequest,
    confirmReset: boolean,
    confirmDelete: boolean,
  ): Promise<void> {
    const state = this.conn.state();
    if (!state) return;
    // `confirmDelete` exists on delete_story only; the other commands take `confirmReset`.

    const round = state.round.number;
    const id = request.storyId ?? '';
    let command: CommandInput;
    switch (request.kind) {
      case 'select':
        command = { type: 'select_story', storyId: id, confirmReset };
        break;
      case 'next':
        command = { type: 'next_story', round, confirmReset };
        break;
      case 'skip':
      case 'skipNext':
        command = {
          type: 'skip_story',
          storyId: id,
          round,
          advance: request.kind === 'skipNext',
          confirmReset,
        };
        break;
      case 'delete':
        command = {
          type: 'delete_story',
          storyId: id,
          confirmReset,
          confirmDelete,
        };
        break;
    }
    const result = await this.run(command);
    if (result.ok) {
      if (request.kind === 'delete') {
        this.announcement.set(STRINGS.stories.deleted(request.title));
      } else if (request.kind === 'skip' || request.kind === 'skipNext') {
        this.announcement.set(STRINGS.stories.skipped(request.title));
      }
      return;
    }
    // The server saw something the client did not (a vote, an estimate): ask now, then retry.
    if (result.code === 'confirmation_required') {
      this.confirm.set({
        ...request,
        needsReset: request.needsReset || result.field === 'confirmReset',
        needsDelete:
          request.kind === 'delete' && (request.needsDelete || result.field === 'confirmDelete'),
      });
      return;
    }
    this.fail(result.code);
  }
}
