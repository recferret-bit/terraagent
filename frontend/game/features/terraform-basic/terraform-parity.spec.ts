import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  createPlanet,
  evaluateGroundWorkTile,
  getColonyTerraformOrders,
  getWorkJobsMap,
  HEX_DIRS,
  hexIndex,
  inHex,
  entityFootprint,
  getBuildingFootprintTiles,
  occupiesGround,
  placementWorldFromState,
  planGroundWorkTiles,
  PREP,
  restore,
  setTilePrep,
  setTileTerrain,
  setTileOwner,
  SimHost,
  snapshot,
  spawnColonyLanding,
  spawnHqUnit,
  TERRAIN,
  terraformWorldFromState,
  view,
  type PlanetType,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { packView, unpackView } from '../../store/replica/viewCodec';
import { extractViewEntities, planTerraformTiles } from './planner';
import { planPrimaryOp } from './primaryOps';

/** Axial box `start..end` inside the planet (row-major). */
function computeBoxTiles(start: { q: number; r: number }, end: { q: number; r: number }, radius: number) {
  const out: Array<{ q: number; r: number }> = [];
  for (let r = Math.min(start.r, end.r); r <= Math.max(start.r, end.r); r++) {
    for (let q = Math.min(start.q, end.q); q <= Math.max(start.q, end.q); q++) if (inHex(q, r, radius)) out.push({ q, r });
  }
  return out;
}

/**
 * Client/server parity of the TERRAFORM rule (D-37): the click preview runs the sim's `planGroundWorkTiles` on the
 * replica view that crossed the real client path (snapshot `{ forClient: true }` → replica → view codec).
 */
function hostWithPod(waves: string, planetType: PlanetType, claimRing: boolean): SimHost {
  const host = new SimHost(buildPipeline(parseWaves(waves).list, {}));
  host.load(createPlanet({ id: 'pl', seed: `tf-parity-${planetType}`, type: 'temperate', planetType, radius: 14 }));
  const landed = spawnColonyLanding(host.state, { colonyId: 0 });
  if (!landed.ok) throw new Error(`landing rejected: ${landed.code}`);
  host.step(1);
  if (claimRing) {
    const idx = hexIndex(host.state.grid.radius);
    for (const t of computeBoxTiles({ q: -2, r: -2 }, { q: 2, r: 2 }, 14)) setTileOwner(host.state.grid, idx.indexOf(t.q, t.r), 0);
    for (const t of computeBoxTiles({ q: 6, r: 0 }, { q: 8, r: 2 }, 14)) setTileOwner(host.state.grid, idx.indexOf(t.q, t.r), 1);
  }
  return host;
}

function clientViewOf(host: SimHost) {
  const { view: wire } = packView(view(restore(snapshot(host.state, { forClient: true }))), true);
  return unpackView(wire);
}

function occupiedOf(host: SimHost): Set<number> {
  const data = host.pipeline.config.data;
  const world = placementWorldFromState(host.state);
  const idx = hexIndex(world.radius);
  const out = new Set<number>();
  for (const e of world.entities) {
    if (!occupiesGround(e)) continue;
    for (const t of getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind, data))) {
      const i = idx.indexOf(t.q, t.r);
      if (i >= 0) out.add(i);
    }
  }
  return out;
}

function pendingOf(host: SimHost): Set<string> {
  const out = new Set<string>();
  for (const o of getColonyTerraformOrders(host.state, 0)) for (const j of o.jobs) out.add(`${j.q},${j.r}`);
  for (const j of Object.values(getWorkJobsMap(host.state))) if (j.mode === 'terraform' && j.colonyId === 0) out.add(`${j.q},${j.r}`);
  return out;
}

function hostPlan(host: SimHost, tiles: Array<{ q: number; r: number }>) {
  const data = host.pipeline.config.data;
  return planGroundWorkTiles(terraformWorldFromState(host.state, 0, data), tiles, {
    colonyId: 0,
    deposit: host.state.grid.layers.deposit,
    occupied: occupiedOf(host),
    pending: pendingOf(host),
    data,
  });
}

/** Every tile: the preview's verdict equals the host's `planGroundWorkTiles` on authoritative state. */
function checkEveryTile(waves: string, planetType: PlanetType, claimRing: boolean): { ops: Set<string>; reasons: Set<string>; water: boolean } {
  const host = hostWithPod(waves, planetType, claimRing);
  const data = host.pipeline.config.data;
  const client = clientViewOf(host);
  const world = terraformWorldFromState(host.state, 0, data);
  const ops = new Set<string>();
  const reasons = new Set<string>();
  let water = false;
  const R = host.state.grid.radius;
  const hx = hexIndex(R);
  for (let r = -R; r <= R; r++) {
    for (let q = -R; q <= R; q++) {
      if (!inHex(q, r, R)) continue;
      const s = hostPlan(host, [{ q, r }]);
      const c = planTerraformTiles(client, [{ q, r }], { colonyId: 0, data });
      expect([q, r, c.jobs.map((j) => j.op), c.firstReject]).toEqual([q, r, s.jobs.map((j) => j.op), s.firstReject]);
      const ground = evaluateGroundWorkTile(world, 0, hx.indexOf(q, r), q, r, { deposit: host.state.grid.layers.deposit, data });
      if (ground.ok && ground.workOp) water = true;
      for (const j of c.jobs) ops.add(j.op);
      if (s.firstReject) reasons.add(s.firstReject);
    }
  }
  return { ops, reasons, water };
}

