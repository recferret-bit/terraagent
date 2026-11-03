import { findSpecFromRow, TERRAFORM_RESOURCE_SPAWN, type TerraformFindSpec } from '../../data/terraform-finds';
import type { CompiledDataLike } from '../../kernel/config';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import { setTileDeposit } from '../../grid/tileModel';
import type { StepContext } from '../../kernel/context';
import { nextFloat } from '../../kernel/rng';
import type { PlanetState } from '../../kernel/state';
import { isUnitKind } from '../../units/mobility';

/**
 * The 1 % resource deposit roll of a completed ground terraform job (`terraformFinds.deposit`, owner decision W02).
 * The roll draws from the `misc` rng stream: deterministic on every host, but every client receives stream states, so
 * a modified client can predict it (see `kernel/rng.ts`).
 */

export type DepositTier = 1 | 2 | 3;
export type SpawnFamily = (typeof TERRAFORM_RESOURCE_SPAWN.families)[number];
export interface DepositSpawn {
  deposit: SpawnFamily;
  tier: DepositTier;
  richnessBp: number;
}

const TIERS: readonly DepositTier[] = [1, 2, 3];

/** The tier a uniform draw `r` in `[0, 1)` picks by the table's weights (t1 below 0.5, t2 below 0.85, else t3). */
export function pickSpawnTier(r: number, weights: Readonly<Record<DepositTier, number>> = TERRAFORM_RESOURCE_SPAWN.tierWeights): DepositTier {
  const total = TIERS.reduce((s, t) => s + weights[t], 0);
  let acc = 0;
  for (const t of TIERS) {
    acc += weights[t];
    if (r * total < acc) return t;
  }
  return 3;
}

/**
 * Pure spawn decision from three uniform draws in `[0, 1)`: `rChance` below `chance` spawns; `rTier` picks the tier,
 * `rFamily` the family (uniform over `families`). `null` = nothing spawns.
 */
export function pickSpawn(rChance: number, rTier: number, rFamily: number, table: TerraformFindSpec = TERRAFORM_RESOURCE_SPAWN): DepositSpawn | null {
  if (!(rChance < table.chance) || table.families.length === 0) return null;
  const fams = table.families;
  const deposit = fams[Math.min(fams.length - 1, Math.floor(rFamily * fams.length))]!;
  return { deposit, tier: pickSpawnTier(rTier, table.tierWeights), richnessBp: table.richnessBp };
}

const specCache = new WeakMap<CompiledDataLike, TerraformFindSpec>();
const NO_FINDS: TerraformFindSpec = { ...TERRAFORM_RESOURCE_SPAWN, chance: 0 };

/**
 * The deposit-find numbers in force (`terraformFinds.deposit` of compiled data, so a `tune` applies; the file row
 * without data; chance 0 when the data lacks the W02 row). The UI reads this to show the odds.
 */
export function terraformFindSpec(data?: CompiledDataLike): TerraformFindSpec {
  if (!data) return TERRAFORM_RESOURCE_SPAWN;
  const row = (data.tables.terraformFinds as Record<string, Record<string, never>> | undefined)?.deposit;
  if (!row) return NO_FINDS; // no flag, no feature: data without the W02 row (a W01 planet) finds nothing
  let spec = specCache.get(data);
  if (!spec) specCache.set(data, (spec = findSpecFromRow(row)));
  return spec;
}

/** Rolls with `rand` (one draw; two more only on a hit) against `table`. */
export function rollTerraformSpawn(rand: () => number, table: TerraformFindSpec = TERRAFORM_RESOURCE_SPAWN): DepositSpawn | null {
  const rChance = rand();
  if (!(rChance < table.chance)) return null;
  return pickSpawn(rChance, rand(), rand(), table);
}

/** Whether an alive unit stands on tile `tileIdx` (a deposit must not appear under it: deposits are impassable). */
function unitStandsOn(state: PlanetState, tileIdx: number): boolean {
  const e = state.entities, cols = e.cols;
  const hx = hexIndex(state.grid.radius);
  for (let row = 0; row < e.count; row++) {
    if (cols.hp[row] > 0 && isUnitKind(cols.kind[row]) && hx.indexOf(Math.round(cols.q[row]), Math.round(cols.r[row])) === tileIdx) return true;
  }
  return false;
}

/**
 * After a ground terraform job on `tileIdx` finished (and the buried deposit was revealed): if the hex still has no
 * deposit and no unit stands on it, roll; on a hit write the deposit with its tier (stamped, so the delta carries it)
 * and emit `resourceSpawned` to `who` (the colony's `colonyId` / `playerId`).
 */
export function spawnTerraformDeposit(
  state: PlanetState,
  tile: { tileIdx: number; q: number; r: number },
  who: { colonyId: string; playerId?: string },
  ctx: StepContext,
  rand: () => number = () => nextFloat(ctx.rng('misc')),
): DepositSpawn | null {
  const { tileIdx, q, r } = tile;
  if (state.grid.layers.deposit[tileIdx] !== DEPOSIT.none || unitStandsOn(state, tileIdx)) return null;
  const spawn = rollTerraformSpawn(rand, terraformFindSpec(ctx.data));
  if (!spawn) return null;
  setTileDeposit(state.grid, tileIdx, DEPOSIT[spawn.deposit], spawn.richnessBp, ctx.tick, spawn.tier);
  ctx.emit({
    kind: 'resourceSpawned',
    severity: 'info',
    colonyIds: [who.colonyId],
    data: { ...who, q, r, deposit: spawn.deposit, tier: spawn.tier, richnessBp: spawn.richnessBp },
  });
  return spawn;
}
