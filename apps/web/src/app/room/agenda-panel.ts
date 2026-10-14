import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CdkDrag, CdkDragPlaceholder, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { MAX_STORIES, displayStatus } from '@pokr/shared';
import type {
  AgendaStory,
  DisplayStatus,
  HeldAgenda,
  MoveDirection,
  RoomState,
} from '@pokr/shared';
import { MoveQueue } from '../core/move-queue';
import { RoomConnection } from '../core/room-connection';
import { StoryActions } from '../core/story-actions';
import { orderRows, progressText, statusLabel } from '../core/story-logic';
import { STRINGS } from '../i18n/strings';
import { BulkAddDialog } from './bulk-add-dialog';
import { StoryDetailDialog } from './story-detail-dialog';
import { StoryFormDialog } from './story-form-dialog';

type ActionId = 'select' | 'skip' | 'restore' | 'edit' | 'delete' | MoveDirection | 'details';

interface RowAction {
  id: ActionId;
  /** `<story id>:<action>`: identity of the roving-tabindex stop. */
  key: string;
  testid: string;
  /** Visible text; empty for glyph-only buttons. */
  text: string;
  glyph: string;
  /** Accessible name, always contains the story title. */
  name: string;
  disabled: boolean;
}

interface RowView {
  row: AgendaStory;
  status: DisplayStatus;
  statusText: string;
  revoting: boolean;
  actions: RowAction[];
}

/** Wait this long after the last key press before a move is sent (F02-AC20). */
const MOVE_DELAY_MS = 300;

/**
 * The agenda (F02-AC1, AC4, AC14, AC15, AC19): rows with status text and estimate, progress and
 * sum, and for the facilitator add, bulk add, edit, delete, select, skip, restore and reorder.
 *
 * One tab stop for the whole list: row actions use a roving tabindex (arrow keys move between
 * actions and rows). Reordering works by drag and drop and by always-visible move buttons; the
 * focus follows the moved story and the new position is announced. Repeated key presses are
 * coalesced by `MoveQueue`.
 */
