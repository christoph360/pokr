import { signal } from '@angular/core';
import { moveStory, moveTarget } from '@pokr/shared';
import type { MoveDirection } from '@pokr/shared';

export interface MoveOutcome {
  /** False when the story is unknown or already at that edge: nothing queued. */
  changed: boolean;
  /** 1-based position in the order the user now sees. */
  position: number;
  total: number;
}

export interface MoveQueueOptions {
  /** Quiet time after the last key press before the move is sent. */
  delayMs: number;
  /** Send one `move_story`. Resolves true when the server accepted it. */
  send: (storyId: string, beforeId: string | null) => Promise<boolean>;
  /** Called after a send failed; the local order has been dropped by then. */
  failed: () => void;
}

/**
 * Optimistic, coalescing reorder (F02-AC4, AC20). A key press changes the local order at once, so
 * focus and the announcement follow the story; the server gets one `move_story` per moved story
 * once the presses stop, anchored on the story that ended up right behind it (`beforeId`), so
 * 25 quick presses cost one message and stay correct if others reorder meanwhile.
 */
export class MoveQueue {
  /** Order of story ids while moves are queued or in flight; null shows the server's order. */
  readonly order = signal<string[] | null>(null);

  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;

  constructor(private readonly options: MoveQueueOptions) {}

  /** Keyboard / button move by one step or to an edge. */
  step(serverIds: readonly string[], storyId: string, direction: MoveDirection): MoveOutcome {
    const list = this.order() ?? [...serverIds];
    const items = list.map((id) => ({ id }));
    const target = moveTarget(items, storyId, direction);
    if (target === undefined) {
      return { changed: false, position: list.indexOf(storyId) + 1, total: list.length };
    }
    return this.apply(list, storyId, target, false);
  }

  /** Drag and drop: move `storyId` before `beforeId` (null = end) and send without waiting. */
  drop(serverIds: readonly string[], storyId: string, beforeId: string | null): MoveOutcome {
    const list = this.order() ?? [...serverIds];
    return this.apply(list, storyId, beforeId, true);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private apply(
    list: readonly string[],
    storyId: string,
    beforeId: string | null,
    immediate: boolean,
  ): MoveOutcome {
    const next = moveStory(
      list.map((id) => ({ id })),
      storyId,
      beforeId,
    );
    if (next === null)
      return { changed: false, position: list.indexOf(storyId) + 1, total: list.length };
    const ids = next.map((s) => s.id);
    const changed = ids.some((id, i) => id !== list[i]);
    if (changed) {
      this.order.set(ids);
      this.dirty.add(storyId);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), immediate ? 0 : this.options.delayMs);
    }
    return { changed, position: ids.indexOf(storyId) + 1, total: ids.length };
  }

  private async flush(): Promise<void> {
    this.timer = undefined;
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.dirty.size > 0) {
        const [storyId] = this.dirty;
        this.dirty.delete(storyId as string);
        const ids = this.order();
        if (!ids) break;
        const at = ids.indexOf(storyId as string);
        if (at < 0) continue;
        const ok = await this.options.send(storyId as string, ids[at + 1] ?? null);
        if (!ok) {
          this.dirty.clear();
          this.order.set(null);
          this.options.failed();
          return;
        }
      }
      // Moves queued while the last one was in flight keep their own timer.
      if (this.timer === undefined) this.order.set(null);
    } finally {
      this.flushing = false;
    }
  }
}
