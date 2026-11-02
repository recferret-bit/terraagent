import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  canRunTerraformOpOnTile,
  createPlanet,
  getColonyTerraformOrders,
  hexIndex,
  restore,
  setTileOwner,
  SimHost,
  snapshot,
  spawnColonyLanding,
  view,
  type PlanetType,
  type TerraformOpKind,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { packView, unpackView } from '../../store/replica/viewCodec';
import { computeBoxTiles, planBrushStroke } from './planner';

/**
 * Client/server parity of the terraform rule (D-37, FF-03): the brush preview runs the sim's `evaluateTerraform` on the
 * replica view that crossed the real client path (snapshot `{ forClient: true }` → replica → view codec); for every tile
 * and op it must agree with the authoritative check on the host's state.
 */
function hostWithPod(planetType: PlanetType, claimRing: boolean): SimHost {
  const host = new SimHost(buildPipeline(parseWaves('..01').list, {}));
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

function checkEveryTile(planetType: PlanetType, claimRing: boolean): Set<string> {
  const host = hostWithPod(planetType, claimRing);
  const data = host.pipeline.config.data;
  const client = clientViewOf(host);
  const reasons = new Set<string>();
  const R = host.state.grid.radius;
  for (const op of ['grade', 'clear', 'break'] as TerraformOpKind[]) {
    for (let r = -R; r <= R; r++) {
      for (let q = -R; q <= R; q++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
        const s = canRunTerraformOpOnTile(host.state, 0, op, q, r, { data });
        const c = planBrushStroke(client, [{ q, r }], { op, colonyId: 0, data });
        expect([q, r, op, c.queuedCount]).toEqual([q, r, op, s.ok ? 1 : 0]);
        if (!s.ok && s.reason) reasons.add(s.reason);
      }
    }
  }
  return reasons;
}

describe('terraform parity: authoritative state vs client replica view (FF-03)', () => {
  for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
    it(`${planetType}: before territory (pre-Hub radius around the pod) the preview equals the host verdict on every tile`, () => {
      const reasons = checkEveryTile(planetType, false);
      expect(reasons.has('site_blocked')).toBe(true);
      expect(reasons.has('not_own_territory')).toBe(true);
    });
  }

  it('with territory (own and foreign tiles): own tiles only, on every tile', () => {
    expect(checkEveryTile('temperate', true).has('not_own_territory')).toBe(true);
  });

  it('a multi-tile Grade stroke previews exactly the jobs the host queues', () => {
    const host = hostWithPod('temperate', false);
    const tiles = computeBoxTiles({ q: -3, r: -3 }, { q: 3, r: 3 }, 14);
    const preview = planBrushStroke(clientViewOf(host), tiles, { op: 'grade', colonyId: 0, data: host.pipeline.config.data });
    host.submit({ colonyIndex: 0, source: 'player', commandId: 'p1', kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles } } });
    host.step(1);
    const order = getColonyTerraformOrders(host.state, 0).find((o) => !o.isLinkedPrep);
    expect(preview.queuedCount).toBeGreaterThan(0);
    expect(order?.jobs.map((j) => `${j.op}:${j.q},${j.r}`)).toEqual(preview.jobs.map((j) => `${j.op}:${j.q},${j.r}`));
    expect(order?.skippedCount).toBe(preview.skippedCount);
  });
});
