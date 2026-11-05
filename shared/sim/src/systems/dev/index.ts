import { RESOURCE_FAMILY_OF, RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { isMajor } from '@terra/ledger';
import { dataRow } from '../../data';
import { DEV_ACTOR, treasury } from '../../economy';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { adminRelocateEntity, placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { createPlanet } from '../../gen/createPlanet';
import { hasGenerator } from '../../gen/generators';
import { forgetTileStamps } from '../../grid/sectors';
import { bumpPathEpoch, isTileExplored, markTileExplored } from '../../grid/tileModel';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { seedRng } from '../../kernel/rng';
import { setBlob, type PlanetState } from '../../kernel/state';
import { cancelMove } from '../../units/movement/orchestrator';
import { commandColony, parseArgs } from '../command';
import { cancelConstructionOrder, getConstructionOrders } from '../construction';
import { defineSimModule } from '../define';
import { creditResource, ensureColonyLedger, remainingFamilyCap, zeroResource } from '../economy/ledger';
import {
  applyEnvironmentState,
  environmentFromPlanetTime,
  type EnvironmentState,
} from '../environment';
import { findColonyHqRow } from '../find';
import { hqViewRadius, revealVision, setHqCellEnergy, syncHqView } from '../hq';
import { MAX_COLONIES_PER_PLANET } from '../landing';
import { evaluateColonyPower, recomputeAllColonyPower } from '../power-core';
import { writeOrdersByColony } from '../terraform-basic/orders';
import { claimTerritoryRadius } from '../territory-claim';
import { setPlanetTime } from '../time';
import { devLand } from './land';
import { devSpawnDeposit } from './spawnDeposit';
import { devSpawnUnit } from './spawnUnit';
import { devAddLoad, devDamage, devDrainFuel, devSetWind } from './w03';

/** `kind` of the W00 test entity spawned by `dev.spawn` (no gameplay meaning). */
export const DEV_ENTITY_KIND = 1;

/** The caller's colony for a colony-scoped dev command (`cmd.colonyIndex`), or `not_own_colony` (GP-18). */
const devColony = (cmd: SimCommand): number | 'not_own_colony' => commandColony(cmd);

/** Layers `dev.seed` takes from the regenerated planet: the ground, and the per-colony layers on top of it. */
const SEED_LAYERS = ['terrain', 'prep', 'deposit', 'depositTier', 'richness', 'height', 'subDeposit', 'subRichness', 'owner', 'explored', 'anchors', 'graceUntil'] as const;

/** `dev.seed`: no order survives onto new ground (GP-27): construction is cancelled (refund rules), terraform dropped. */
function dropAllOrders(s: PlanetState, ctx: StepContext): void {
  for (const o of getConstructionOrders(s)) cancelConstructionOrder(s, o.colonyId, o.orderId, ctx.tick, ctx.data, ctx);
  writeOrdersByColony(s, {}, ctx.tick);
}

/** After `dev.seed`: active Hubs claim their territory again, and every HQ and pod sees its surroundings again. */
function reclaimAndReveal(s: PlanetState, ctx: StepContext): void {
  const cols = s.entities.cols;
  for (let row = 0; row < s.entities.count; row++) {
    const owner = cols.owner[row];
    if (owner < 0) continue;
    if (cols.kind[row] === ENTITY_KIND.hub && cols.state[row] === ENTITY_STATE.active) {
      claimTerritoryRadius(s, { colonyId: owner, q: cols.q[row], r: cols.r[row], tick: ctx.tick, data: ctx.data });
    }
    if (cols.kind[row] === ENTITY_KIND.hq || cols.kind[row] === ENTITY_KIND.pod) revealVision(s, owner, cols.q[row], cols.r[row], hqViewRadius(ctx.data), ctx.tick);
  }
}

/** Admin placement: a new row gets its spawn tile; an existing one is relocated (its route, if any, is dropped). */
function place(s: PlanetState, row: number, x: number, y: number, ctx: StepContext, spawned = false): void {
  const e = s.entities;
  if (spawned) placeSpawnedEntity(e, row, Math.round(x), Math.round(y), ctx.tick);
  else {
    adminRelocateEntity(e, row, x, y, ctx.tick);
    cancelMove(s, e.cols.id[row], ctx.tick);
  }
  if (e.cols.kind[row] === ENTITY_KIND.hq) {
    revealVision(s, e.cols.owner[row], e.cols.q[row], e.cols.r[row], hqViewRadius(ctx.data), ctx.tick);
    syncHqView(s, row, ctx.tick, ctx.data);
  }
}

const ping = defineCommandHandler({
  kind: 'dev.ping', wave: 'W00',
  handle(_s, c, ctx) {
    const note = (c.args as { note?: string }).note;
    ctx.emit({ kind: 'dev.pong', data: note === undefined ? {} : { note } });
  },
});

const spawn = defineCommandHandler({
  kind: 'dev.spawn', wave: 'W00',
  handle(s, c, ctx) {
    const { q, r } = c.args as { q: number; r: number };
    const row = insertRow(s.entities, ctx.newEntityId(), ctx.tick);
    s.entities.cols.kind[row] = DEV_ENTITY_KIND;
    place(s, row, q, r, ctx, true);
  },
});

const nudge = defineCommandHandler({
  kind: 'dev.nudge', wave: 'W00',
  handle(s, c, ctx) {
    const { id, dq, dr } = c.args as { id: number; dq?: number; dr?: number };
    const row = rowOf(s.entities, id);
    if (row < 0) return 'unknown_entity';
    const step = Number(dataRow(ctx.data, 'dev', 'probe').nudgeTiles);
    const [a, b] = dq === undefined && dr === undefined ? [1, 0] : [dq ?? 0, dr ?? 0];
    place(s, row, s.entities.cols.x[row] + a * step, s.entities.cols.y[row] + b * step, ctx);
  },
});

const teleport = defineCommandHandler({
  kind: 'dev.teleport', wave: 'W00',
  // With an id: that entity (when the caller has a colony, only its own or an unowned one). Without: the caller's HQ.
  handle(s, c, ctx) {
    const { q, r, id, entityId } = c.args as { q: number; r: number; id?: number; entityId?: number };
    const reqId = id ?? entityId;
    const colony = devColony(c);
    if (typeof reqId === 'number' && reqId > 0) {
      const row = rowOf(s.entities, reqId);
      if (row < 0) return 'unknown_entity';
      const owner = s.entities.cols.owner[row];
      if (typeof colony === 'number' && owner >= 0 && owner !== colony) return 'not_own_colony';
      place(s, row, q, r, ctx);
      return;
    }
    if (typeof colony === 'string') return colony;
    const row = findColonyHqRow(s, colony);
    if (row < 0) return 'unknown_entity';
    place(s, row, q, r, ctx);
  },
});

function ensureColony(state: PlanetState, colonyIndex: number, tick: number) {
  let colony = state.colonies.find((c) => c.index === colonyIndex);
  if (!colony) {
    colony = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0x3a7bd5,
      status: 'active',
      changedAt: tick,
    };
    state.colonies.push(colony);
  }
  return ensureColonyLedger(colony);
}

type DevColony = ReturnType<typeof ensureColony>;

/** A dev console grant: posted as `dev.grant`, whole units like every other credit. */
function devCredit(colony: DevColony, key: ResourceKey, amount: number, tick: number): void {
  creditResource(colony, key, amount, tick, { reason: 'dev.grant' });
}

function setOrFillKey(
  colony: ReturnType<typeof ensureColony>,
  key: ResourceKey,
  amount: number | undefined,
  tick: number,
): void {
  const family = RESOURCE_FAMILY_OF[key];
  if (amount !== undefined) {
    zeroResource(colony, key, tick);
    colony.changedAt = tick;
    if (amount > 0) devCredit(colony, key, amount, tick);
  } else {
    devCredit(colony, key, remainingFamilyCap(colony, family), tick);
  }
}

const fill = defineCommandHandler({
  kind: 'dev.fill', wave: 'W02',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { res?: string; resource?: string; amount?: number; colonyIndex?: number };
    const colonyIndex = args.colonyIndex ?? c.colonyIndex ?? 0;
    const colony = ensureColony(s, colonyIndex, ctx.tick);
    const targetRes = args.res ?? args.resource ?? 'all';
    const amount = args.amount;

    if (targetRes === 'all') {
      if (amount !== undefined) {
        for (const k of RESOURCE_KEYS) zeroResource(colony, k, ctx.tick);
        colony.changedAt = ctx.tick;
        devCredit(colony, 'metals.t1', amount, ctx.tick);
        devCredit(colony, 'minerals.t1', amount, ctx.tick);
        devCredit(colony, 'bio.biomass', amount, ctx.tick);
        devCredit(colony, 'bio.water', amount, ctx.tick);
      } else {
        devCredit(colony, 'metals.t1', remainingFamilyCap(colony, 'metals'), ctx.tick);
        devCredit(colony, 'minerals.t1', remainingFamilyCap(colony, 'minerals'), ctx.tick);
        const bioRem = remainingFamilyCap(colony, 'bio');
        const half = Math.floor(bioRem / 2);
        devCredit(colony, 'bio.biomass', half, ctx.tick);
        devCredit(colony, 'bio.water', remainingFamilyCap(colony, 'bio'), ctx.tick);
      }
    } else if (targetRes === 'metals') {
      if (amount !== undefined) {
        zeroResource(colony, 'metals.t2', ctx.tick);
        zeroResource(colony, 'metals.t3', ctx.tick);
      }
      setOrFillKey(colony, 'metals.t1', amount, ctx.tick);
    } else if (targetRes === 'minerals') {
      if (amount !== undefined) {
        zeroResource(colony, 'minerals.t2', ctx.tick);
        zeroResource(colony, 'minerals.t3', ctx.tick);
      }
      setOrFillKey(colony, 'minerals.t1', amount, ctx.tick);
    } else if (targetRes === 'bio') {
      if (amount !== undefined) {
        zeroResource(colony, 'bio.water', ctx.tick);
        zeroResource(colony, 'bio.t2', ctx.tick);
        zeroResource(colony, 'bio.t3', ctx.tick);
      }
      setOrFillKey(colony, 'bio.biomass', amount, ctx.tick);
    } else if ((RESOURCE_KEYS as readonly string[]).includes(targetRes)) {
      setOrFillKey(colony, targetRes as ResourceKey, amount, ctx.tick);
    } else {
      return 'invalid_args';
    }
  },
});

