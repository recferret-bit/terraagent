import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  canRunTerraformOpOnTile,
  createPlanet,
  evaluateTerraform,
  hexIndex,
  inHex,
  PREP,
  restore,
  setTilePrep,
  setTileOwner,
  SimHost,
  snapshot,
  spawnColonyLanding,
  spawnHqUnit,
  terraformWorldFromState,
  view,
  type PlanetType,
  type TerraformOpKind,
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
 * Client/server parity of the TERRAFORM rule (D-37, FF-03): the click preview runs the sim's `evaluateTerraform` (with
 * `auto`) on the replica view that crossed the real client path (snapshot `{ forClient: true }` → replica → view
 * codec); for every tile it must pick the op and the verdict the authoritative state gives.
 */
function hostWithPod(waves: string, planetType: PlanetType, claimRing: boolean): SimHost {
  const host = new SimHost(buildPipeline(parseWaves(waves).list, {}));
  host.load(createPlanet({ id: 'pl', seed: `tf-parity-${planetType}`, type: 'temperate', planetType, radius: 14 }));
  const landed = spawnColonyLanding(host.state, { colonyId: 0 }); // the landing planner picks the site
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

/** Every tile: the preview's op and verdict equal the host's `evaluateTerraform` on authoritative state. */
function checkEveryTile(waves: string, planetType: PlanetType, claimRing: boolean): { ops: Set<string>; reasons: Set<string> } {
  const host = hostWithPod(waves, planetType, claimRing);
  const data = host.pipeline.config.data;
  const client = clientViewOf(host);
  const world = terraformWorldFromState(host.state, 0, data);
  const ops = new Set<string>();
  const reasons = new Set<string>();
  const R = host.state.grid.radius;
  for (let r = -R; r <= R; r++) {
    for (let q = -R; q <= R; q++) {
      if (!inHex(q, r, R)) continue;
      const s = evaluateTerraform(world, { colonyId: 0, op: 'grade', tiles: [{ q, r }], auto: true, data });
      const c = planTerraformTiles(client, [{ q, r }], { colonyId: 0, data });
      if (s.jobs.length > 0) expect([q, r, c.jobs.map((j) => j.op)]).toEqual([q, r, s.jobs.map((j) => j.op)]);
      else {
        // already-clear ground climbs the growth ladder: whatever op the client picks, the host accepts it
        for (const j of c.jobs) expect([q, r, j.op, canRunTerraformOpOnTile(host.state, 0, j.op as TerraformOpKind, q, r, { data }).ok]).toEqual([q, r, j.op, true]);
        if (c.jobs.length === 0 && waves === '..05') {
          for (const op of ['irrigate', 'seed'] as const) expect([q, r, op, canRunTerraformOpOnTile(host.state, 0, op, q, r, { data }).ok]).toEqual([q, r, op, false]);
        }
      }
      for (const j of c.jobs) ops.add(j.op);
      if (s.firstReject) reasons.add(s.firstReject);
    }
  }
  return { ops, reasons };
}

describe('terraform parity: authoritative state vs client replica view (FF-03)', () => {
  for (const waves of ['..01', '..05']) {
    for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
      it(`${waves} ${planetType}: before territory the TERRAFORM preview picks the host's op on every tile`, () => {
        const { ops, reasons } = checkEveryTile(waves, planetType, false);
        expect(ops.has('grade')).toBe(true);
        expect(reasons.has('not_own_territory')).toBe(true);
      });
    }
  }

  it('..05 ocean: water hexes get a reclaim op, the same one the host picks', () => {
    const { ops } = checkEveryTile('..05', 'ocean', false);
    expect([...ops].some((op) => op === 'reclaim' || op === 'deepReclaim')).toBe(true);
  });

  it('with territory (own and foreign tiles): own tiles only, on every tile', () => {
    expect(checkEveryTile('..05', 'temperate', true).reasons.has('not_own_territory')).toBe(true);
  });

  it('the click plan sends exactly the order the host accepts, or nothing where it refuses', () => {
    const host = hostWithPod('..05', 'temperate', false);
    const cols = host.state.entities.cols;
    spawnHqUnit(host.state, { owner: 0, q: cols.q[0]! + 1, r: cols.r[0]! });
    const data = host.pipeline.config.data;
    const client = clientViewOf(host);
    const entities = extractViewEntities(client as never);
    let sent = 0;
    for (const t of computeBoxTiles({ q: -3, r: -3 }, { q: 3, r: 3 }, 14)) {
      const p = planPrimaryOp('terraform', { view: client as never, entities, colonyId: 0, data }, t.q, t.r);
      const s = evaluateTerraform(terraformWorldFromState(host.state, 0, data), { colonyId: 0, op: 'grade', tiles: [t], auto: true, data });
      if (s.jobs.length > 0) {
        expect([t.q, t.r, p.terraform?.op]).toEqual([t.q, t.r, s.jobs[0]!.op]);
        sent++;
      }
      if (p.terraform) expect(canRunTerraformOpOnTile(host.state, 0, p.terraform.op, t.q, t.r, { data }).ok).toBe(true);
    }
    expect(sent).toBeGreaterThan(0);
  });
});

describe('terraform parity: no-op targets get the same typed reason on client and host', () => {
  it('Living, queued, prepared and irrigated hexes: the preview matches the host', () => {
    const host = hostWithPod('..05', 'temperate', false);
    const data = host.pipeline.config.data;
    const idx = hexIndex(host.state.grid.radius);
    const cols = host.state.entities.cols;
    const [pq, pr] = [cols.q[0]!, cols.r[0]!];
    const living = { q: pq + 1, r: pr };
    setTilePrep(host.state.grid, idx.indexOf(living.q, living.r), PREP.living);
    const s = evaluateTerraform(terraformWorldFromState(host.state, 0, data), { colonyId: 0, op: 'grade', tiles: [living], auto: true, data });
    const c = planTerraformTiles(clientViewOf(host), [living], { colonyId: 0, data });
    expect([s.firstReject, c.firstReject, c.jobs.length]).toEqual(['already_terraformed', 'already_terraformed', 0]);
    // queued: the host's own queue is what the client view carries
    const queued = { q: pq - 1, r: pr };
    host.submit({ commandId: 'tp-1', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles: [queued] } } } as never);
    host.step(1);
    expect(planTerraformTiles(clientViewOf(host), [queued], { colonyId: 0, data }).firstReject).toBe('already_queued');
    // prepared / irrigated ground climbs the ladder, and the host accepts the plan
    for (const prep of [PREP.prepared, PREP.irrigated]) {
      const t = { q: pq, r: pr + 1 };
      setTilePrep(host.state.grid, idx.indexOf(t.q, t.r), prep);
      const p = planTerraformTiles(clientViewOf(host), [t], { colonyId: 0, data });
      expect(p.jobs.map((j) => j.op)).toEqual([prep === PREP.prepared ? 'irrigate' : 'seed']);
      expect(canRunTerraformOpOnTile(host.state, 0, p.jobs[0]!.op as TerraformOpKind, t.q, t.r, { data }).ok).toBe(true);
    }
  });
});
