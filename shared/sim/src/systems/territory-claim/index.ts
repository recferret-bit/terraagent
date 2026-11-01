import { hexDistance, hexIndex } from '../../grid/hex';
import { isValidTileIndex, setTileOwner } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { ColonyCaps } from '../../economy';
import { ensureColonyRecord } from '../../kernel/colonies';
import { touchTile, type ColonyState, type PlanetState } from '../../kernel/state';
import type { ConstructionOrder } from '../construction';
import { resolveHubT1Row } from '../construction/placement';
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

function normalizeClaimOpts(
  optsOrColonyId: ClaimTerritoryOpts | number,
  qArg?: number,
  rArg?: number,
  radiusArg?: number,
  tickArg?: number,
  dataArg?: CompiledDataLike,
): ClaimTerritoryOpts {
  if (typeof optsOrColonyId === 'number') {
    return {
      colonyId: optsOrColonyId,
      q: qArg ?? 0,
      r: rArg ?? 0,
      radius: radiusArg,
      tick: tickArg,
      data: dataArg,
    };
  }
  return optsOrColonyId;
}

/**
 * Claims territory in hex disc radius `radius` (defaults to `hub.t1.claimRadius = 10`) around `(q, r)` for `colonyId`
 * (`colony-economy-and-buildings-spec.md` §2.1, `SIM-G-TER`, `W01-17`):
 * - Unclaimed (`owner === -1`) -> `owner = colonyId`, `anchors += 1`.
 * - Same owner (`owner === colonyId`) -> `anchors += 1` (redundant anchor reinforcement).
 * - Foreign owner (`owner >= 0 && owner !== colonyId`) -> immutable collision: `owner` and `anchors` remain untouched (frozen border).
 */
export function claimTerritoryRadius(
  state: PlanetState,
  optsOrColonyId: ClaimTerritoryOpts | number,
  qArg?: number,
  rArg?: number,
  radiusArg?: number,
  tickArg?: number,
  dataArg?: CompiledDataLike,
): ClaimTerritoryResult {
  const opts = normalizeClaimOpts(optsOrColonyId, qArg, rArg, radiusArg, tickArg, dataArg);
  const hubRow = resolveHubT1Row(opts.data);
  const radius = Math.max(0, Math.floor(opts.radius ?? Number(hubRow.claimRadius ?? 10)));
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
        setTileOwner(state.grid, tileIdx, opts.colonyId, opts.tick);
        anchorsLayer[tileIdx] = (anchorsLayer[tileIdx] ?? 0) + 1;
        claimedCount++;
        claimedTiles.push({ q: tq, r: tr, tileIdx });
      } else if (curOwner === opts.colonyId) {
        anchorsLayer[tileIdx] = (anchorsLayer[tileIdx] ?? 0) + 1;
        if (opts.tick !== undefined) {
          touchTile(state, tileIdx, opts.tick);
        } else {
          setTileOwner(state.grid, tileIdx, opts.colonyId);
        }
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
 * - Claims `R = 10` territory around `(order.q, order.r)` respecting immutable foreign borders.
 * - Sets colony `status = 'active'`, per-family storage cap `500` (`metals`, `minerals`, `bio`),
 *   `supplyCap = 10`, and Founder Core `+8 E/s` (`founderCoreEPerS`, `powerGenEPerS`).
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
  const claimRadius = Number(hubRow.claimRadius ?? 10);
  const storageCap = Number(hubRow.storageCapPerFamily ?? 500);
  const supplyCap = Number(hubRow.supplyCap ?? 10);
  const founderCoreEPerS = Number(
    hubRow.founderCoreEPerS ?? hubRow.founderCoreGenPerS ?? hubRow.powerGen ?? 8,
  );

  const claim = claimTerritoryRadius(state, {
    colonyId: order.colonyId,
    q: order.q,
    r: order.r,
    radius: claimRadius,
    tick,
    data,
  });

  const col = ensureColonyRecord(state, order.colonyId, tick);
  const caps: ColonyCaps = {
    metals: storageCap,
    minerals: storageCap,
    energy: 0,
    bio: storageCap,
    item: 0,
  };
  col.status = 'active';
  col.caps = caps;
  col.supplyCap = supplyCap;
  col.powerGenEPerS = founderCoreEPerS;
  col.founderCoreEPerS = founderCoreEPerS;
  col.founderCoreGenPerS = founderCoreEPerS;
  col.hubEntityId = order.entityId;
  col.hubId = order.entityId;
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