const skipnight = defineCommandHandler({
  kind: 'dev.skipnight', wave: 'W02',
  handle(s, _c, ctx) {
    const prev = s.blobs.environment?.value as Partial<EnvironmentState> | undefined;
    const prevStorm = prev?.stormActive === true;
    setPlanetTime(s, { timeOfDay: 6 }, ctx.tick, ctx.data); // morning: full daylight (the environment follows the clock)
    applyEnvironmentState(s, environmentFromPlanetTime(s, ctx.data, prevStorm, ctx.tick), ctx.tick);
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});

const power = defineCommandHandler({
  kind: 'dev.power', wave: 'W02',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { colonyIndex?: number; supplyOverride?: number | null };
    const colonyIndex = args.colonyIndex ?? c.colonyIndex ?? 0;
    if (args.supplyOverride !== undefined) {
      const col = ensureColony(s, colonyIndex, ctx.tick);
      col.powerSupplyOverride =
        typeof args.supplyOverride === 'number' && Number.isFinite(args.supplyOverride) && args.supplyOverride >= 0
          ? args.supplyOverride
          : null;
      recomputeAllColonyPower(s, ctx.data, ctx.tick);
    }
    const summary = evaluateColonyPower(s, colonyIndex, ctx.data, ctx.tick);
    ctx.emit({ kind: 'dev.powerDump', colonyIds: [colonyIndex], data: { ...(summary as unknown as Record<string, unknown>) } });
  },
});

