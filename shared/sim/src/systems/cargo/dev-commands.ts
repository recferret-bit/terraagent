import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { TERRAIN } from '../../grid/layers';
import { bumpPathEpoch, setTilePrep } from '../../grid/tileModel';
import { defineCommandHandler } from '../../kernel/commands';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { occupiedGroundTiles } from '../construction/occupancy';
import { getBuildingFootprintTiles } from '../construction/placement';
import { ensureColonyLedger } from '../economy/ledger';
import { findColonyEntityRow, findColonyHqRow } from '../find';
import { ensureColonyCargoCapState, resetColonyCargoCaps } from './caps';

function ensureColony(state: PlanetState, colonyIndex: number, tick: number): ColonyState {
  let col = state.colonies.find((c) => c && c.index === colonyIndex) ?? state.colonies[colonyIndex];
  if (!col) {
    col = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0xff6b00,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[colonyIndex] = col;
  }
  return ensureColonyLedger(col);
}

function resolveColonyIndex(args?: Record<string, unknown>, cmdColonyIndex?: number | null): number {
  if (typeof args?.colonyIndex === 'number' && Number.isInteger(args.colonyIndex) && args.colonyIndex >= 0) {
    return args.colonyIndex;
  }
  if (typeof cmdColonyIndex === 'number' && Number.isInteger(cmdColonyIndex) && cmdColonyIndex >= 0) {
    return cmdColonyIndex;
  }
  return 0;
}

function findFreeFootprint2x2(state: PlanetState, centerQ: number, centerR: number): { q: number; r: number } {
  const occupied = occupiedGroundTiles(state);
  const idx = hexIndex(state.grid.radius);
  const maxRadius = Math.min(15, state.grid.radius);

  for (let dist = 2; dist <= maxRadius; dist++) {
    for (let dq = -dist; dq <= dist; dq++) {
      for (let dr = -dist; dr <= dist; dr++) {
        const hexDist = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        if (hexDist !== dist) continue;
        const candQ = centerQ + dq;
        const candR = centerR + dr;
        const tiles = getBuildingFootprintTiles(candQ, candR, 2);
        let ok = true;
        for (const t of tiles) {
          const tIdx = idx.indexOf(t.q, t.r);
          const terrain = state.grid.layers.terrain[tIdx];
          if (tIdx < 0 || occupied.has(tIdx) || terrain === TERRAIN.shallow || terrain === TERRAIN.deep) {
            ok = false;
            break;
          }
        }
        if (ok) {
          return { q: candQ, r: candR };
        }
      }
    }
  }
  return { q: centerQ + 2, r: centerR };
}

export const devTradehubSpawnHandler = defineCommandHandler({
  kind: 'dev.tradehubSpawn',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Record<string, unknown>;
    const colonyIndex = resolveColonyIndex(args, cmd.colonyIndex);
    const colony = ensureColony(state, colonyIndex, ctx.tick);

    let targetQ: number;
    let targetR: number;
    const hasCustomQ = args.q !== undefined && args.q !== '' && Number.isFinite(Number(args.q));
    const hasCustomR = args.r !== undefined && args.r !== '' && Number.isFinite(Number(args.r));

    if (hasCustomQ && hasCustomR) {
      targetQ = Math.trunc(Number(args.q));
      targetR = Math.trunc(Number(args.r));
    } else {
      const hubRow = findColonyEntityRow(state, colonyIndex, ENTITY_KIND.commandHub);
      const hqRow = findColonyHqRow(state, colonyIndex);
      let cq = 0;
      let cr = 0;
      if (hubRow >= 0) {
        cq = state.entities.cols.q[hubRow];
        cr = state.entities.cols.r[hubRow];
      } else if (hqRow >= 0) {
        cq = state.entities.cols.q[hqRow];
        cr = state.entities.cols.r[hqRow];
      }
      const free = findFreeFootprint2x2(state, cq, cr);
      targetQ = free.q;
      targetR = free.r;
    }

    const idx = hexIndex(state.grid.radius);
    const footprintTiles = getBuildingFootprintTiles(targetQ, targetR, 2);
    for (const t of footprintTiles) {
      const tIdx = idx.indexOf(t.q, t.r);
      if (tIdx >= 0) {
        setTilePrep(state.grid, tIdx, 1, ctx.tick);
      }
    }

    const entityId = ctx.newEntityId();
    const row = insertRow(state.entities, entityId, ctx.tick);
    bumpPathEpoch(state.meta);
    const cols = state.entities.cols;
    cols.kind[row] = ENTITY_KIND.tradeHub;
    cols.owner[row] = colonyIndex;
    cols.tier[row] = 1;
    placeSpawnedEntity(state.entities, row, targetQ, targetR, ctx.tick);
    cols.rot[row] = 0;
    cols.hp[row] = 900;
    cols.hpMax[row] = 900;
    cols.state[row] = ENTITY_STATE.active;
    cols.progress[row] = 1;
    cols.footprintW[row] = 2;
    cols.footprintD[row] = 2;
    cols.shedGroup[row] = 2;
    cols.createdAt[row] = ctx.tick;
    cols.changedAt[row] = ctx.tick;

    colony.tradeHubUnlocked = true;
    colony.changedAt = ctx.tick;
  },
});

export const devCargoCapResetHandler = defineCommandHandler({
  kind: 'dev.cargoCapReset',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Record<string, unknown>;
    const colonyIndex = resolveColonyIndex(args, cmd.colonyIndex);
    const colony = ensureColony(state, colonyIndex, ctx.tick);

    const capState = ensureColonyCargoCapState(colony);
    resetColonyCargoCaps(capState);

    const colRecord = colony as Record<string, unknown>;
    let cargo = colRecord.cargo as Record<string, unknown> | undefined;
    if (!cargo || typeof cargo !== 'object') {
      cargo = {};
      colRecord.cargo = cargo;
    }
    cargo.windowExports = [];
    cargo.dailyMinted = { utcDay: capState.utcDay, byResource: {} };
    if (cargo.caps && typeof cargo.caps === 'object') {
      (cargo.caps as Record<string, unknown>).windowEntries = [];
      (cargo.caps as Record<string, unknown>).mintedToday = {};
    }

    colony.changedAt = ctx.tick;
  },
});

export const devCargoGrantHandler = defineCommandHandler({
  kind: 'dev.cargoGrant',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as Record<string, unknown>;
    const resource = typeof args.resource === 'string' ? args.resource : undefined;
    if (!resource || !RESOURCE_KEYS.includes(resource as ResourceKey)) {
      return 'invalid_args';
    }
    const amount = Number(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'invalid_args';
    }

    const colonyIndex = resolveColonyIndex(args, cmd.colonyIndex);
    const colony = ensureColony(state, colonyIndex, ctx.tick);
    const colRecord = colony as Record<string, unknown>;

    let cargo = colRecord.cargo as Record<string, unknown> | undefined;
    if (!cargo || typeof cargo !== 'object') {
      cargo = {};
      colRecord.cargo = cargo;
    }
    let inOrbit = cargo.inOrbit as Record<string, number> | undefined;
    if (!inOrbit || typeof inOrbit !== 'object') {
      inOrbit = {};
      cargo.inOrbit = inOrbit;
    }

    const current = Number(inOrbit[resource] ?? 0);
    inOrbit[resource] = (Number.isFinite(current) ? current : 0) + amount;
    colony.changedAt = ctx.tick;
  },
});
