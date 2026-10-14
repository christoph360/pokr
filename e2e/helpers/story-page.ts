import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cardSlug } from '@pokr/shared';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type RowAction =
  | 'select'
  | 'edit'
  | 'delete'
  | 'move-up'
  | 'move-down'
  | 'move-top'
  | 'move-bottom'
  | 'skip'
  | 'restore'
  | 'history';

const ACTION_TESTID: Record<RowAction, string> = {
  select: 'story-select',
  edit: 'story-edit',
  delete: 'story-delete',
  'move-up': 'story-move-up',
  'move-down': 'story-move-down',
  'move-top': 'story-move-top',
  'move-bottom': 'story-move-bottom',
  skip: 'story-skip',
  restore: 'story-restore',
  history: 'story-history',
};

/**
 * Page object for the F02 parts of the room screen (agenda, active story, estimate picker).
 *
 * Test IDs follow docs/qa/F02-test-plan.md section 5.4. IDs that plan does not list, and that the
 * frontend may have named differently, are marked ASSUMED below; they are all used through this
 * class only, so a deviation is a one-line change here.
 */
export class StoryPage {
  constructor(readonly page: Page) {}

  // ---- agenda ----
  get agenda(): Locator {
    return this.page.getByTestId('agenda');
  }
  get rows(): Locator {
    return this.page.getByTestId('story-row');
  }
  get progress(): Locator {
    return this.page.getByTestId('agenda-progress');
  }
  get sum(): Locator {
    return this.page.getByTestId('agenda-sum');
  }
  get sumExcluded(): Locator {
    return this.page.getByTestId('agenda-sum-excluded');
  }
  get limitNotice(): Locator {
    return this.page.getByTestId('story-limit-notice');
  }
  /** Live region for agenda announcements (plan 5.4: `agenda-announcer`). */
  get agendaAnnouncer(): Locator {
    return this.page.getByTestId('agenda-announcer');
  }
  /** Live region for active story / estimate announcements (plan 5.4: `story-announcer`). */
  get announcer(): Locator {
    return this.page.getByTestId('story-announcer');
  }

