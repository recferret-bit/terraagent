import type { FlagSet } from '@terra/contracts';
import { TreasuryEffectKind, type TreasuryEffectKind as TreasuryKind } from '@terra/contracts';
import { compileData, type CompiledRow } from '@terra/sim';

/** Council projects are priced in this cargo token (W22-08, NEAR-102). */
export const TREASURY_COST_TOKEN = 'metals.t1';

export interface TreasuryProject {
  readonly kind: TreasuryKind;
  readonly cost: string;
  readonly durationH: number;
  readonly magnitudeBp: number;
  readonly visits: number;
}

/** Table row for `kind`, or null when the kind is unknown or its wave is off. */
export function treasuryProject(flags: FlagSet, kind: string): TreasuryProject | null {
  const parsed = TreasuryEffectKind.safeParse(kind);
  if (!parsed.success) return null;
  const row = compileData(flags).tables.treasury?.[parsed.data];
  if (!row) return null;
  const cost = whole(row.cost);
  if (cost === null) return null;
  return {
    kind: parsed.data,
    cost,
    durationH: num(row, 'durationH'),
    magnitudeBp: num(row, 'magnitudeBp'),
    visits: num(row, 'visits'),
  };
}

/** `nowMs` plus `treasuryPolicy.vote.proposalTtlH` (default 6 h). The finalize job is W22-09. */
export function proposalDeadlineMs(flags: FlagSet, nowMs: number): number {
  const hours = num(compileData(flags).tables.treasuryPolicy?.vote, 'proposalTtlH');
  return nowMs + (hours > 0 ? hours : 6) * 3_600_000;
}

function whole(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return String(value);
}

function num(row: CompiledRow | undefined, field: string): number {
  const value = row?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
