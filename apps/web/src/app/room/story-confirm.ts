import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { StoryActions } from '../core/story-actions';
import { STRINGS } from '../i18n/strings';
import { ConfirmDialog } from '../ui/confirm-dialog';

/**
 * The confirmation for select, Next, skip and delete (F02 "unsaved round", F01-AC28). It shows
 * whatever `StoryActions.confirm` holds, whether the client or the server asked for it. Test ids:
 * `story-delete-confirm*` for delete, `round-confirm*` for the rest.
 */
@Component({
  selector: 'app-story-confirm',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirm-dialog
      [open]="request() !== null"
      [prefix]="prefix()"
      [heading]="heading()"
      [message]="message()"
      [okLabel]="okLabel()"
      [cancelLabel]="t.confirmCancel"
      (confirmed)="actions.confirmOk()"
      (cancelled)="actions.confirmCancel()"
    />
  `,
})
export class StoryConfirm {
  protected readonly t = STRINGS.stories;
  protected readonly actions = inject(StoryActions);
  protected readonly request = this.actions.confirm;

  protected readonly prefix = computed(() => {
    const r = this.request();
    return r?.kind === 'delete' && r.needsDelete ? 'story-delete-confirm' : 'round-confirm';
  });
  protected readonly heading = computed(() => {
    switch (this.request()?.kind) {
      case 'delete':
        return this.t.confirmDeleteTitle;
      case 'next':
        return this.t.confirmNextTitle;
      case 'skip':
      case 'skipNext':
        return this.t.confirmSkipTitle;
      default:
        return this.t.confirmSelectTitle;
    }
  });
  protected readonly okLabel = computed(() => {
    switch (this.request()?.kind) {
      case 'delete':
        return this.t.confirmDeleteOk;
      case 'next':
        return this.t.confirmNextOk;
      case 'skip':
      case 'skipNext':
        return this.t.confirmSkipOk;
      default:
        return this.t.confirmSelectOk;
    }
  });
  protected readonly message = computed(() => {
    const r = this.request();
    if (!r) return '';
    if (r.kind !== 'delete') return this.t.confirmSelectBody;
    if (r.estimate !== null && r.needsReset)
      return this.t.deleteEstimatedActive(r.title, r.estimate);
    if (r.estimate !== null) return this.t.deleteEstimated(r.title, r.estimate);
    return this.t.deleteActive(r.title);
  });
}
