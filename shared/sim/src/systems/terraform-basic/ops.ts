import { W01_TERRAFORM_OPS, W02_TERRAFORM_OPS, type ResourceKey, type TerraformOp } from '@terra/contracts';
import { TERRAFORM_TIME_TABLE } from '../../data/ops-basic';
import { prepIdFromKey, terrainIdFromKey } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { defaultW01Data, rowNum, ticksToSeconds, w01Row } from '../rows';

/** The S0 terraform ops: the contracts' list is the one list (XC-13). */
export type TerraformOpKind = TerraformOp;

const VALID_OPS: ReadonlySet<string> = new Set(W02_TERRAFORM_OPS);
const VALID_W01_OPS: ReadonlySet<string> = new Set(W01_TERRAFORM_OPS);

export function isTerraformOpKind(op: unknown): op is TerraformOpKind {
  return typeof op === 'string' && VALID_OPS.has(op);
}

export function isW01TerraformOpKind(op: unknown): op is (typeof W01_TERRAFORM_OPS)[number] {
  return typeof op === 'string' && VALID_W01_OPS.has(op);
}

export interface TerraformOpSpec {
  op: TerraformOpKind;
  /** Nominal duration in seconds at work rate 1.0 (`timeS`, compiled to ticks, converted back). */
  baseTimeS: number;
  energyCostE: number;
  /** What one worked tile pays (`opsBasic.<op>.yields`, whole units, a lump sum). */
  yields: Readonly<Partial<Record<ResourceKey, number>>>;
  /** The tile rule (`fromTerrain` → `toTerrain` + `toPrep`), as `TERRAIN` / `PREP` codes (GP-34). */
  fromTerrain: number;
  toTerrain: number;
  toPrep: number;
}

const specCache = new WeakMap<CompiledDataLike, Map<TerraformOpKind, TerraformOpSpec>>();

/** The balance row of `op` (`opsBasic.<op>`): time, energy, yield and the tile rule. Throws on a missing field. */
export function getTerraformOpSpec(op: TerraformOpKind, data?: CompiledDataLike): TerraformOpSpec {
  const src = data ?? defaultW01Data();
  let byOp = specCache.get(src);
  if (!byOp) specCache.set(src, (byOp = new Map()));
  let spec = byOp.get(op);
  if (!spec) byOp.set(op, (spec = readSpec(op, src)));
  return spec;
}

function readYields(v: unknown, op: string): Partial<Record<ResourceKey, number>> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`data row opsBasic.${op}.yields is not a resource map`);
  return Object.freeze({ ...(v as Partial<Record<ResourceKey, number>>) });
}

function readSpec(op: TerraformOpKind, data: CompiledDataLike): TerraformOpSpec {
  if (op === 'dismantle') {
    return {
      op,
      baseTimeS: TERRAFORM_TIME_TABLE.dismantle.durationSec,
      energyCostE: TERRAFORM_TIME_TABLE.dismantle.energyCost,
      yields: {},
      fromTerrain: 0,
      toTerrain: 0,
      toPrep: 0,
    };
  }
  if (op === 'work') {
    return {
      op,
      baseTimeS: TERRAFORM_TIME_TABLE.flat.durationSec,
      energyCostE: TERRAFORM_TIME_TABLE.flat.energyCost,
      yields: {},
      fromTerrain: 0,
      toTerrain: 0,
      toPrep: 1,
    };
  }
  const row = w01Row(data, 'opsBasic', op);
  const key = (field: string): string => {
    const v = row[field];
    if (typeof v !== 'string') throw new Error(`data row opsBasic.${op}.${field} is not a key`);
    return v;
  };
  return {
    op,
    baseTimeS: ticksToSeconds(rowNum(row, 'timeS')),
    energyCostE: rowNum(row, 'energyCostE'),
    yields: readYields(row.yields, op),
    fromTerrain: terrainIdFromKey(key('fromTerrain')),
    toTerrain: terrainIdFromKey(key('toTerrain')),
    toPrep: prepIdFromKey(key('toPrep')),
  };
}

/** The op that works a tile of `terrain` (the op whose `fromTerrain` it is; Grade for flat ground), or `null`. */
export function opForTerrain(terrain: number, data?: CompiledDataLike): (typeof W01_TERRAFORM_OPS)[number] | null {
  for (const op of W01_TERRAFORM_OPS) if (getTerraformOpSpec(op, data).fromTerrain === terrain) return op;
  return null;
}

/**
 * THE terraform yield of one tile worked by `op` (`opsBasic.<op>.yields`; Clear = a tree, Break = a rock, Grade = none),
 * from compiled data so a `tune` shows up. The UI reads this too.
 */
export function terraformYields(op: TerraformOpKind, data?: CompiledDataLike): Partial<Record<ResourceKey, number>> {
  return { ...getTerraformOpSpec(op, data).yields };
}

/** The yield of a `work` job on ground `key` (forest → Clear's, rock → Break's, slope / hole / Flat → none). */
export function groundWorkYields(key: string, data?: CompiledDataLike): Partial<Record<ResourceKey, number>> {
  return key === 'forest' ? terraformYields('clear', data) : key === 'rock' ? terraformYields('break', data) : {};
}
