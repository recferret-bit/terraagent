import { DEPOSIT, defaultW02Data, depositFamilyAndKey, type CompiledDataLike } from '@terra/sim';
import { resourceLabel } from './resources';

/** What a deposit yields, for the player: its stock key, the sim's resource name (`resources` table) and tier. */
export interface DepositResource {
  key: string;
  /** `Iron`, `Light Alloys`, `Petroleum`… (the `label` of the sim's `resources` row). */
  label: string;
  tier: 1 | 2 | 3;
}

/**
 * The resource a deposit yields (the sim's `depositFamilyAndKey`: `deposit` code or name, `depositTier` 0 = tier 1),
 * named from the host's compiled `resources` rows (`data`, else the built-in W02 data). `null`: no deposit.
 */
export function depositResource(deposit: number | string, tier: number, data?: CompiledDataLike | null): DepositResource | null {
  const code = typeof deposit === 'string' ? (DEPOSIT as Record<string, number>)[deposit] : deposit;
  const fk = typeof code === 'number' ? depositFamilyAndKey(code, tier) : null;
  if (!fk) return null;
  const rows = (data ?? defaultW02Data()).tables.resources as Record<string, { label?: unknown }> | undefined;
  const label = rows?.[fk.key]?.label;
  return { key: fk.key, label: typeof label === 'string' ? label : resourceLabel(fk.key), tier: tier === 2 || tier === 3 ? tier : 1 };
}
