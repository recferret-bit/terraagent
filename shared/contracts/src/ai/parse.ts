import { z } from 'zod';
import { AI_JSON_MAX_DEPTH, AI_RESPONSE_MAX_BYTES } from './limits';

export type AiParseCode = 'invalid' | 'context_too_large' | 'too_deep';
export type AiParseResult<T> = { ok: true; value: T } | { ok: false; code: AiParseCode };

/** UTF-8 byte length without `TextEncoder` (contracts compile without the DOM lib). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** True when every nested array or object is within `max` levels. Objects and arrays count. */
export function withinJsonDepth(value: unknown, max: number, depth = 1): boolean {
  if (depth > max) return false;
  if (Array.isArray(value)) return value.every((item) => withinJsonDepth(item, max, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) => withinJsonDepth(item, max, depth + 1));
  }
  return true;
}

/**
 * Byte-checks, then parses, then validates. Oversized text is rejected before `JSON.parse` (AI §5).
 * Unknown keys and unknown action kinds surface as `invalid` because the schemas are strict.
 */
export function parseAiJson<T>(schema: z.ZodType<T>, raw: string, maxBytes = AI_RESPONSE_MAX_BYTES): AiParseResult<T> {
  if (utf8Bytes(raw) > maxBytes) return { ok: false, code: 'context_too_large' };
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, code: 'invalid' };
  }
  if (!withinJsonDepth(data, AI_JSON_MAX_DEPTH)) return { ok: false, code: 'too_deep' };
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'invalid' };
}
