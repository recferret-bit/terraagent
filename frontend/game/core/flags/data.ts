import { compileData, type BalanceOverrides } from '@terra/sim';
import type { FlagSet } from '@terra/contracts';

/** Client-side data tables for the current flags: rows of disabled waves are dropped (same compile as the server, with the planet's balance overrides from `welcome.overrides`, D-35). */
export const clientDataFor = (flags: FlagSet, overrides?: BalanceOverrides) => compileData(flags, overrides);

/** Coerces a `ReadonlySet<string>` or `FlagSet` into a canonical `FlagSet`. */
export function toFlagSet(flags: ReadonlySet<string> | FlagSet): FlagSet {
  if ('spec' in flags && 'list' in flags && typeof flags.has === 'function') {
    return flags as FlagSet;
  }
  const set = flags as ReadonlySet<string>;
  const list = Array.from(set);
  return {
    has: (w: string) => set.has(w),
    list,
    spec: list.join(','),
  };
}

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
};

export function formatResourceLabel(res: string): string {
  if (RESOURCE_LABELS[res]) return RESOURCE_LABELS[res];
  const parts = res.split('.');
  const last = parts[parts.length - 1] ?? res;
  return last.charAt(0).toUpperCase() + last.slice(1);
}
