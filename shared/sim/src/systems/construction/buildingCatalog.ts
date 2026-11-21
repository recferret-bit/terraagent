import type { CompiledRow } from '../../data';
import { TICK_MS } from '../../kernel/constants';
import type { CompiledDataLike } from '../../kernel/config';

/**
 * One building, as a designer edits it. The numbers live in the sim data tables
 * (`hub`, `economyT1Basic`, `grid`, `combatUnits`, `tradeHub`). This is the single
 * read of those rows: footprint, time, price, HP, power, and placement. The host
 * publishes it on welcome; `dataHash` is the check that both sides compiled the same tables.
 */
export interface BuildingSpec {
  id: string;
  building: string;
  label: string;
  tier: number;
  footprintW: number;
  footprintD: number;
  buildS: number;
  hp: number;
  /** Power drawn while the building runs. Generators also set `powerGenPerS`. */
  powerDrainPerS: number;
  powerGenPerS: number;
  cost: Record<string, number>;
  archetype: string;
  /** The row's `requiresDeposit` family name, or null when the row has none. */
  requiresDeposit: string | null;
  hqOnly: boolean;
  /**
   * `allowUnclaimedPlacement` when the row sets it. Economy, grid, combat and trade rows that omit it
   * allow unclaimed ground, matching `resolvePlacementRule`, unless the row sets the flag false.
   */
  allowUnclaimed: boolean;
  /** Null when the row omits it or the cap is not finite. */
  maxPerColony: number | null;
}

const BUILDING_TABLES = ['hub', 'economyT1Basic', 'grid', 'combatUnits', 'tradeHub'] as const;

function num(row: CompiledRow, key: string, fallback = 0): number {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Tables whose building rows allow unclaimed ground when `allowUnclaimedPlacement` is omitted. */
const UNCLAIMED_WHEN_OMITTED = new Set(['economyT1Basic', 'grid', 'combatUnits', 'tradeHub']);

function allowUnclaimedOf(row: CompiledRow, table: string): boolean {
  if (row.allowUnclaimedPlacement === false) return false;
  if (row.allowUnclaimedPlacement === true) return true;
  return UNCLAIMED_WHEN_OMITTED.has(table);
}

function maxPerColonyOf(row: CompiledRow): number | null {
  const v = row.maxPerColony;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function costOf(row: CompiledRow): Record<string, number> {
  const cost = row.cost;
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(cost)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function asRow(row: CompiledRow, table: string): BuildingSpec | null {
  if (row.kind !== undefined && row.kind !== 'building') return null;
  const building = typeof row.building === 'string' ? row.building : '';
  if (!building) return null;
  const fp = num(row, 'footprint', 1);
  const gross = num(row, 'grossOutputPerS');
  const net = gross > 0 ? gross - num(row, 'internalDrainPerS') : num(row, 'netOutputPerS') + num(row, 'founderCoreGenPerS');
  return {
    id: String(row.id ?? building),
    building,
    label: typeof row.label === 'string' ? row.label : building,
    tier: num(row, 'tier', 1),
    footprintW: num(row, 'footprintW', fp),
    footprintD: num(row, 'footprintD', fp),
    buildS: num(row, 'designBuildS', (num(row, 'buildS') * TICK_MS) / 1000),
    hp: num(row, 'hp'),
    powerDrainPerS: num(row, 'powerDrainPerS'),
    powerGenPerS: net > 0 ? net : 0,
    cost: costOf(row),
    archetype: typeof row.archetype === 'string' ? row.archetype : `building.${building}`,
    requiresDeposit: typeof row.requiresDeposit === 'string' ? row.requiresDeposit : null,
    hqOnly: row.hqOnly === true,
    allowUnclaimed: allowUnclaimedOf(row, table),
    maxPerColony: maxPerColonyOf(row),
  };
}

/** Every building row in the compiled balance data, in table order. Edit the data tables, not a second copy. */
export function buildingCatalog(data: CompiledDataLike): BuildingSpec[] {
  const out: BuildingSpec[] = [];
  const seen = new Set<string>();
  for (const name of BUILDING_TABLES) {
    const table = data.tables[name] as Record<string, CompiledRow> | undefined;
    if (!table) continue;
    for (const row of Object.values(table)) {
      const spec = asRow(row, name);
      if (!spec) continue;
      const key = `${spec.building}:${spec.tier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(spec);
    }
  }
  return out;
}
