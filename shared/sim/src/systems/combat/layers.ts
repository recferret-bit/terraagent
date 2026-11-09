import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';

export type CombatLayer = 'ground' | 'air';

export const COMBAT_LAYERS_BLOB = 'combatLayers';

export interface CombatLayersBlob {
  byEntityId: Record<number, CombatLayer>;
}

const W07_WAVE_SET = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
let cachedW07Data: CompiledDataLike | null = null;

function defaultW07Data(): CompiledDataLike {
  if (!cachedW07Data) cachedW07Data = compileData(W07_WAVE_SET);
  return cachedW07Data;
}

function lookupRow(data: CompiledDataLike | undefined, table: string, id: string): CompiledRow | undefined {
  const tbl = data?.tables[table] as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  return tbl?.[id];
}

const KIND_TO_ROW_ID: Readonly<Record<number, string>> = {
  [ENTITY_KIND.hq]: 'hq',
  [ENTITY_KIND.commandHub]: 'commandHub',
  [ENTITY_KIND.worker]: 'worker',
  [ENTITY_KIND.roboticsFactory]: 'roboticsFactory',
  [ENTITY_KIND.droneControlArray]: 'droneControlArray',
  [ENTITY_KIND.autocannon]: 'autocannon',
  [ENTITY_KIND.laserTower]: 'laserTower',
  [ENTITY_KIND.recon]: 'recon',
  [ENTITY_KIND.blackAnt]: 'blackAnt',
  [ENTITY_KIND.blueBeetle]: 'blueBeetle',
  [ENTITY_KIND.greenSpitter]: 'greenSpitter',
  [ENTITY_KIND.hiveBlackAnt]: 'hiveBlackAnt',
  [ENTITY_KIND.hiveBlueBeetle]: 'hiveBlueBeetle',
  [ENTITY_KIND.hiveGreenSpitter]: 'hiveGreenSpitter',
};

function readLayersBlob(state: PlanetState): Record<number, CombatLayer> {
  const raw = state.blobs[COMBAT_LAYERS_BLOB]?.value as Partial<CombatLayersBlob> | undefined;
  return raw?.byEntityId ?? {};
}

/**
 * Resolves the combat layer (`'ground'` | `'air'`) for an entity row (`UO-C-05`).
 * Checks `state.blobs.combatLayers` (`byEntityId[id]`) first, then looks up the unit/fauna row in `data`.
 */
export function getEntityCombatLayer(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): CombatLayer {
  if (row < 0 || row >= state.entities.count) return 'ground';
  const cols = state.entities.cols;
  const entityId = cols.id[row]!;
  const override = readLayersBlob(state)[entityId];
  if (override === 'air' || override === 'ground') return override;

  const rowId = KIND_TO_ROW_ID[cols.kind[row]!];
  if (!rowId) return 'ground';

  const fallback = defaultW07Data();
  const unitRow =
    lookupRow(data, 'combatUnits', rowId) ??
    lookupRow(data, 'fauna', rowId) ??
    lookupRow(fallback, 'combatUnits', rowId) ??
    lookupRow(fallback, 'fauna', rowId);

  return unitRow?.layer === 'air' ? 'air' : 'ground';
}

/**
 * Sets an explicit combat layer override (`'ground'` | `'air'`) for `entityId` in `state.blobs.combatLayers`.
 */
export function setEntityCombatLayer(
  state: PlanetState,
  entityId: number,
  layer: CombatLayer,
  tick = state.meta.tick,
): void {
  const prev = readLayersBlob(state);
  setBlob(state, COMBAT_LAYERS_BLOB, { byEntityId: { ...prev, [entityId]: layer } }, tick);
}

/**
 * Checks whether a weapon row can hit targets on `targetLayer` (`UO-C-05`).
 * Defaults `hitsGround` to `true` unless explicitly `false`; `hitsAir` must be truthy to hit `'air'`.
 */
export function canWeaponHitLayer(
  weaponRow: Record<string, unknown> | undefined,
  targetLayer: CombatLayer,
): boolean {
  if (!weaponRow) return false;
  if (targetLayer === 'air') return Boolean(weaponRow.hitsAir);
  if (targetLayer === 'ground') return weaponRow.hitsGround !== false;
  return false;
}

/**
 * Checks whether `weaponRow` can hit the entity at `targetRow` based on its resolved combat layer.
 */
export function canWeaponHitTarget(
  state: PlanetState,
  weaponRow: Record<string, unknown> | undefined,
  targetRow: number,
  data?: CompiledDataLike,
): boolean {
  if (!weaponRow || targetRow < 0 || targetRow >= state.entities.count) return false;
  const layer = getEntityCombatLayer(state, targetRow, data);
  return canWeaponHitLayer(weaponRow, layer);
}

/**
 * Filters `candidateRows` (where `hp > 0`) by `canWeaponHitTarget` and picks the closest by `hexDistance`
 * (tie-broken by lowest entity `id`), returning the winning row or `-1`.
 */
export function pickClosestValidLayerTarget(
  state: PlanetState,
  attackerQ: number,
  attackerR: number,
  weaponRow: Record<string, unknown> | undefined,
  candidateRows: readonly number[],
  data?: CompiledDataLike,
): number {
  if (!weaponRow) return -1;
  const cols = state.entities.cols;
  let bestRow = -1;
  let bestDist = Infinity;
  let bestId = Infinity;

  for (const row of candidateRows) {
    if (row < 0 || row >= state.entities.count) continue;
    if (cols.hp[row]! <= 0) continue;
    if (!canWeaponHitTarget(state, weaponRow, row, data)) continue;

    const dist = hexDistance(attackerQ, attackerR, cols.q[row]!, cols.r[row]!);
    const id = cols.id[row]!;
    if (dist < bestDist || (dist === bestDist && id < bestId)) {
      bestDist = dist;
      bestId = id;
      bestRow = row;
    }
  }

  return bestRow;
}
