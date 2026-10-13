/**
 * Structured logs with IDs only (F01-AC32, ADR 0002). The field type admits no free text, so
 * names, topics, tokens and votes cannot be passed by accident.
 */
export interface LogFields {
  roomId?: string;
  participantId?: string;
  code?: string;
  type?: string;
  version?: number;
  count?: number;
}

export function log(event: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** Logs an unexpected error by class name only (messages may embed input). */
export function logError(event: string, err: unknown, fields: LogFields = {}): void {
  console.error(
    JSON.stringify({ event, ...fields, errorName: err instanceof Error ? err.name : 'unknown' }),
  );
}
