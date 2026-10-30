import { z } from 'zod';

/** Fail-closed boolean: only the exact string `true` counts (D-30 rule 3). `TRUE`, `1`, `yes`, typos → false. */
export function envFlagTrue(value: string | undefined | null): boolean {
  return value === 'true';
}

/** zod field for a fail-closed boolean env var (unset → false). */
export const zFlag = () => z.string().optional().transform(envFlagTrue);
