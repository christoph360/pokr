import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DisplayNameSchema, RoomNameSchema } from '@pokr/shared';
import type { ControlMode, CreateRoomRequest, Deck, DeckId } from '@pokr/shared';
import { DECK_OPTIONS, checkText, parseCustomDeck } from '../core/room-logic';
import { RoomApi } from '../core/room-api';
import { TokenStore } from '../core/token-store';
import { errorText, textValidator } from '../core/text-validator';
import { STRINGS } from '../i18n/strings';

@Component({
  selector: 'app-start-page',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel panel--narrow" aria-labelledby="start-heading">
      <h2 id="start-heading">{{ t.start.heading }}</h2>
      <p class="muted">{{ t.start.intro }}</p>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="form">
        <div class="field">
          <label for="start-name">{{ t.start.name }}</label>
          <input
            id="start-name"
            data-testid="start-name"
            type="text"
            formControlName="name"
            autocomplete="nickname"
            [attr.aria-invalid]="showError(form.controls.name) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.name) ? 'start-name-error' : 'start-name-hint'
            "
          />
          <p id="start-name-hint" class="hint">{{ t.start.nameHint }}</p>
          @if (showError(form.controls.name)) {
            <p id="start-name-error" class="error" data-testid="start-name-error">
              {{ error(form.controls.name) }}
            </p>
          }
        </div>

        <div class="field">
          <label for="start-room-name">{{ t.start.roomName }}</label>
          <input
            id="start-room-name"
            data-testid="start-room-name"
            type="text"
            formControlName="roomName"
            [placeholder]="t.start.roomNamePlaceholder"
            [attr.aria-invalid]="showError(form.controls.roomName) ? 'true' : null"
            [attr.aria-describedby]="
              showError(form.controls.roomName) ? 'start-room-name-error' : null
            "
          />
          @if (showError(form.controls.roomName)) {
            <p id="start-room-name-error" class="error" data-testid="start-room-name-error">
              {{ error(form.controls.roomName) }}
            </p>
          }
        </div>

        <div class="field">
          <label for="start-deck">{{ t.start.deck }}</label>
          <select id="start-deck" data-testid="start-deck" formControlName="deck">
            @for (id of decks; track id) {
              <option [value]="id">{{ t.decks[id] }}</option>
            }
          </select>
        </div>

        @if (form.controls.deck.value === 'custom') {
          <div class="field">
            <label for="start-custom-deck">{{ t.start.customDeck }}</label>
            <input
              id="start-custom-deck"
              data-testid="start-custom-deck"
              type="text"
              formControlName="customDeck"
              autocomplete="off"
              [attr.aria-invalid]="showError(form.controls.customDeck) ? 'true' : null"
              [attr.aria-describedby]="
                showError(form.controls.customDeck)
                  ? 'start-custom-deck-error'
                  : 'start-custom-deck-hint'
              "
            />
            <p id="start-custom-deck-hint" class="hint">{{ t.start.customDeckHint }}</p>
            @if (showError(form.controls.customDeck)) {
              <p id="start-custom-deck-error" class="error" data-testid="start-custom-deck-error">
                {{ error(form.controls.customDeck) }}
              </p>
            }
          </div>
        }

        <div class="field">
          <label for="start-control-mode">{{ t.start.controlMode }}</label>
          <select
            id="start-control-mode"
            data-testid="start-control-mode"
            formControlName="controlMode"
          >
            @for (mode of modes; track mode) {
              <option [value]="mode">{{ t.controlModes[mode] }}</option>
            }
          </select>
        </div>

        <div class="field field--check">
          <input
            id="start-auto-reveal"
            data-testid="start-auto-reveal"
            type="checkbox"
            formControlName="autoReveal"
          />
          <label for="start-auto-reveal">{{ t.start.autoReveal }}</label>
        </div>
        <div class="field field--check">
          <input
            id="start-facilitator-votes"
            data-testid="start-facilitator-votes"
            type="checkbox"
            formControlName="facilitatorVotes"
          />
          <label for="start-facilitator-votes">{{ t.start.facilitatorVotes }}</label>
        </div>

        @if (submitError()) {
          <p class="error" role="alert" data-testid="start-error">{{ submitError() }}</p>
        }

        <button
          type="submit"
          class="btn btn--primary"
          data-testid="start-create"
          [attr.aria-disabled]="busy() ? 'true' : null"
        >
          {{ busy() ? t.start.creating : t.start.create }}
        </button>
      </form>
    </section>
  `,
})
export class StartPage {
  protected readonly t = STRINGS;
  protected readonly decks = DECK_OPTIONS;
  protected readonly modes: readonly ControlMode[] = ['facilitator', 'everyone'];

  private readonly api = inject(RoomApi);
  private readonly tokens = inject(TokenStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly busy = signal(false);
  protected readonly submitError = signal<string | null>(null);

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.buildForm();

  private buildForm() {
    const fb = this.fb;
    const form = fb.group({
      name: fb.control('', textValidator(DisplayNameSchema, 'name')),
      roomName: fb.control('', textValidator(RoomNameSchema, 'roomName')),
      deck: fb.control<DeckId>('fibonacci'),
      customDeck: new FormControl('', {
        nonNullable: true,
        validators: (control) => {
          if (control.parent?.get('deck')?.value !== 'custom') return null;
          const result = parseCustomDeck(String(control.value));
          return result.ok ? null : { text: result.message };
        },
      }),
      controlMode: fb.control<ControlMode>('facilitator'),
      autoReveal: fb.control(false),
      facilitatorVotes: fb.control(true),
    });
    form.controls.deck.valueChanges.subscribe(() =>
      form.controls.customDeck.updateValueAndValidity(),
    );
    return form;
  }

  protected showError(control: FormControl<string>): boolean {
    return control.invalid && (control.touched || control.dirty);
  }

  protected error(control: FormControl<string>): string | null {
    return errorText(control);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    this.submitError.set(null);
    if (this.form.invalid) {
      this.submitError.set(this.t.start.fixErrors);
      this.host.nativeElement.querySelector<HTMLElement>('input[aria-invalid="true"]')?.focus();
      return;
    }
    const v = this.form.getRawValue();
    const name = checkText(DisplayNameSchema, 'name', v.name);
    const roomName = checkText(RoomNameSchema, 'roomName', v.roomName);
    if (!name.ok || !roomName.ok) return;
    let deck: Deck;
    if (v.deck === 'custom') {
      const parsed = parseCustomDeck(v.customDeck);
      if (!parsed.ok) return;
      deck = parsed.deck;
    } else {
      deck = { id: v.deck };
    }
    const request: CreateRoomRequest = {
      displayName: name.value,
      settings: {
        name: roomName.value,
        deck,
        controlMode: v.controlMode,
        autoReveal: v.autoReveal,
        facilitatorVotes: v.facilitatorVotes,
      },
    };
    this.busy.set(true);
    const result = await this.api.createRoom(request);
    this.busy.set(false);
    if (result.ok) {
      this.tokens.set(result.data.roomId, result.data.token);
      await this.router.navigate(['/r', result.data.roomId]);
      return;
    }
    if (result.code === 'network') this.submitError.set(this.t.start.networkError);
    else if (result.code === 'rate_limited') {
      this.submitError.set(
        this.t.start.rateLimited(Math.max(1, Math.ceil((result.retryAfterMs ?? 1000) / 1000))),
      );
    } else this.submitError.set(this.t.start.serverError);
  }
}
