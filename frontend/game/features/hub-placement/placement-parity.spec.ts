import { parseWaves } from '@terra/contracts';
import { createPlanet, evaluatePlacement, placementWorldFromState, restore, SimHost, snapshot, spawnHqUnit, view } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { packView, unpackView } from '../../store/replica/viewCodec';
import { evaluateHubGhost, ghostPlacementWorld } from './GhostEvaluator';

/**
 * Client/server parity: the client ghost runs the same `evaluatePlacement` as the `placeBuilding` handler, on the replica
 * view that crossed the wire codec. For every tile of a generated planet (forest, rock, water, deposits) both must agree.
 */
describe('placement parity: authoritative state vs client replica view', () => {
  for (const planetType of ['desert', 'ocean', 'temperate'] as const) {
    it(`${planetType}: ghost verdict and reason equal the host verdict for every tile`, () => {
      const host = new SimHost({ flags: parseWaves('..01') });
      host.load(createPlanet({ id: 'pl', seed: `parity-${planetType}`, type: 'temperate', planetType, radius: 14 } as never));
      spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
      // Server -> client: welcome snapshot bytes restored into the replica, then the Worker -> main thread view codec.
      const replica = restore(snapshot(host.state));
      const { view: wire } = packView(view(replica), true);
      const clientView = unpackView(wire);
      expect(clientView.tiles?.deposit).toBeDefined();

      const serverWorld = placementWorldFromState(host.state);
      const clientWorld = ghostPlacementWorld(clientView);
      const R = host.state.grid.radius;
      let invalid = 0, blockedByTerrain = 0;
      for (let r = -R; r <= R; r++) {
        for (let q = -R; q <= R; q++) {
          if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
          const s = evaluatePlacement(serverWorld, { colonyId: 0, q, r, building: 'commandHub' });
          const c = evaluatePlacement(clientWorld, { colonyId: 0, q, r, building: 'commandHub' });
          expect([c.ok, c.code, c.block]).toEqual([s.ok, s.code, s.block]);
          const g = evaluateHubGhost(clientView, { colonyId: 0, q, r });
          expect([g.valid, g.reasonCode]).toEqual([s.ok, s.code]);
          if (!s.ok) invalid++;
          if (s.code === 'terrain_unbuildable') blockedByTerrain++;
        }
      }
      expect(invalid).toBeGreaterThan(0);
      expect(blockedByTerrain).toBeGreaterThan(0);
    });
  }
});
