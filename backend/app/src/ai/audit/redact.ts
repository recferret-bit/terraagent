import { parseWaves } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';

/**
 * Sanitized raw text and raw-log age (AI-14). Decision audit is a separate 30-day window;
 * nothing here deletes those rows.
 */
const REDACTED = '[redacted]';

/** `ZAI_API_KEY` is an alternative of its own so `AI_API_KEY` cannot match inside it. */
const SECRET = /\bbearer\s+\S+|\bsk-\S+|\b(?:zai_api_key|ai_api_key)\s*=\s*\S+/gi;

/** Replaces bearer tokens, `sk-` tokens and API-key assignments. The marker holds no secret. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET, REDACTED);
}

/** True once a raw row is at least `rawDays` old. Does not select or delete decision rows. */
export function rawLogExpired(createdAtMs: number, nowMs: number, rawDays: number): boolean {
  return nowMs - createdAtMs >= rawDays * 86_400_000;
}

/** `director.retention.rawDays` for waves through W16. The day count stays in the data row. */
export function readRawRetentionDays(): number {
  const rawDays = dataRow(compileData(parseWaves('..16')), 'director', 'retention').rawDays;
  if (typeof rawDays !== 'number') throw new Error('director.retention.rawDays is not a number');
  return rawDays;
}
