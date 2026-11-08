import { describe, expect, it } from 'vitest';
import { hexDistance, indexOf, view, PREP, TERRAIN } from '@terra/sim';
import { createScenarioPlanet } from '../_loader';
import { patchTiles, W05_TERRAIN_PATCHES, type W05TerrainPatchId } from '../w05-terrain';

const EXPECT: Record<W05TerrainPatchId, { terrain?: number; prep?: number }> = {
  forest: { terrain: TERRAIN.forest },
  rock: { terrain: TERRAIN.rock },
  mountain: { terrain: TERRAIN.rock },
  ridge: { prep: PREP.ridge },
  moat: { prep: PREP.moat },
  living: { prep: PREP.living },
  shallow: { terrain: TERRAIN.shallow },
  deep: { terrain: TERRAIN.deep },
  craters: { terrain: TERRAIN.hole },
  hills: { terrain: TERRAIN.slope },
  dunes: { terrain: TERRAIN.slope },
  prepared: { prep: PREP.prepared },
};

describe('w05-terrain scenario', () => {
  const { host } = createScenarioPlanet('w05-terrain');
  const g = host.state.grid;

  it('builds every patch where it is declared, owned and 7..9 hexes from the Hub', () => {
    for (const patch of W05_TERRAIN_PATCHES) {
      for (const [q, r] of patchTiles(patch)) {
        const i = indexOf(g.radius, q, r);
        expect(i, `${patch.id} ${q},${r}`).toBeGreaterThanOrEqual(0);
        const want = EXPECT[patch.id];
        if (want.terrain !== undefined && !(patch.id === 'deep' && (q !== patch.center[0] || r !== patch.center[1]))) {
          expect(g.layers.terrain[i], `${patch.id} terrain`).toBe(want.terrain);
        }
        if (want.prep !== undefined) expect(g.layers.prep[i], `${patch.id} prep`).toBe(want.prep);
        expect(g.layers.owner[i]).toBe(0);
        expect(hexDistance(0, 0, q, r)).toBeLessThanOrEqual(9);
      }
    }
  });

  it('publishes the T2 worker tier on the colony view (the client preview gates Deep Reclaim on it)', () => {
    const { host } = createScenarioPlanet('w05-terrain');
    expect(view(host.state).colonies[0].maxWorkerTier).toBe(2);
  });

  it('keeps patches apart (no tile in two patches)', () => {
    const seen = new Set<string>();
    for (const patch of W05_TERRAIN_PATCHES) {
      for (const [q, r] of patchTiles(patch)) {
        expect(seen.has(`${q},${r}`)).toBe(false);
        seen.add(`${q},${r}`);
      }
    }
  });

  it('every orderable kind is accepted by the sim and the Terraform ops clear every hex of its patch', () => {
    const { host } = createScenarioPlanet('w05-terrain');
    const g = host.state.grid;
    const opFor: Record<number, string> = {
      [TERRAIN.forest]: 'clear', [TERRAIN.rock]: 'break', [TERRAIN.shallow]: 'reclaim', [TERRAIN.deep]: 'deepReclaim',
      [TERRAIN.hole]: 'fill', [TERRAIN.slope]: 'level',
    };
    let n = 0;
    const order = (q: number, r: number, op: string): string | undefined => {
      const id = `tf-${++n}`;
      host.submit({ colonyIndex: 0, source: 'player', commandId: id, kind: 'enqueueTask', args: { terraform: { op, tiles: [{ q, r }] } } });
      return host.step(1).outcomes.find((o) => o.commandId === id)?.code;
    };
    // One patch at a time (the Hub caps open orders / jobs); a patch is cleared edge-inwards by the workers.
    for (const patch of W05_TERRAIN_PATCHES) {
      const cleared: Array<readonly [number, number]> = [];
      for (const [q, r] of patchTiles(patch)) {
        const op = opFor[g.layers.terrain[indexOf(g.radius, q, r)]];
        if (!op) continue;
        expect(order(q, r, op), `${patch.id} ${q},${r} (${op}) accepted`).toBeFalsy();
        cleared.push([q, r]);
      }
      // Step in small slices, as the 20 Hz loop does (one `step(8000)` leaves the queued jobs untouched, see the report).
      for (let k = 0; k < 800 && !cleared.every(([q, r]) => g.layers.terrain[indexOf(g.radius, q, r)] === TERRAIN.flat); k++) host.step(10);
      for (const [q, r] of cleared) expect(g.layers.terrain[indexOf(g.radius, q, r)], `${patch.id} ${q},${r} cleared`).toBe(TERRAIN.flat);
    }
    // Not orderable: Ridge / Moat (no op), Living (finished).
    for (const id of ['ridge', 'moat', 'living'] as const) {
      const [q, r] = W05_TERRAIN_PATCHES.find((p) => p.id === id)!.center;
      expect(order(q, r, 'grade'), `${id} is rejected`).toBeTruthy();
    }
  });
});