@Component({
  selector: 'app-agenda-panel',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    CdkDropList,
    StoryFormDialog,
    BulkAddDialog,
    StoryDetailDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)', '(focusin)': 'onFocusIn($event)' },
  template: `
    <section
      class="agenda"
      data-testid="agenda"
      [attr.data-expanded]="expanded()"
      aria-labelledby="agenda-heading"
    >
      <h3 id="agenda-heading" class="agenda__heading">{{ t.agendaHeading }}</h3>
      <button
        type="button"
        class="btn btn--small agenda__toggle"
        data-testid="agenda-toggle"
        aria-controls="agenda-body"
        [attr.aria-expanded]="expanded()"
        (click)="expanded.set(!expanded())"
      >
        {{ t.agendaToggle(progress()) }}
      </button>
      <div id="agenda-body" class="agenda__body">
        <p class="agenda__progress" data-testid="agenda-progress">{{ progress() }}</p>
        @if (sumText(); as sum) {
          <p class="agenda__sum" data-testid="agenda-sum">{{ sum }}</p>
        }
        @if (state().stories.sum.excluded > 0) {
          <p class="agenda__excluded" data-testid="agenda-sum-excluded">
            {{ t.excluded(state().stories.sum.excluded) }}
          </p>
        }

        @if (canManage()) {
          <div class="agenda__add" role="group" [attr.aria-label]="t.add">
            <button
              type="button"
              class="btn btn--small"
              data-testid="story-add"
              [attr.aria-disabled]="full() || !connected() ? 'true' : null"
              (click)="openAdd()"
            >
              {{ t.add }}
            </button>
            <button
              type="button"
              class="btn btn--small"
              data-testid="story-bulk-open"
              [attr.aria-disabled]="full() || !connected() ? 'true' : null"
              (click)="openBulk()"
            >
              {{ t.bulkOpen }}
            </button>
            <span class="muted" data-testid="story-count">{{ t.count(rows().length, max) }}</span>
          </div>
          @if (full()) {
            <p class="hint" data-testid="story-limit-notice">{{ t.limitReached(max) }}</p>
          }
        }

        @if (views().length === 0) {
          @if (canManage()) {
            <p class="hint">{{ t.noStoriesHint }}</p>
          }
        } @else {
          @if (hasActions()) {
            <p id="agenda-keys" class="hint">{{ t.agendaHint }}</p>
          }
          <ul
            class="agenda__list"
            data-testid="agenda-list"
            [attr.aria-label]="t.agendaList"
            [attr.aria-describedby]="hasActions() ? 'agenda-keys' : null"
            cdkDropList
            cdkDropListLockAxis="y"
            [cdkDropListDisabled]="!canManage()"
            (cdkDropListDropped)="onDrop($event)"
          >
            @for (view of views(); track view.row.id) {
              <li
                class="story"
                cdkDrag
                cdkDragLockAxis="y"
                [cdkDragDisabled]="!canManage()"
                data-testid="story-row"
                [attr.data-story-id]="view.row.id"
                [attr.data-status]="view.status"
                [attr.data-active]="view.status === 'active'"
                [attr.data-estimate]="view.row.estimate"
                [attr.aria-current]="view.status === 'active' ? 'true' : null"
              >
                <div class="story__placeholder" *cdkDragPlaceholder></div>
                <div class="story__head">
                  @if (canManage()) {
                    <span class="story__handle" aria-hidden="true" cdkDragHandle>⋮⋮</span>
                  }
                  <span class="story__title" data-testid="story-title">{{ view.row.title }}</span>
                </div>
                <div class="story__meta">
                  <span class="badge" [attr.data-status]="view.status" data-testid="story-status">
                    <span aria-hidden="true">{{ marker(view.status) }}</span>
                    {{ view.statusText }}
                  </span>
                  @if (view.revoting) {
                    <span class="badge badge--muted" data-testid="story-revoting">{{
                      t.revoting
                    }}</span>
                  }
                  @if (view.row.estimate !== null) {
                    <span class="visually-hidden">{{ t.estimateLabel }}</span>
                    <span class="story__estimate" data-testid="story-estimate">{{
                      view.row.estimate
                    }}</span>
                  }
                </div>
                @if (view.actions.length > 0) {
                  <div
                    class="story__actions"
                    role="toolbar"
                    [attr.aria-label]="t.rowActions(view.row.title)"
                  >
                    @for (action of view.actions; track action.id) {
                      <button
                        type="button"
                        class="btn btn--small story__action"
                        [class.story__action--glyph]="action.text === ''"
                        [attr.data-testid]="action.testid"
                        [attr.data-key]="action.key"
                        [attr.data-action]="action.id"
                        [attr.aria-label]="action.name"
                        [attr.aria-disabled]="action.disabled ? 'true' : null"
                        [attr.tabindex]="action.key === rovingKey() ? 0 : -1"
                        (click)="perform(view, action)"
                      >
                        <span aria-hidden="true">{{ action.text || action.glyph }}</span>
                      </button>
                    }
                  </div>
                }
              </li>
            }
          </ul>
        }
        <div
          class="visually-hidden"
          role="status"
          aria-live="polite"
          data-testid="agenda-announcer"
        >
          {{ message() }}
        </div>
      </div>
    </section>

    @if (canManage()) {
      <app-story-form-dialog mode="add" [open]="addOpen()" (closed)="closeAdd()" />
      <app-story-form-dialog
        mode="edit"
        [open]="editing() !== null"
        [story]="editing()"
        (closed)="closeEdit()"
      />
      <app-bulk-add-dialog
        [open]="bulkOpenState()"
        [existing]="rows().length"
        (closed)="closeBulk()"
      />
    }
    <app-story-detail-dialog [story]="detail()" (closed)="detail.set(null)" />
  `,
})
export class AgendaPanel {
  protected readonly t = STRINGS.stories;
  protected readonly max = MAX_STORIES;

