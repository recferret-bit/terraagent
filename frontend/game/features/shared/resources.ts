import type { ResourceKey } from '@terra/contracts';

/** Player-facing resource names, one table for the HUD, the reject toasts and the construction menu (FF-22). */
export const RESOURCE_LABELS: Readonly<Record<ResourceKey, string>> = {
  'metals.t1': 'Metals',
  'metals.t2': 'Metals T2',
  'metals.t3': 'Metals T3',
  'minerals.t1': 'Minerals',
  'minerals.t2': 'Minerals T2',
  'minerals.t3': 'Minerals T3',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
  'bio.t2': 'Bio T2',
  'bio.t3': 'Bio T3',
};

export function resourceLabel(key: string): string {
  return (RESOURCE_LABELS as Record<string, string>)[key] ?? key;
}

/** `{ 'metals.t1': 200, 'minerals.t1': 100 }` → `200 Metals · 100 Minerals` (positive amounts, in key order). */
export function formatCost(cost: Readonly<Record<string, number>>): string {
  return Object.entries(cost)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${resourceLabel(k)}`)
    .join(' · ');
}

/**
 * Short names the dev console accepts for the T1 resources (`metals` → `metals.t1`, `minerals`, `biomass`, `water`):
 * the lower-cased one-word labels above. The contract only takes canonical `ResourceKey`s, so this is the one alias table.
 */
export const RESOURCE_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RESOURCE_LABELS)
    .filter(([, label]) => !label.includes(' '))
    .map(([key, label]) => [label.toLowerCase(), key]),
);