  row(title: string): Locator {
    return this.rows.filter({
      has: this.page
        .getByTestId('story-title')
        .filter({ hasText: new RegExp(`^\\s*${escapeRe(title)}\\s*$`) }),
    });
  }
  rowById(id: string): Locator {
    return this.page.locator(`[data-testid="story-row"][data-story-id="${id}"]`);
  }
  async idOf(title: string): Promise<string> {
    const id = await this.row(title).first().getAttribute('data-story-id');
    if (!id) throw new Error(`row "${title}" has no data-story-id`);
    return id;
  }
  async titles(): Promise<string[]> {
    const n = await this.rows.count();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      out.push((await this.rows.nth(i).getByTestId('story-title').innerText()).trim());
    }
    return out;
  }
  async expectTitles(expected: string[]): Promise<void> {
    await expect.poll(() => this.titles(), { message: 'agenda order' }).toEqual(expected);
  }
  /** Stored status as `data-status`, plus the estimate as `data-estimate`. */
  async expectRow(
    title: string,
    expected: {
      status?: 'pending' | 'estimated' | 'skipped';
      estimate?: string | null;
      active?: boolean;
    },
  ): Promise<void> {
    const row = this.row(title);
    await expect(row).toHaveCount(1);
    if (expected.status) await expect(row).toHaveAttribute('data-status', expected.status);
    if (expected.active !== undefined)
      await expect(row).toHaveAttribute('data-active', expected.active ? 'true' : 'false');
    if (expected.estimate === null) {
      await expect(row.getByTestId('story-estimate')).toHaveCount(0);
    } else if (expected.estimate !== undefined) {
      await expect(row.getByTestId('story-estimate')).toHaveText(expected.estimate);
    }
  }

  // ---- row actions ----
  /** Row actions are always-visible buttons (roving tabindex), so no menu to open. */
  async action(title: string, kind: RowAction): Promise<Locator> {
    const id = await this.idOf(title);
    return this.page.getByTestId(`${ACTION_TESTID[kind]}-${id}`);
  }
  async doAction(title: string, kind: RowAction): Promise<void> {
    await (await this.action(title, kind)).click();
  }

  // ---- active story ----
  get activeStory(): Locator {
    return this.page.getByTestId('active-story');
  }
  get activeTitle(): Locator {
    return this.page.getByTestId('active-story-title');
  }
  get activeDescription(): Locator {
    return this.page.getByTestId('active-story-description');
  }
  get activeLink(): Locator {
    return this.page.getByTestId('active-story-link');
  }
  get noActive(): Locator {
    return this.page.getByTestId('no-active-story');
  }
  /** ASSUMED: "Show more" toggle of a long description. */
  get descriptionToggle(): Locator {
    return this.page.getByTestId('story-description-toggle');
  }

  // ---- add / bulk ----
  get addOpen(): Locator {
    return this.page.getByTestId('story-add');
  }
  get addTitle(): Locator {
    return this.page.getByTestId('story-add-title');
  }
  get addDescription(): Locator {
    return this.page.getByTestId('story-add-description');
  }
  get addLink(): Locator {
    return this.page.getByTestId('story-add-link');
  }
  get addSubmit(): Locator {
    return this.page.getByTestId('story-add-submit');
  }
  get bulkOpen(): Locator {
    return this.page.getByTestId('story-bulk-open');
  }
  get bulkText(): Locator {
    return this.page.getByTestId('story-bulk-text');
  }
  get bulkPreview(): Locator {
    return this.page.getByTestId('story-bulk-preview');
  }
  get bulkSubmit(): Locator {
    return this.page.getByTestId('story-bulk-submit');
  }
  get bulkError(): Locator {
    return this.page.getByTestId('story-bulk-error');
  }

  /** Open the add form if it is not showing (it may be inline or a dialog). */
  async openAdd(): Promise<void> {
    if (!(await this.addTitle.isVisible())) await this.addOpen.click();
    await expect(this.addTitle).toBeVisible();
  }
  async fillAdd(fields: { title: string; description?: string; link?: string }): Promise<void> {
    await this.openAdd();
    await this.addTitle.fill(fields.title);
    if (fields.description !== undefined) await this.addDescription.fill(fields.description);
    if (fields.link !== undefined) await this.addLink.fill(fields.link);
  }
  async add(fields: { title: string; description?: string; link?: string }): Promise<void> {
    await this.fillAdd(fields);
    await this.addSubmit.click();
  }
  async openBulk(): Promise<void> {
    if (!(await this.bulkText.isVisible())) await this.bulkOpen.click();
    await expect(this.bulkText).toBeVisible();
  }
  async fillBulk(text: string): Promise<void> {
    await this.openBulk();
    await this.bulkText.fill(text);
  }

  // ---- edit (ASSUMED ids: story-edit-title / -description / -link / -submit) ----
  get editTitle(): Locator {
    return this.page.getByTestId('story-edit-title');
  }
  get editDescription(): Locator {
    return this.page.getByTestId('story-edit-description');
  }
  get editLink(): Locator {
    return this.page.getByTestId('story-edit-link');
  }
  get editSubmit(): Locator {
    return this.page.getByTestId('story-edit-submit');
  }

  // ---- confirmations (ASSUMED: -ok / -cancel suffixes, as deck-confirm in F01) ----
  get deleteConfirm(): Locator {
    return this.page.getByTestId('story-delete-confirm');
  }
  get deleteConfirmOk(): Locator {
    return this.page.getByTestId('story-delete-confirm-ok');
  }
  get deleteConfirmCancel(): Locator {
    return this.page.getByTestId('story-delete-confirm-cancel');
  }
  get modeConfirm(): Locator {
    return this.page.getByTestId('mode-switch-confirm');
  }
  get modeConfirmOk(): Locator {
    return this.page.getByTestId('mode-switch-confirm-ok');
  }
  get modeConfirmCancel(): Locator {
    return this.page.getByTestId('mode-switch-confirm-cancel');
  }
  /** ASSUMED: generic "discard this round?" dialog for select / Next / skip / delete of the active story. */
  get roundConfirm(): Locator {
    return this.page.getByTestId('round-confirm');
  }
  get roundConfirmOk(): Locator {
    return this.page.getByTestId('round-confirm-ok');
  }
  get roundConfirmCancel(): Locator {
    return this.page.getByTestId('round-confirm-cancel');
  }

  // ---- source setting ----
  get sourceSelect(): Locator {
    return this.page.getByTestId('story-source-select');
  }

  // ---- Next / estimate ----
  get next(): Locator {
    return this.page.getByTestId('next-story');
  }
  get acceptOpen(): Locator {
    return this.page.getByTestId('accept-open');
  }
  get quickConsensus(): Locator {
    return this.page.getByTestId('quickpick-consensus');
  }
  get quickMedian(): Locator {
    return this.page.getByTestId('quickpick-median');
  }
  acceptCard(card: string): Locator {
    return this.page.getByTestId(`accept-card-${cardSlug(card)}`);
  }
  get acceptConfirm(): Locator {
    return this.page.getByTestId('accept-confirm');
  }
  /** ASSUMED: dialog showing a story's final round (`story-history`) with one `story-history-vote` per vote. */
  get history(): Locator {
    return this.page.getByTestId('story-history');
  }
  get historyVotes(): Locator {
    return this.page.getByTestId('story-history-vote');
  }

  get acceptDialog(): Locator {
    return this.page.getByTestId('accept-dialog');
  }
  get acceptedEstimate(): Locator {
    return this.page.getByTestId('accepted-estimate');
  }
  get skipNext(): Locator {
    return this.page.getByTestId('story-skip-next');
  }
  get activeSkip(): Locator {
    return this.page.getByTestId('active-skip');
  }
  get cardsIdle(): Locator {
    return this.page.getByTestId('cards-idle');
  }
  get bulkFailure(): Locator {
    return this.page.getByTestId('story-bulk-failure');
  }
  /** Per-line problems or a server failure of a bulk add. */
  get bulkProblem(): Locator {
    return this.bulkError.or(this.bulkFailure);
  }
  get agendaToggle(): Locator {
    return this.page.getByTestId('agenda-toggle');
  }

  /** On a phone the agenda is collapsed by default; expand it (no-op where it is always open). */
  async openAgenda(): Promise<void> {
    const toggle = this.agendaToggle;
    if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
  }

  /** Open the accept dialog (after reveal): quick picks and the value cards live inside it. */
  async openPicker(): Promise<void> {
    if (!(await this.acceptDialog.isVisible())) await this.acceptOpen.click();
    await expect(this.acceptDialog).toBeVisible();
  }
  /** Choose a card in the dialog, confirm, and wait for the dialog to close. */
  async accept(card: string): Promise<void> {
    await this.openPicker();
    await this.acceptCard(card).click();
    await this.confirmAccept();
  }
  async acceptQuick(which: 'consensus' | 'median'): Promise<void> {
    await this.openPicker();
    await (which === 'consensus' ? this.quickConsensus : this.quickMedian).click();
    await this.confirmAccept();
  }
  async confirmAccept(): Promise<void> {
    await expect(this.acceptConfirm).not.toHaveAttribute('aria-disabled', 'true');
    await this.acceptConfirm.click();
    await expect(this.acceptDialog).toBeHidden();
  }

  /** Select a story; handles the discard confirmation when it appears and `confirm` is true. */
  async select(title: string, opts: { confirm?: boolean } = {}): Promise<void> {
    await this.doAction(title, 'select');
    if (opts.confirm) await this.confirmDiscard();
  }
  async confirmDiscard(): Promise<void> {
    await expect(this.roundConfirm).toBeVisible();
    await this.roundConfirmOk.click();
  }
}

/** Disabled for a button: the `disabled` attribute or `aria-disabled="true"`. */
export async function expectDisabled(loc: Locator, disabled = true): Promise<void> {
  await expect
    .poll(async () => {
      const attr = await loc.getAttribute('aria-disabled');
      const native = await loc.isDisabled();
      return native || attr === 'true';
    })
    .toBe(disabled);
}

/** An input flagged invalid: `aria-invalid="true"` or a failing native constraint. */
export async function expectInvalid(loc: Locator): Promise<void> {
  await expect
    .poll(() =>
      loc.evaluate(
        (el) =>
          el.getAttribute('aria-invalid') === 'true' ||
          ((el as HTMLInputElement).checkValidity !== undefined &&
            !(el as HTMLInputElement).checkValidity()),
      ),
    )
    .toBe(true);
}
