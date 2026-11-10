import { W11_DEFAULT_SECTOR_RADIUS, type SectorId } from '@terra/contracts';
import {
  resolveColonyFoundingSectorMap,
  resolveTileSector,
} from '../../atlas/crossSectorGameplay';
import { ENTITY_STATE } from '../../ecs/columns';
import { hexIndex } from '../../grid/hex';
import type { PlanetState } from '../../kernel/state';
import { getPvpState, savePvpState } from './store';

/**
 * Returns `true` when cross-sector PvP raids/orders are explicitly enabled on `state.blobs.pvp` or `state.blobs.atlas`.
 * By default (`false`), W11 founding sectors (`R = 48`) are isolated and cross-sector raid orders reject with `'cross_sector_disabled'`.
 */
export function isCrossSectorRaidEnabled(state: PlanetState): boolean {
  const pvpCross = getPvpState(state).crossSectorEnabled;
  if (typeof pvpCross === 'boolean') return pvpCross;
  const atlasCross = (
    state.blobs.atlas?.value as { crossSectorEnabled?: boolean } | undefined
  )?.crossSectorEnabled;
  return Boolean(atlasCross);
}

/** Sets whether cross-sector PvP raids are allowed on `state`. */
export function setCrossSectorRaidEnabled(
  state: PlanetState,
  enabled: boolean,
  tick = state.meta.tick,
): void {
  const pvpState = getPvpState(state);
  pvpState.crossSectorEnabled = enabled;
  savePvpState(state, pvpState, tick);
}

/** Resolves the founding sector ID (`sec_0_0`, `sec_1_0`, etc.) of `colonyIndex`. */
export function resolveColonySectorId(state: PlanetState, colonyIndex: number): SectorId {
  const col = state.colonies[colonyIndex];
  if (typeof col?.foundingSectorId === 'string' && col.foundingSectorId.startsWith('sec_')) {
    return col.foundingSectorId as SectorId;
  }
  if (typeof col?.sectorId === 'string' && col.sectorId.startsWith('sec_')) {
    return col.sectorId as SectorId;
  }
  const map = resolveColonyFoundingSectorMap(state);
  const fromMap = map.get(colonyIndex);
  if (fromMap) return fromMap;
  return 'sec_0_0';
}

export type SectorRaidGuardResult =
  | {
      ok: true;
      sectorId: SectorId;
    }
  | {
      ok: false;
      code: 'cross_sector_disabled';
      attackerSectorId: SectorId;
      targetSectorId: SectorId;
    };

/**
 * Checks whether `attackerColony` is permitted to raid or attack `targetColony` under W11 sector isolation (`W18-31`).
 */
export function canRaidTargetSector(
  state: PlanetState,
  attackerColony: number,
  targetColony: number,
): SectorRaidGuardResult {
  const attackerSectorId = resolveColonySectorId(state, attackerColony);
  const targetSectorId = resolveColonySectorId(state, targetColony);
  if (attackerSectorId !== targetSectorId && !isCrossSectorRaidEnabled(state)) {
    return {
      ok: false,
      code: 'cross_sector_disabled',
      attackerSectorId,
      targetSectorId,
    };
  }
  return {
    ok: true,
    sectorId: attackerSectorId,
  };
}

/**
 * Checks whether `attackerColony` may `attackMove` to tile `(q, r)` under W11 sector isolation (`W18-31`).
 */
export function canAttackMoveToTileSector(
  state: PlanetState,
  attackerColony: number,
  q: number,
  r: number,
): { ok: true } | { ok: false; code: 'cross_sector_disabled' } {
  if (isCrossSectorRaidEnabled(state)) return { ok: true };

  const tileIdx = hexIndex(state.grid.radius).indexOf(q, r);
  if (tileIdx >= 0) {
    const tileOwner = state.grid.layers.owner?.[tileIdx] ?? -1;
    if (tileOwner >= 0 && tileOwner !== attackerColony) {
      const check = canRaidTargetSector(state, attackerColony, tileOwner);
      if (!check.ok) return { ok: false, code: 'cross_sector_disabled' };
    }
  }

  const cols = state.entities.cols;
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.hp[row]! <= 0 || cols.state[row] === ENTITY_STATE.inert) continue;
    if (cols.q[row] === q && cols.r[row] === r) {
      const entOwner = cols.owner[row]!;
      if (entOwner >= 0 && entOwner !== attackerColony) {
        const check = canRaidTargetSector(state, attackerColony, entOwner);
        if (!check.ok) return { ok: false, code: 'cross_sector_disabled' };
      }
    }
  }

  const attackerSectorId = resolveColonySectorId(state, attackerColony);
  const tileSector = resolveTileSector(state, q, r)?.sectorId;
  if (
    tileSector &&
    tileSector !== attackerSectorId &&
    (state.grid.radius > W11_DEFAULT_SECTOR_RADIUS || tileSector !== 'sec_0_0')
  ) {
    return { ok: false, code: 'cross_sector_disabled' };
  }

  return { ok: true };
}
