import { describe, expect, it } from 'vitest';
import { eventDef, parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  hexIndex,
  OBSTACLE_REMOVED_ACHIEVEMENTS,
  PREP,
  resolveObstacleRemovedAchievement,
  rowOf,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnTerraformerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  type SimEvent,
} from '../../src';

function createW05ProgressionColony() {
  const state = createState({ planetId: 'p-w05-prog', planetType: 'temperate', seed: 'w05-prog', radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    playerId: 'pr-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  creditResource(colony, 'metals.t1', 200, 0);
  creditResource(colony, 'minerals.t1', 200, 0);
  creditResource(colony, 'bio.biomass', 200, 0);
  creditResource(colony, 'bio.water', 200, 0);
  colony.powerSupplyOverride = 500;
  const hx = hexIndex(state.grid.radius);
  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state.grid, i, 0, 0);
    setTileTerrain(state.grid, i, TERRAIN.flat, 0);
    setTileHeight(state.grid, i, 0, 0);
    state.grid.layers.deposit[i] = 0;
  }
  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
  });
  expect(hubRes.ok).toBe(true);
  const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
  return { state, colony, hx, pipeline };
}

describe('W05-29 · W05 progression events (obstacleRemoved + family mapping)', () => {
  it('Acceptance: Seed 3 tiles -> emits 3 obstacleRemoved { op: "seed", count: 1 } mapped to Green Thumb', () => {
    const { state, hx, pipeline } = createW05ProgressionColony();
    const tiles = [
      { q: 3, r: 0 },
      { q: 3, r: 1 },
      { q: 4, r: -1 },
    ];
    for (const t of tiles) {
      setTilePrep(state.grid, hx.indexOf(t.q, t.r), PREP.irrigated, 0);
    }

    spawnTerraformerUnit(state, { owner: 0, q: 4, r: 0 });

    const enq = step(
      state,
      [
        {
          commandId: 'cmd-seed-3',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'seed', tiles } },
        },
      ],
      1,
      pipeline,
    );
    expect(enq.outcomes[0]?.code).toBeUndefined();

    const events: SimEvent[] = [...enq.events];
    for (let t = 0; t < 300; t++) {
      const r = step(state, [], 1, pipeline);
      events.push(...r.events);
      if (tiles.every((tile) => state.grid.layers.prep[hx.indexOf(tile.q, tile.r)] === PREP.living)) break;
    }

    const removed = events.filter((e) => e.kind === 'obstacleRemoved');
    expect(removed).toHaveLength(3);
    for (const tile of tiles) {
      expect(state.grid.layers.prep[hx.indexOf(tile.q, tile.r)]).toBe(PREP.living);
    }
    for (const ev of removed) {
      expect(ev.data).toMatchObject({ colonyId: 'col-0', playerId: 'pr-0', op: 'seed', count: 1 });
      expect(eventDef('obstacleRemoved').data.safeParse(ev.data).success).toBe(true);
      expect(resolveObstacleRemovedAchievement(String(ev.data.op))).toBe('Green Thumb');
    }
  });
});

describe('W05-29 · Level, Fill, Reclaim, DeepReclaim obstacleRemoved + achievement mapping', () => {
  it('emits obstacleRemoved { op, count: 1 } for level, fill, reclaim, and deepReclaim', () => {
    const { state, hx, pipeline } = createW05ProgressionColony();
    const tfId = spawnTerraformerUnit(state, { owner: 0, q: 4, r: 0 });
    state.entities.cols.tier[rowOf(state.entities, tfId)] = 2;

    const cases: Array<{ op: 'level' | 'fill' | 'reclaim' | 'deepReclaim'; terrain: number; q: number; r: number }> = [
      { op: 'level', terrain: TERRAIN.slope, q: 3, r: 0 },
      { op: 'fill', terrain: TERRAIN.hole, q: 3, r: 1 },
      { op: 'reclaim', terrain: TERRAIN.shallow, q: 4, r: -1 },
      { op: 'deepReclaim', terrain: TERRAIN.deep, q: 5, r: 0 },
    ];

    for (const c of cases) {
      setTileTerrain(state.grid, hx.indexOf(c.q, c.r), c.terrain, 0);
    }

    const events: SimEvent[] = [];
    for (const c of cases) {
      const enq = step(
        state,
        [
          {
            commandId: `cmd-${c.op}`,
            colonyIndex: 0,
            source: 'player',
            kind: 'enqueueTask',
            args: { terraform: { op: c.op, tiles: [{ q: c.q, r: c.r }] } },
          },
        ],
        1,
        pipeline,
      );
      expect(enq.outcomes[0]?.code).toBeUndefined();
      events.push(...enq.events);

      for (let t = 0; t < 160; t++) {
        const r = step(state, [], 1, pipeline);
        events.push(...r.events);
        if (state.grid.layers.terrain[hx.indexOf(c.q, c.r)] === TERRAIN.flat) break;
      }
      expect(state.grid.layers.terrain[hx.indexOf(c.q, c.r)]).toBe(TERRAIN.flat);
    }

    const removed = events.filter((e) => e.kind === 'obstacleRemoved');
    expect(removed.map((e) => e.data.op)).toEqual(['level', 'fill', 'reclaim', 'deepReclaim']);
    for (const ev of removed) {
      expect(ev.data).toMatchObject({ colonyId: 'col-0', playerId: 'pr-0', count: 1 });
      expect(eventDef('obstacleRemoved').data.safeParse(ev.data).success).toBe(true);
    }
  });

  it('maps obstacleRemoved ops to Stone Mason, Hydro Engineer, and Green Thumb', () => {
    expect(OBSTACLE_REMOVED_ACHIEVEMENTS).toEqual({
      clear: 'Stone Mason',
      break: 'Stone Mason',
      level: 'Stone Mason',
      fill: 'Stone Mason',
      reclaim: 'Hydro Engineer',
      deepReclaim: 'Hydro Engineer',
      seed: 'Green Thumb',
    });
    for (const op of ['clear', 'break', 'level', 'fill'] as const) {
      expect(resolveObstacleRemovedAchievement(op)).toBe('Stone Mason');
    }
    for (const op of ['reclaim', 'deepReclaim'] as const) {
      expect(resolveObstacleRemovedAchievement(op)).toBe('Hydro Engineer');
    }
    expect(resolveObstacleRemovedAchievement('seed')).toBe('Green Thumb');
  });
});
