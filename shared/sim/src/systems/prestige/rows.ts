import type { Amounts } from '../../economy/treasury';
import type { CompiledDataLike } from '../../kernel/config';

export interface PrestigeProjectRow {
  readonly id: string;
  readonly label: string;
  readonly cost: Amounts;
  /** Compiled ticks. */
  readonly buildTicks: number;
}

export interface TransportRow {
  readonly unitsPerBlock: number;
  /** Per started block. */
  readonly cost: Amounts;
}

type PrestigeTable = Record<string, { label?: string; buildS?: number; cost?: Amounts; unitsPerBlock?: number } | undefined>;

const table = (data?: CompiledDataLike): PrestigeTable | undefined => data?.tables?.prestige as PrestigeTable | undefined;

/** A prestige project row (`project.<id>`), or `undefined` when unknown or W13 is off (its rows are dropped). */
export function prestigeProjectRow(project: string, data?: CompiledDataLike): PrestigeProjectRow | undefined {
  const row = project.startsWith('project.') ? table(data)?.[project] : undefined;
  if (!row?.cost) return undefined;
  return { id: project, label: row.label ?? project, cost: { ...row.cost }, buildTicks: Math.max(1, Number(row.buildS ?? 1)) };
}

/** The cargo transport recipe, or `null` when W13 is off: export / import then run exactly as before. */
export function transportRow(data?: CompiledDataLike): TransportRow | null {
  const row = table(data)?.['transport.cargo'];
  if (!row?.cost || !(Number(row.unitsPerBlock) > 0)) return null;
  return { unitsPerBlock: Number(row.unitsPerBlock), cost: { ...row.cost } };
}

/** Every project id compiled in (empty when W13 is off), sorted. */
export function prestigeProjectIds(data?: CompiledDataLike): string[] {
  return Object.keys(table(data) ?? {}).filter((k) => k.startsWith('project.')).sort();
}
