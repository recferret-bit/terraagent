import { W01_TERRAFORM_OPS, type ResourceKey, type TerraformOp } from '@terra/contracts';
import { prepIdFromKey, terrainIdFromKey } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { defaultW01Data, rowNum, ticksToSeconds, w01Row } from '../rows';

/** The S0 terraform ops: the contracts' list is the one list (XC-13). */
export type TerraformOpKind = TerraformOp;

const VALID_OPS: ReadonlySet<string> = new Set(W01_TERRAFORM_OPS);

export function isTerraformOpKind(op: unknown): op is TerraformOpKind {
  return typeof op === 'string' && VALID_OPS.has(op);
}

export interface TerraformOpSpec {
  op: TerraformOpKind;
  /** Nominal duration in seconds at work rate 1.0 (`timeS`, compiled to ticks, converted back). */
  baseTimeS: number;
  energyCostE: number;
  yieldResource: ResourceKey | null;
  yieldAmount: number;
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

function readSpec(op: TerraformOpKind, data: CompiledDataLike): TerraformOpSpec {
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
    yieldResource: typeof row.yieldResource === 'string' ? (row.yieldResource as ResourceKey) : null,
    yieldAmount: rowNum(row, 'yieldAmount'),
    fromTerrain: terrainIdFromKey(key('fromTerrain')),
    toTerrain: terrainIdFromKey(key('toTerrain')),
    toPrep: prepIdFromKey(key('toPrep')),
  };
}

/** The op that works a tile of `terrain` (the op whose `fromTerrain` it is; Grade for flat ground), or `null`. */
export function opForTerrain(terrain: number, data?: CompiledDataLike): TerraformOpKind | null {
  for (const op of W01_TERRAFORM_OPS) if (getTerraformOpSpec(op, data).fromTerrain === terrain) return op;
  return null;
}