describe('terraform parity: authoritative state vs client replica view (FF-03)', () => {
  for (const waves of ['..01', '..05']) {
    for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
      it(`${waves} ${planetType}: before territory the TERRAFORM preview picks the host's verdict on every tile`, () => {
        const { ops, reasons } = checkEveryTile(waves, planetType, false);
        expect(ops.has('work')).toBe(true);
        expect(reasons.has('not_own_territory')).toBe(true);
      });
    }
  }

  it('..05 ocean: water hexes are workable reclaim, the same verdict the host picks', () => {
    expect(checkEveryTile('..05', 'ocean', false).water).toBe(true);
  });

  it('with territory (own and foreign tiles): own tiles only, on every tile', () => {
    expect(checkEveryTile('..05', 'temperate', true).reasons.has('not_own_territory')).toBe(true);
  });

  it('the click plan sends work where the host accepts, or nothing where it refuses', () => {
    const host = hostWithPod('..05', 'temperate', false);
    const cols = host.state.entities.cols;
    spawnHqUnit(host.state, { owner: 0, q: cols.q[0]! + 1, r: cols.r[0]! });
    const data = host.pipeline.config.data;
    const client = clientViewOf(host);
    const entities = extractViewEntities(client as never);
    let sent = 0;
    for (const t of computeBoxTiles({ q: -3, r: -3 }, { q: 3, r: 3 }, 14)) {
      const p = planPrimaryOp('terraform', { view: client as never, entities, colonyId: 0, data }, t.q, t.r);
      const s = hostPlan(host, [t]);
      if (s.jobs.length > 0) {
        expect(p.terraform).toMatchObject({ op: 'work', intent: 'terraform', tiles: [t] });
        sent++;
      } else {
        expect([t.q, t.r, p.terraform]).toEqual([t.q, t.r, null]);
      }
    }
    expect(sent).toBeGreaterThan(0);
  });
});

describe('terraform parity: no-op targets get the same typed reason on client and host', () => {
  it('Living, queued, and already-flat hexes: the preview matches the host and does not climb to Irrigate or Seed', () => {
    const host = hostWithPod('..05', 'temperate', false);
    const data = host.pipeline.config.data;
    const idx = hexIndex(host.state.grid.radius);
    const cols = host.state.entities.cols;
    const [pq, pr] = [cols.q[0]!, cols.r[0]!];
    const levelFlat = (q: number, r: number, prep: number) => {
      const i = idx.indexOf(q, r);
      setTileTerrain(host.state.grid, i, TERRAIN.flat);
      setTilePrep(host.state.grid, i, prep);
      host.state.grid.layers.height[i] = 0;
      for (const [dq, dr] of HEX_DIRS) {
        const j = idx.indexOf(q + dq, r + dr);
        if (j < 0) continue;
        setTileTerrain(host.state.grid, j, TERRAIN.flat);
        host.state.grid.layers.height[j] = 0;
      }
      return i;
    };
    const living = { q: pq + 1, r: pr };
    levelFlat(living.q, living.r, PREP.living);
    const s = hostPlan(host, [living]);
    const c = planTerraformTiles(clientViewOf(host), [living], { colonyId: 0, data });
    expect([s.firstReject, c.firstReject, c.jobs.length]).toEqual(['already_terraformed', 'already_terraformed', 0]);

    const queued = { q: pq - 1, r: pr };
    host.submit({ commandId: 'tp-1', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles: [queued] } } } as never);
    host.step(1);
    expect(planTerraformTiles(clientViewOf(host), [queued], { colonyId: 0, data }).firstReject).toBe('already_queued');

    for (const prep of [PREP.flat, PREP.prepared, PREP.irrigated]) {
      const t = { q: pq, r: pr + 1 };
      levelFlat(t.q, t.r, prep);
      const p = planTerraformTiles(clientViewOf(host), [t], { colonyId: 0, data });
      const h = hostPlan(host, [t]);
      expect([prep, p.jobs, p.firstReject, h.firstReject]).toEqual([prep, [], 'already_terraformed', 'already_terraformed']);
    }
  });
});