const grant = defineCommandHandler({
  kind: 'dev.grant', wave: 'W01',
  // Whole units only; a negative amount withdraws at most the balance (clamped to >= 0). Uncapped (a dev tool), and
  // only for an existing colony: a grant never creates a colony record.
  handle(s, c, ctx) {
    const colony = devColony(c);
    if (typeof colony === 'string') return colony;
    const args = parseArgs('dev.grant', c.args);
    if (!args || !isMajor(args.amount)) return 'invalid_args';
    if (!s.colonies[colony]) return 'invalid_args';
    const t = treasury(s, ctx);
    const req = { colony, reason: 'dev.grant' as const, actor: DEV_ACTOR };
    const res = args.resource;
    const out =
      args.amount >= 0
        ? t.add({ ...req, amounts: { [res]: args.amount } })
        : t.withdraw({ ...req, amounts: { [res]: Math.min(-args.amount, t.stock(colony)[res] ?? 0) } });
    return out.ok ? undefined : 'invalid_args';
  },
});

const cell = defineCommandHandler({
  kind: 'dev.cell', wave: 'W01',
  handle(s, c, ctx) {
    const colony = devColony(c);
    if (typeof colony === 'string') return colony;
    const args = parseArgs('dev.cell', c.args);
    if (!args) return 'invalid_args';
    const hqRow = findColonyHqRow(s, colony);
    if (hqRow < 0) return 'unknown_entity';
    setHqCellEnergy(s, hqRow, args.energy, ctx.tick, ctx.data);
  },
});

