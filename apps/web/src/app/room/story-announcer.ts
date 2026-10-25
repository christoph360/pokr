import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { HeldAgenda, RoomState } from '@pokr/shared';
import { STRINGS } from '../i18n/strings';

interface Snapshot {
  stories: boolean;
  activeId: string | null;
  title: string | null;
  acceptedRound: number | null;
  round: number;
  estimate: string | null;
}

export function snapshotOf(state: RoomState, agenda: HeldAgenda | null): Snapshot {
  const activeId = state.stories.activeId;
  const row = activeId === null ? undefined : agenda?.rows.find((r) => r.id === activeId);
  return {
    stories: state.settings.storySource === 'stories',
    activeId,
    title: row?.title ?? null,
    acceptedRound: state.stories.acceptedRound,
    round: state.round.number,
    estimate: row?.estimate ?? null,
  };
}

/** What to announce for a change of the active story or an accepted estimate (F02-AC19), or null. */
export function storyAnnouncement(prev: Snapshot | null, next: Snapshot): string | null {
  const t = STRINGS.stories;
  if (!prev || !prev.stories || !next.stories) return null;
  if (prev.activeId !== next.activeId) {
    if (next.activeId === null) return t.nowIdle;
    return next.title === null ? null : t.nowVoting(next.title);
  }
  const accepted = next.acceptedRound !== null && next.acceptedRound === next.round;
  const changed = prev.acceptedRound !== next.acceptedRound || prev.estimate !== next.estimate;
  if (accepted && changed && next.title !== null && next.estimate !== null) {
    return t.estimateAccepted(next.title, next.estimate);
  }
  return null;
}

/** Polite live region for active-story changes and accepted estimates, once each. */
@Component({
  selector: 'app-story-announcer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="visually-hidden" role="status" aria-live="polite" data-testid="story-announcer">
      {{ text() }}
    </div>
  `,
})
export class StoryAnnouncer {
  readonly state = input.required<RoomState>();
  readonly agenda = input.required<HeldAgenda | null>();
  protected readonly text = signal('');
  private previous: Snapshot | null = null;

  constructor() {
    effect(() => {
      const next = snapshotOf(this.state(), this.agenda());
      untracked(() => {
        const said = storyAnnouncement(this.previous, next);
        this.previous = next;
        if (said !== null) this.text.set(said);
      });
    });
  }
}