  readonly state = input.required<RoomState>();
  readonly agenda = input.required<HeldAgenda | null>();
  /** Facilitator: add, edit, delete, reorder, select, skip, restore. */
  readonly canManage = input(false);

  private readonly conn = inject(RoomConnection);
  private readonly actions = inject(StoryActions);
  private readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Collapsed by default on small screens; CSS keeps the list open on wide screens. */
  protected readonly expanded = signal(false);
  protected readonly connected = this.conn.connected;
  protected readonly addOpen = signal(false);
  protected readonly bulkOpenState = signal(false);
  protected readonly editing = signal<AgendaStory | null>(null);
  protected readonly detail = signal<AgendaStory | null>(null);
  protected readonly message = signal('');

  private lastScrolled: string | null = null;
  private readonly focusedKey = signal<string | null>(null);
  private readonly pendingFocus = signal<string | null>(null);
  /** After a delete the row is gone: where focus should land instead. */
  private afterDelete: {
    index: number;
    actionId: ActionId;
    storyId: string;
    until: number;
  } | null = null;

  private readonly queue = new MoveQueue({
    delayMs: MOVE_DELAY_MS,
    send: async (storyId, beforeId) => {
      const result = await this.actions.run({ type: 'move_story', storyId, beforeId });
      if (!result.ok) this.actions.fail(result.code);
      return result.ok;
    },
    failed: () => this.message.set(STRINGS.stories.reorderFailed),
  });

  protected readonly rows = computed(() => this.agenda()?.rows ?? []);
  private readonly activeId = computed(() => this.state().stories.activeId);
  private readonly storyMode = computed(() => this.state().settings.storySource === 'stories');
  protected readonly full = computed(() => this.rows().length >= MAX_STORIES);
  protected readonly progress = computed(() =>
    progressText(this.state().stories.progress, this.rows().length),
  );
  protected readonly sumText = computed(() => {
    const value = this.state().stories.sum.value;
    return value === null ? null : this.t.sum(value);
  });

  protected readonly views = computed<RowView[]>(() => {
    const rows = orderRows(this.rows(), this.queue.order());
    const activeId = this.activeId();
    const manage = this.canManage();
    const storyMode = this.storyMode();
    return rows.map((row, index) => {
      const status = displayStatus(row, activeId);
      return {
        row,
        status,
        statusText: statusLabel(status),
        revoting: status === 'active' && row.estimate !== null,
        actions: this.actionsFor(row, index, rows.length, status, manage, storyMode),
      };
    });
  });
  protected readonly hasActions = computed(() => this.views().some((v) => v.actions.length > 0));

  /** The one action button with `tabindex=0`: the last focused one, else the first. */
  protected readonly rovingKey = computed(() => {
    const keys = this.views().flatMap((v) => v.actions.map((a) => a.key));
    const focused = this.focusedKey();
    return focused !== null && keys.includes(focused) ? focused : (keys[0] ?? null);
  });

  constructor() {
    // Mirror the facilitator-side confirmations ("3 stories added.") into the polite region.
    effect(() => {
      const text = this.actions.announcement();
      if (text) untracked(() => this.message.set(text));
    });

    // Keep focus on the moved story's control after the list re-renders, and rescue it after a delete.
    afterRenderEffect(() => {
      this.views();
      // The active story scrolls into view when it changes.
      const active = this.activeId();
      if (active !== this.lastScrolled) {
        this.lastScrolled = active;
        if (active !== null) this.scrollToRow(active);
      }
      const key = this.pendingFocus();
      if (key !== null) {
        this.focusKey(key);
        this.pendingFocus.set(null);
        return;
      }
      this.restoreFocusAfterDelete();
    });

    inject(DestroyRef).onDestroy(() => this.queue.dispose());
  }

  // ---- row actions ----