const reveal = defineCommandHandler({
  kind: 'dev.reveal', wave: 'W01',
  handle(s, c, ctx) {
    const colony = devColony(c);
    if (typeof colony === 'string') return colony;
    if (colony >= MAX_COLONIES_PER_PLANET) return 'invalid_args';
    for (let i = 0; i < s.grid.count; i++) if (!isTileExplored(s.grid, i, colony)) markTileExplored(s.grid, i, colony, ctx.tick);
  },
});

const seed = defineCommandHandler({
  kind: 'dev.seed', wave: 'W01',
  handle(s, c, ctx) {
    const { seed: nextSeed } = c.args as { seed: string };
    const temp = createPlanet({
      type: hasGenerator(s.meta.planetType) ? s.meta.planetType : 'temperate',
      seed: nextSeed,
      radius: s.grid.radius,
      ...(s.meta.worldSalt ? { worldSalt: s.meta.worldSalt } : {}),
      planetId: s.meta.planetId,
      planetType: s.meta.planetType,
    });
    dropAllOrders(s, ctx);
    s.meta.seed = nextSeed;
    s.rng = seedRng(nextSeed);
    // New ground: every ground layer comes from the new planet, and so do territory, anchors, grace and fog (GP-33).
    for (const layer of SEED_LAYERS) {
      if (temp.grid.layers[layer] && s.grid.layers[layer]) s.grid.layers[layer].set(temp.grid.layers[layer]);
    }
    if (temp.blobs.spawnSlots) {
      setBlob(s, 'spawnSlots', temp.blobs.spawnSlots.value, ctx.tick);
    }
    s.grid.layers.changedAt.fill(ctx.tick);
    forgetTileStamps(s.grid.layers.changedAt); // bulk write: sector stamps are rebuilt on the next diff
    bumpPathEpoch(s.meta); // new ground: paused path searches restart
    if (temp.meta.genVersion !== undefined) s.meta.genVersion = temp.meta.genVersion;
    reclaimAndReveal(s, ctx);
  },
});

export default defineSimModule({
  id: 'dev',
  wave: 'W00',
  handlers: [
    ping,
    spawn,
    nudge,
    teleport,
    grant,
    cell,
    reveal,
    seed,
    devLand,
    fill,
    skipnight,
    power,
    devSpawnDeposit,
    devSpawnUnit,
    devSetWind,
    devDrainFuel,
    devAddLoad,
    devDamage,
  ],
});
