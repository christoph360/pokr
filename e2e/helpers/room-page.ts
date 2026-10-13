import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cardSlug } from '@pokr/shared';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Page object for the room screen. Locators are role / label / test-id based (plan 5.3). */
export class RoomPage {
  constructor(readonly page: Page) {}

  get root(): Locator {
    return this.page.locator('[data-state-version]');
  }
  get cardGrid(): Locator {
    return this.page.getByTestId('card-grid');
  }
  card(card: string): Locator {
    return this.page.getByTestId(`card-${cardSlug(card)}`);
  }
  get votedCount(): Locator {
    return this.page.getByTestId('voted-count');
  }
  get participantList(): Locator {
    return this.page.getByTestId('participant-list');
  }
  get rows(): Locator {
    return this.page.getByTestId('participant-row');
  }
  /** Row by exact displayed name (including "(2)" suffix). */
  row(name: string): Locator {
    return this.rows.filter({
      has: this.page
        .getByTestId('participant-name')
        .filter({ hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`) }),
    });
  }
  rowById(id: string): Locator {
    return this.page.locator(`[data-testid="participant-row"][data-participant-id="${id}"]`);
  }
  get ownRow(): Locator {
    return this.page.locator('[data-testid="participant-row"][data-you="true"]');
  }
  get reveal(): Locator {
    return this.page.getByTestId('reveal');
  }
  get reset(): Locator {
    return this.page.getByTestId('reset');
  }
  get settingsOpen(): Locator {
    return this.page.getByTestId('settings-open');
  }
  get roleSwitch(): Locator {
    return this.page.getByTestId('role-switch');
  }
  get topicInput(): Locator {
    return this.page.getByTestId('topic-input');
  }
  get topicSave(): Locator {
    return this.page.getByTestId('topic-save');
  }
  get topicDisplay(): Locator {
    return this.page.getByTestId('topic-display');
  }
  get summary(): Locator {
    return this.page.getByTestId('summary');
  }
  get connection(): Locator {
    return this.page.getByTestId('connection-indicator');
  }
  get claim(): Locator {
    return this.page.getByTestId('claim-facilitator');
  }
  get announcer(): Locator {
    return this.page.getByTestId('reveal-announcer');
  }

  async version(): Promise<number> {
    const v = await this.root.getAttribute('data-state-version');
    return Number(v ?? 0);
  }

  async waitForVersionAtLeast(min: number): Promise<void> {
    await expect
      .poll(() => this.version(), { message: `state version >= ${min}` })
      .toBeGreaterThanOrEqual(min);
  }

  /**
   * In the room with the participant list usable. On phones the list is a collapsible panel
   * (collapsed by default); it is expanded here unless `expandList` is false.
   */
  async expectInRoom(opts: { expandList?: boolean } = {}): Promise<void> {
    await expect(this.root).toBeVisible();
    if (opts.expandList === false) return;
    const toggle = this.page.getByTestId('participants-toggle');
    if (await toggle.isVisible()) {
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
    await expect(this.participantList).toBeVisible();
  }

  /** Click a card. Does not wait; use expectSelected (selection shows after server ack). */
  async click(card: string): Promise<void> {
    await this.card(card).click();
  }

  /** Select a card and wait until it shows as selected. */
  async vote(card: string): Promise<void> {
    await this.card(card).click();
    await this.expectSelected(card, true);
  }

  async expectSelected(card: string, selected = true): Promise<void> {
    const el = this.card(card);
    const attr = (await el.getAttribute('aria-checked')) !== null ? 'aria-checked' : 'aria-pressed';
    await expect(el).toHaveAttribute(attr, selected ? 'true' : 'false');
  }

  async expectNoSelection(deck: readonly string[]): Promise<void> {
    for (const c of deck) await this.expectSelected(c, false);
  }

  async expectVoteIndicator(name: string, voted: boolean): Promise<void> {
    await expect(this.row(name)).toHaveAttribute('data-voted', voted ? 'true' : 'false');
  }

  async expectCounter(voted: number, total: number): Promise<void> {
    await expect(this.votedCount).toHaveText(new RegExp(`^\\s*${voted}\\s+of\\s+${total}\\b`));
  }

  async setTopic(topic: string): Promise<void> {
    await this.topicInput.fill(topic);
    await this.topicSave.click();
  }

  async openSettings(): Promise<void> {
    await this.settingsOpen.click();
    await expect(this.page.getByTestId('setting-deck')).toBeVisible();
  }

  async selectDeck(deckId: string): Promise<void> {
    await this.page.getByTestId('setting-deck').selectOption({ value: deckId });
  }

  async setControlMode(mode: 'facilitator' | 'everyone'): Promise<void> {
    await this.page.getByTestId('setting-control-mode').selectOption({ value: mode });
  }

  async setAutoReveal(on: boolean): Promise<void> {
    await this.page.getByTestId('setting-auto-reveal').setChecked(on);
  }

  async setFacilitatorVotes(on: boolean): Promise<void> {
    await this.page.getByTestId('setting-facilitator-votes').setChecked(on);
  }

  async setRoomName(name: string): Promise<void> {
    const input = this.page.getByTestId('setting-room-name');
    await input.fill(name);
    await input.press('Enter');
  }

  /** Revealed values per participant name, read from the participant list. */
  async revealedValues(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const n = await this.rows.count();
    for (let i = 0; i < n; i++) {
      const row = this.rows.nth(i);
      const name = (await row.getByTestId('participant-name').innerText()).trim();
      const vote = row.getByTestId('participant-vote');
      if (await vote.count()) out[name] = (await vote.innerText()).trim();
    }
    return out;
  }

  /** Wait until the revealed values shown in the list include `expected` (name -> card). */
  async expectRevealedValues(expected: Record<string, string>): Promise<void> {
    await expect
      .poll(() => this.revealedValues(), { message: 'revealed values in the participant list' })
      .toMatchObject(expected);
  }

  async expectRevealed(): Promise<void> {
    await expect(this.summary).toBeVisible();
  }
}
