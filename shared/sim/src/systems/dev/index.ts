import { dataRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { insertRow, rowOf, setField } from '../../ecs/store';
import { createPlanet } from '../../gen/createPlanet';
import { hasGenerator } from '../../gen/generators';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import { seedRng } from '../../kernel/rng';
import { setBlob, touchTile, type PlanetState } from '../../kernel/state';
import { defineSimModule } from '../define';
import { resolveHqRow, revealVision, setHqCellEnergy, syncHqView } from '../hq';
import { addColonyStock } from '../landing';

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

function place(s: PlanetState, row: number, x: number, y: number, ctx: StepContext): void {
  const e = s.entities;
  const q = Math.round(x);
  const r = Math.round(y);
  setField(e, row, 'q', q, ctx.tick);
  setField(e, row, 'r', r, ctx.tick);
  setField(e, row, 'x', x, ctx.tick);
  setField(e, row, 'y', y, ctx.tick);
  if (e.cols.targetQ) setField(e, row, 'targetQ', q, ctx.tick);
  if (e.cols.targetR) setField(e, row, 'targetR', r, ctx.tick);
  if (e.cols.kind[row] === ENTITY_KIND.hq) {
    revealVision(s, e.cols.owner[row], q, r, 9, ctx.tick);
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
    place(s, row, q, r, ctx);
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
  handle(s, c) {
    const args = c.args as { resource: string; amount: number };
    const resKey = RESOURCE_ALIASES[args.resource] ?? args.resource;
    const colony = resolveColonyIndex(c);
    addColonyStock(s, colony, { [resKey]: args.amount }, false);
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
      planetId: s.meta.planetId,
      planetType: s.meta.planetType,
    });
    s.meta.seed = nextSeed;
    s.rng = seedRng(nextSeed);
    const copyLayers = ['terrain', 'prep', 'deposit', 'richness', 'height'] as const;
    for (const layer of copyLayers) {
      if (temp.grid.layers[layer] && s.grid.layers[layer]) {
        s.grid.layers[layer].set(temp.grid.layers[layer]);
      }
    }
    if (temp.blobs.spawnSlots) {
      setBlob(s, 'spawnSlots', temp.blobs.spawnSlots.value, ctx.tick);
    }
    s.grid.layers.changedAt.fill(ctx.tick);
  },
});

export default defineSimModule({
  id: 'dev',
  wave: 'W00',
  handlers: [ping, spawn, nudge, teleport, grant, cell, reveal, seed],
});