  private actionsFor(
    row: AgendaStory,
    index: number,
    total: number,
    status: DisplayStatus,
    manage: boolean,
    storyMode: boolean,
  ): RowAction[] {
    const t = STRINGS.stories;
    const offline = !this.conn.connected();
    const make = (
      id: ActionId,
      text: string,
      glyph: string,
      name: string,
      disabled = false,
    ): RowAction => ({
      id,
      key: `${row.id}:${id}`,
      testid: this.testId(id, row.id),
      text,
      glyph,
      name,
      disabled: disabled || offline,
    });
    const out: RowAction[] = [];
    if (manage) {
      if (storyMode && status !== 'active') {
        out.push(
          row.status === 'estimated'
            ? make('select', t.revote, '', t.revoteFor(row.title))
            : make('select', t.select, '', t.selectFor(row.title)),
        );
      }
      if (storyMode && row.status === 'pending')
        out.push(make('skip', t.skip, '', t.skipFor(row.title)));
      if (row.status === 'skipped')
        out.push(make('restore', t.restore, '', t.restoreFor(row.title)));
      out.push(make('edit', t.edit, '', t.editFor(row.title)));
      out.push(make('delete', t.remove, '', t.removeFor(row.title)));
      out.push(make('top', '', '⤒', t.moveTopFor(row.title), index === 0));
      out.push(make('up', '', '↑', t.moveUpFor(row.title), index === 0));
      out.push(make('down', '', '↓', t.moveDownFor(row.title), index === total - 1));
      out.push(make('bottom', '', '⤓', t.moveBottomFor(row.title), index === total - 1));
    }
    if (row.status === 'estimated') {
      out.push(make('details', t.history, '', t.historyFor(row.title)));
    } else if (row.hasDescription) {
      out.push(make('details', t.details, '', t.detailsFor(row.title)));
    }
    return out;
  }

  private testId(id: ActionId, storyId: string): string {
    switch (id) {
      case 'select':
        return `story-select-${storyId}`;
      case 'skip':
        return `story-skip-${storyId}`;
      case 'restore':
        return `story-restore-${storyId}`;
      case 'edit':
        return `story-edit-${storyId}`;
      case 'delete':
        return `story-delete-${storyId}`;
      case 'top':
        return `story-move-top-${storyId}`;
      case 'up':
        return `story-move-up-${storyId}`;
      case 'down':
        return `story-move-down-${storyId}`;
      case 'bottom':
        return `story-move-bottom-${storyId}`;
      case 'details':
        return `story-history-${storyId}`;
    }
  }

  protected marker(status: DisplayStatus): string {
    switch (status) {
      case 'active':
        return '▶';
      case 'estimated':
        return '✓';
      case 'skipped':
        return '⏭';
      case 'pending':
        return '○';
    }
  }

  protected perform(view: RowView, action: RowAction): void {
    if (action.disabled && !this.isMove(action.id)) return;
    const row = view.row;
    this.actions.clearError();
    switch (action.id) {
      case 'select':
        this.actions.select(row);
        break;
      case 'skip':
        this.actions.skip(row, false);
        break;
      case 'restore':
        void this.actions.restore(row);
        break;
      case 'edit':
        this.editing.set(row);
        break;
      case 'delete': {
        const index = this.views().findIndex((v) => v.row.id === row.id);
        this.afterDelete = {
          index,
          actionId: 'delete',
          storyId: row.id,
          until: Date.now() + 15_000,
        };
        this.actions.remove(row);
        break;
      }
      case 'details':
        this.detail.set(row);
        break;
      default:
        this.move(row, action.id, action.key, action.disabled);
    }
  }

  private isMove(id: ActionId): boolean {
    return id === 'top' || id === 'up' || id === 'down' || id === 'bottom';
  }

  // ---- reorder ----

  private move(row: AgendaStory, direction: MoveDirection, key: string, atEdge: boolean): void {
    if (!this.conn.connected()) return;
    const t = STRINGS.stories;
    this.pendingFocus.set(key);
    if (atEdge) {
      const first = direction === 'top' || direction === 'up';
      this.message.set(first ? t.alreadyFirst(row.title) : t.alreadyLast(row.title));
      return;
    }
    const outcome = this.queue.step(
      this.rows().map((r) => r.id),
      row.id,
      direction,
    );
    if (outcome.changed) {
      this.message.set(t.movedTo(row.title, outcome.position, outcome.total));
    }
  }

