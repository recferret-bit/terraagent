import type { ResourceKey } from '@terra/contracts';
import { isMajor } from '@terra/ledger';
import { dataRow } from '../../data';
import { DEV_ACTOR, treasury } from '../../economy';
import { ENTITY_KIND } from '../../ecs/columns';
import { adminRelocateEntity, placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import { createPlanet } from '../../gen/createPlanet';
import { hasGenerator } from '../../gen/generators';
import { forgetTileStamps } from '../../grid/sectors';
import { bumpPathEpoch } from '../../grid/tileModel';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { seedRng } from '../../kernel/rng';
import { setBlob, touchTile, type PlanetState } from '../../kernel/state';
import { defineSimModule } from '../define';
import { resolveHqRow, revealVision, setHqCellEnergy, syncHqView } from '../hq';
import { cancelMove } from '../../units/movement/orchestrator';
import { devLand } from './land';

/** `kind` of the W00 test entity spawned by `dev.spawn` (no gameplay meaning). */
export const DEV_ENTITY_KIND = 1;

const RESOURCE_ALIASES: Record<string, string> = {
  metals: 'metals.t1',
  minerals: 'minerals.t1',
  biomass: 'bio.biomass',
  water: 'bio.water',
};

function resolveColonyIndex(cmd: SimCommand): number {
  if (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0) return cmd.colonyIndex;
  const legacy = (cmd as { colony?: unknown }).colony;
  if (typeof legacy === 'number' && legacy >= 0) return legacy;
  return 0;
}

function findHqRow(state: PlanetState, colonyIndex: number, reqId?: number): number {
  if (typeof reqId === 'number' && reqId > 0) {
    return resolveHqRow(state, reqId);
  }
  const e = state.entities;
  const cols = e.cols;
  for (let i = 0; i < e.count; i++) {
    if (cols.kind[i] === ENTITY_KIND.hq && cols.owner[i] === colonyIndex) {
      return i;
    }
  }
  for (let i = 0; i < e.count; i++) {
    if (cols.kind[i] === ENTITY_KIND.hq) {
      return i;
    }
  }
  return -1;
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
    revealVision(s, e.cols.owner[row], e.cols.q[row], e.cols.r[row], 9, ctx.tick);
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
  handle(s, c, ctx) {
    const { q, r } = c.args as { q: number; r: number };
    const reqId = (c.args as { id?: number; entityId?: number }).id ?? (c.args as { id?: number; entityId?: number }).entityId;
    const row =
      typeof reqId === 'number' && reqId > 0
        ? rowOf(s.entities, reqId)
        : findHqRow(s, resolveColonyIndex(c));
    if (row < 0) return 'unknown_entity';
    place(s, row, q, r, ctx);
  },
});

const grant = defineCommandHandler({
  kind: 'dev.grant', wave: 'W01',
  // Whole units only; a negative amount withdraws at most the balance (clamped to >= 0).
  handle(s, c, ctx) {
    const args = c.args as { resource: string; amount: number };
    if (!isMajor(args.amount)) return 'invalid_args';
    const res = (RESOURCE_ALIASES[args.resource] ?? args.resource) as ResourceKey;
    const colony = resolveColonyIndex(c);
    const t = treasury(s, ctx);
    const req = { colony, reason: 'dev.grant' as const, actor: DEV_ACTOR };
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
    const args = c.args as { energy: number; entityId?: number; id?: number };
    const reqId = args.entityId ?? args.id;
    const hqRow = findHqRow(s, resolveColonyIndex(c), reqId);
    if (hqRow < 0) return 'no_hq';
    setHqCellEnergy(s, hqRow, args.energy, ctx.tick, ctx.data);
  },
});

const reveal = defineCommandHandler({
  kind: 'dev.reveal', wave: 'W01',
  handle(s, c, ctx) {
    const col = resolveColonyIndex(c);
    const mask = 1 << Math.max(0, Math.min(7, col));
    const explored = s.grid.layers.explored as Uint8Array;
    for (let i = 0; i < s.grid.count; i++) {
      explored[i] |= mask;
      touchTile(s, i, ctx.tick);
    }
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
    s.meta.seed = nextSeed;
    s.rng = seedRng(nextSeed);
    const copyLayers = ['terrain', 'prep', 'deposit', 'richness', 'height', 'subDeposit', 'subRichness'] as const;
    for (const layer of copyLayers) {
      if (temp.grid.layers[layer] && s.grid.layers[layer]) {
        s.grid.layers[layer].set(temp.grid.layers[layer]);
      }
    }
    if (temp.blobs.spawnSlots) {
      setBlob(s, 'spawnSlots', temp.blobs.spawnSlots.value, ctx.tick);
    }
    s.grid.layers.changedAt.fill(ctx.tick);
    forgetTileStamps(s.grid.layers.changedAt); // bulk write: sector stamps are rebuilt on the next diff
    bumpPathEpoch(s.meta); // new ground: paused path searches restart
    if (temp.meta.genVersion !== undefined) s.meta.genVersion = temp.meta.genVersion;
  },
});

export default defineSimModule({
  id: 'dev',
  wave: 'W00',
  handlers: [ping, spawn, nudge, teleport, grant, cell, reveal, seed, devLand],
});
