import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Tracks `prefers-reduced-motion` so the card flip can switch off (F01-AC33, R-F7). */
@Injectable({ providedIn: 'root' })
export class MotionPreference {
  private readonly _reduced = signal(false);
  readonly reduced = this._reduced.asReadonly();

  constructor() {
    const win = inject(DOCUMENT).defaultView;
    const query = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    this._reduced.set(query.matches);
    const onChange = (event: MediaQueryListEvent) => this._reduced.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
}
