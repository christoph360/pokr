import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type * as v from 'valibot';
import { checkText } from './room-logic';
import type { TextKind } from './room-logic';

/** Reactive-forms validator backed by a shared text schema. Error shape: `{ text: message }`. */
export function textValidator(
  schema: v.GenericSchema<unknown, string>,
  kind: TextKind,
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = checkText(schema, kind, String(control.value ?? ''));
    return result.ok ? null : { text: result.message };
  };
}

export function errorText(control: AbstractControl): string | null {
  const e = control.errors?.['text'];
  return typeof e === 'string' ? e : null;
}
