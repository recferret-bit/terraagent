import { NAMED_LABEL_FALLBACK, NAMED_LABEL_MAX, withNumericSuffix } from './account-allocate.js';

// Named-account label (NEAR §2): the `{name}` segment of `{name}.terraagent.near`.
// 2–32 chars of `[a-z0-9-]`, never leading, trailing, or doubled `-` (AccountId rejects those).

const MIN_LABEL = 2;
const MAX_LABEL = NAMED_LABEL_MAX;
const FALLBACK = NAMED_LABEL_FALLBACK;
const MAX_SUFFIX = 20;
const GUILD_PREFIX = 'guild-';

/** Exact reserved labels. Anything that starts with `guild-` is reserved as well. */
const RESERVED_EXACT: ReadonlySet<string> = new Set([
  'relayer',
  'minter',
  'npc',
  'admin',
  'root',
  'system',
  'near',
  'intents',
  'terraagent',
]);

/** True for an exact reserved label, or any label that starts with `guild-`. */
export function isReservedAccountName(name: string): boolean {
  return RESERVED_EXACT.has(name) || name.startsWith(GUILD_PREFIX);
}

/** Lowercase, collapse every non-`[a-z0-9]` run to one `-`, trim hyphens, then clamp to 2–32. */
function cleanAccountLabel(raw: string): string {
  let name = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (name.length > MAX_LABEL) name = name.slice(0, MAX_LABEL).replace(/-+$/, '');
  return name.length < MIN_LABEL ? FALLBACK : name;
}

/** `base-1`, then `base-2` … `base-20`. Reserved words have no hyphen, so `-1` is free; 20 is the stop. */
function unreservedSuffix(base: string): string {
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const candidate = withNumericSuffix(base, n);
    if (!isReservedAccountName(candidate)) return candidate;
  }
  return withNumericSuffix(FALLBACK, 1);
}

/**
 * Label from a display name.
 * A `guild-` prefix is dropped and cleaned again (empty or one character becomes `pilot`).
 * Any other reserved label gets `-1`, then `-2`, … up to `-20`.
 */
export function deriveAccountName(raw: string): string {
  const cleaned = cleanAccountLabel(raw);
  if (!isReservedAccountName(cleaned)) return cleaned;
  if (cleaned.startsWith(GUILD_PREFIX)) return deriveAccountName(cleaned.slice(GUILD_PREFIX.length));
  return unreservedSuffix(cleaned);
}
