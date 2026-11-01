import { hexDistance, hexIndex } from '../../grid/hex';
import { isValidTileIndex, setTileOwner } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { getColonyCaps, type ColonyCaps } from '../../economy';
import { ensureColonyRecord } from '../../kernel/colonies';
import { touchTile, type ColonyState, type PlanetState } from '../../kernel/state';
import type { ConstructionOrder } from '../construction/orders';
import { resolveHubT1Row, rowNum } from '../rows';
import { defineSimModule } from '../define';

export interface ClaimedTileInfo {
  q: number;
  r: number;
  tileIdx: number;
}

export interface ClaimTerritoryOpts {
  colonyId: number;
  q: number;
  r: number;
  radius?: number;
  tick?: number;
  data?: CompiledDataLike;
}

export interface ClaimTerritoryResult {
  claimedCount: number;
  anchoredCount: number;
  frozenCount: number;
  claimedTiles: ClaimedTileInfo[];
}

export interface HubCompletionResult extends ClaimTerritoryResult {
  colony: ColonyState;
}

/**
 * Claims territory in hex disc radius `radius` (defaults to `hub.t1.claimRadius`) around `(q, r)` for `colonyId`
 * (`colony-economy-and-buildings-spec.md` §2.1, `SIM-G-TER`, `W01-17`):
 * - Unclaimed (`owner === -1`) -> `owner = colonyId`, `anchors += 1`.
 * - Same owner (`owner === colonyId`) -> `anchors += 1` (redundant anchor reinforcement).
 * - Foreign owner (`owner >= 0 && owner !== colonyId`) -> immutable collision: `owner` and `anchors` remain untouched (frozen border).
 */
export function claimTerritoryRadius(state: PlanetState, opts: ClaimTerritoryOpts): ClaimTerritoryResult {
  const radius = Math.max(0, Math.floor(opts.radius ?? rowNum(resolveHubT1Row(opts.data), 'claimRadius')));
  const tick = opts.tick ?? state.meta.tick;
  const hex = hexIndex(state.grid.radius);
  const ownerLayer = state.grid.layers.owner as Int8Array;
  const anchorsLayer = state.grid.layers.anchors as Uint8Array;

  let claimedCount = 0;
  let anchoredCount = 0;
  let frozenCount = 0;
  const claimedTiles: ClaimedTileInfo[] = [];

  for (let dr = -radius; dr <= radius; dr++) {
    const dqMin = Math.max(-radius, -dr - radius);
    const dqMax = Math.min(radius, -dr + radius);
    for (let dq = dqMin; dq <= dqMax; dq++) {
      const tq = opts.q + dq;
      const tr = opts.r + dr;
      if (hexDistance(opts.q, opts.r, tq, tr) > radius) continue;
      const tileIdx = hex.indexOf(tq, tr);
      if (tileIdx < 0 || !isValidTileIndex(state.grid, tileIdx)) continue;

      const curOwner = ownerLayer[tileIdx] ?? -1;
      if (curOwner === -1) {
        setTileOwner(state.grid, tileIdx, opts.colonyId, tick);
        anchorsLayer[tileIdx] = (anchorsLayer[tileIdx] ?? 0) + 1;
        claimedCount++;
        claimedTiles.push({ q: tq, r: tr, tileIdx });
      } else if (curOwner === opts.colonyId) {
        anchorsLayer[tileIdx] = (anchorsLayer[tileIdx] ?? 0) + 1;
        touchTile(state, tileIdx, tick);
        anchoredCount++;
      } else {
        frozenCount++;
      }
    }
  }

  return { claimedCount, anchoredCount, frozenCount, claimedTiles };
}

/**
 * Applies Command Hub T1 completion effects (`colony-economy-and-buildings-spec.md` §2.1, §3.1, `W01-17`):
 * - Claims `hub.t1.claimRadius` territory around `(order.q, order.r)` respecting immutable foreign borders.
 * - Sets colony `status = 'active'`, raises each family's storage cap to `hub.t1.storageCapPerFamily` (a cap never goes
 *   down, GP-11), `supplyCap` and the Founder Core generation `founderCoreGenPerS` (one colony field, XC-01).
 * - Emits `colonyFounded`.
 */
export function applyHubCompletionEffects(
  state: PlanetState,
  order: ConstructionOrder,
  tick: number = state.meta.tick,
  ctx?: Partial<StepContext>,
): HubCompletionResult {
  const data = ctx?.data;
  const hubRow = resolveHubT1Row(data);
  const storageCap = rowNum(hubRow, 'storageCapPerFamily');

  const claim = claimTerritoryRadius(state, {
    colonyId: order.colonyId,
    q: order.q,
    r: order.r,
    tick,
    data,
  });

  const col = ensureColonyRecord(state, order.colonyId, tick);
  const prev = getColonyCaps(state, order.colonyId, data);
  const caps: ColonyCaps = {
    metals: Math.max(prev.metals, storageCap),
    minerals: Math.max(prev.minerals, storageCap),
    energy: prev.energy,
    bio: Math.max(prev.bio, storageCap),
    item: prev.item,
  };
  col.status = 'active';
  col.caps = caps;
  col.supplyCap = rowNum(hubRow, 'supplyCap');
  col.founderCoreGenPerS = rowNum(hubRow, 'founderCoreGenPerS');
  col.hubEntityId = order.entityId;
  col.changedAt = tick;

  const colonyIdStr = col.id || `col_${order.colonyId}`;
  const playerId = typeof col.playerId === 'string' && col.playerId.length > 0 ? col.playerId : undefined;
  ctx?.emit?.({
    kind: 'colonyFounded',
    severity: 'info',
    colonyIds: [colonyIdStr],
    data: {
      colonyId: colonyIdStr,
      ...(playerId ? { playerId } : {}),
      hubId: order.entityId,
      q: order.q,
      r: order.r,
    },
  });

  return { ...claim, colony: col };
}

export default defineSimModule({
  id: 'territory-claim',
  wave: 'W01',
});