  protected onDrop(event: CdkDragDrop<unknown>): void {
    const ids = this.views().map((v) => v.row.id);
    const storyId = ids[event.previousIndex];
    if (storyId === undefined || event.previousIndex === event.currentIndex) return;
    const without = ids.filter((id) => id !== storyId);
    const beforeId = without[event.currentIndex] ?? null;
    const outcome = this.queue.drop(
      this.rows().map((r) => r.id),
      storyId,
      beforeId,
    );
    const title = this.rows().find((r) => r.id === storyId)?.title ?? '';
    if (outcome.changed) {
      this.message.set(STRINGS.stories.movedTo(title, outcome.position, outcome.total));
    }
  }

  // ---- dialogs ----

  protected openAdd(): void {
    if (this.full() || !this.conn.connected()) return;
    this.addOpen.set(true);
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
  }

  protected openBulk(): void {
    if (this.full() || !this.conn.connected()) return;
    this.bulkOpenState.set(true);
  }

  protected closeBulk(): void {
    this.bulkOpenState.set(false);
  }

  protected closeEdit(): void {
    this.editing.set(null);
  }

  // ---- keyboard: roving focus ----

  protected onFocusIn(event: FocusEvent): void {
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset[
      'key'
    ];
    if (key) this.focusedKey.set(key);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('button[data-key]');
    if (!button || event.altKey || event.metaKey) return;
    const li = button.closest('li');
    if (!li) return;
    const inRow = Array.from(li.querySelectorAll<HTMLElement>('button[data-key]'));
    const at = inRow.indexOf(button);
    const rowsEls = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('li[data-story-id]'),
    );
    const rowAt = rowsEls.indexOf(li);
    const buttonsOf = (el: HTMLElement | undefined) =>
      el ? Array.from(el.querySelectorAll<HTMLElement>('button[data-key]')) : [];
    let target: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowRight':
        target = inRow[at + 1] ?? inRow[0];
        break;
      case 'ArrowLeft':
        target = inRow[at - 1] ?? inRow[inRow.length - 1];
        break;
      case 'Home':
        target = event.ctrlKey ? buttonsOf(rowsEls[0])[0] : inRow[0];
        break;
      case 'End':
        target = event.ctrlKey
          ? buttonsOf(rowsEls[rowsEls.length - 1])[0]
          : inRow[inRow.length - 1];
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        for (let i = rowAt + step; i >= 0 && i < rowsEls.length; i += step) {
          const candidates = buttonsOf(rowsEls[i]);
          const sameAction = candidates.find(
            (b) => b.dataset['action'] === button.dataset['action'],
          );
          target = sameAction ?? candidates[0];
          if (target) break;
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    target?.focus();
  }

  private focusKey(key: string): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(key)}"]`,
    );
    if (el && this.doc.activeElement !== el) el.focus();
  }

  private restoreFocusAfterDelete(): void {
    const pending = this.afterDelete;
    if (!pending) return;
    if (Date.now() > pending.until) {
      this.afterDelete = null;
      return;
    }
    const views = this.views();
    if (views.some((v) => v.row.id === pending.storyId)) return; // not deleted (yet)
    this.afterDelete = null;
    const active = this.doc.activeElement;
    if (active && active !== this.doc.body && this.host.nativeElement.contains(active)) return;
    const neighbours = [views[pending.index], views[pending.index - 1]];
    for (const view of neighbours) {
      const action = view?.actions.find((a) => a.id === pending.actionId) ?? view?.actions[0];
      if (action) {
        this.focusKey(action.key);
        return;
      }
    }
    this.host.nativeElement.querySelector<HTMLElement>('[data-testid="story-add"]')?.focus();
  }

  private scrollToRow(id: string): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>(
      `li[data-story-id="${CSS.escape(id)}"]`,
    );
    el?.scrollIntoView?.({ block: 'nearest' });
  }
}
