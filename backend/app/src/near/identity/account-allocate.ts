import { playerAccountId } from '@terra/contracts';
import { NearException } from '../domain/errors.js';

/** Label length cap (NEAR §2). `deriveAccountName` uses the same cap. */
export const NAMED_LABEL_MAX = 32;
/** Used when a numeric suffix would otherwise leave an empty stem. */
export const NAMED_LABEL_FALLBACK = 'pilot';
/** Bare label, then `-2` … `-64`. `-1` is only the reserved-name suffix from `deriveAccountName`. */
const LABEL_CHOICES = 64;

/** `base-n` fitted into 32 chars. A cut stem loses its trailing `-` so the join is not `--`. */
export function withNumericSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  const stem = base.slice(0, NAMED_LABEL_MAX - suffix.length).replace(/-+$/, '');
  return `${stem.length < 1 ? NAMED_LABEL_FALLBACK : stem}${suffix}`;
}

/** `base`, then `base-2`, `base-3`, … up to {@link LABEL_CHOICES} candidates. */
export function labelChoices(base: string): readonly string[] {
  const labels = [base];
  for (let n = 2; labels.length < LABEL_CHOICES; n += 1) labels.push(withNumericSuffix(base, n));
  return labels;
}

/**
 * First label `isTaken` rejects as free. Collision suffixes start at `-2` (never `-1`).
 * Throws `NEAR_NAME_TAKEN` when every candidate in the scan is taken.
 */
export function nextFreeLabel(base: string, isTaken: (label: string) => boolean): string {
  const free = labelChoices(base).find((label) => !isTaken(label));
  if (free !== undefined) return free;
  throw new NearException('NEAR_NAME_TAKEN');
}

/**
 * Process-local named accounts, keyed by opId. A repeat returns the stored account and does not take another label.
 * Used when `databaseEnabled` is false (unit tests). The database path applies the same `nextFreeLabel` rule.
 */
export class NamedAccountBook {
  private readonly byOpId = new Map<string, string>();
  private readonly taken = new Set<string>();

  allocate(opId: string, name: string): string {
    const prior = this.byOpId.get(opId);
    if (prior !== undefined) return prior;
    const label = nextFreeLabel(name, (candidate) => this.taken.has(candidate));
    const accountId = playerAccountId(label);
    this.taken.add(label);
    this.byOpId.set(opId, accountId);
    return accountId;
  }
}
