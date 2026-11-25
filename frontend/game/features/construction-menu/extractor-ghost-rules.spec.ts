import { DEPOSIT, ENTITY_KIND, PREP, hexIndex } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import type { GameView } from '../../core/registry/types';
import { evaluatePlacementGhost } from './PlacementGhost';
import { E, ENTITY_STRIDE, type ClientView } from '../../store/replica/viewCodec';

const GHOST_FLAGS = new Set(['W00', 'W01', 'W02', 'W03', 'W07']);

function makeGhostView(radius: number) {
  const hIndex = hexIndex(radius);
  const count = hIndex.count;
  const terrain = new Uint8Array(count);
  const prep = new Uint8Array(count).fill(PREP.prepared);
  const deposit = new Uint8Array(count);
  const richness = new Float32Array(count).fill(10000);
  const owner = new Int16Array(count).fill(-1);
  const height = new Float32Array(count);
  const entities = new Float32Array(ENTITY_STRIDE);
  entities[E.id] = 1;
  entities[E.kind] = ENTITY_KIND.commandHub;
  entities[E.hp] = 500;
  entities[E.hpMax] = 500;
  for (let i = 0; i < count; i++) owner[i] = 0;

  const view: ClientView = {
    tick: 1,
    planet: { id: 'p_ext_ghost', type: 'temperate', seed: 'g', radius },
    tiles: { count, terrain, prep, deposit, richness, owner, height },
    entities,
    count: 1,
    colonies: [{ index: 0, id: 'col_0', name: 'Alpha', color: 0xff6b00, status: 'active' } as never],
    blobs: {},
  };
  const setDep = (q: number, r: number, d: number, rich = 10000) => {
    const i = hIndex.indexOf(q, r);
    deposit[i] = d;
    richness[i] = rich;
  };
  return { view, hIndex, setDep };
}

describe('PlacementGhost deposit exclusivity, single resource type per extractor, and wreck blocks', () => {
  it('blocks non-extractors on deposits and blocks extractors spanning two resource types even in fallback mode', () => {
    const { view, hIndex, setDep } = makeGhostView(5);
    setDep(3, 0, DEPOSIT.minerals, 10000);
    setDep(4, 0, DEPOSIT.oil, 10000);

    // Non-extractor over deposit is red
    const solar = evaluatePlacementGhost({ building: 'solar', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view });
    expect(solar.valid).toBe(false);
    expect(solar.statusColor).toBe('red');

    // Resource Extractor over minerals + oil (even next to an occupied tile forcing fallback path) is red
    const mixedExt = evaluatePlacementGhost({ building: 'metalsExtractor', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view });
    expect(mixedExt.valid).toBe(false);
    expect(mixedExt.statusColor).toBe('red');
    expect(mixedExt.reason).toBe('only one resource type per extractor');

    // Petroleum Well over oil + minerals is red too
    const mixedWell = evaluatePlacementGhost({ building: 'petroleumWell', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view });
    expect(mixedWell.valid).toBe(false);
    expect(mixedWell.statusColor).toBe('red');
    expect(mixedWell.reason).toBe('only one resource type per extractor');

    // Pure single resource works
    setDep(4, 0, DEPOSIT.none, 0);
    const pureMinerals = evaluatePlacementGhost({ building: 'metalsExtractor', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view });
    expect(pureMinerals.valid).toBe(true);
    expect(pureMinerals.depositCovered).toBe(true);

    // Placing over an active wreck is red (`wreckage: terraform to clear`)
    const wreckTile = hIndex.indexOf(-2, 0);
    view.blobs = { wrecks: { byId: { '77': { id: 77, kind: ENTITY_KIND.demoTank, owner: 0, q: -2, r: 0, tiles: [wreckTile], createdAt: 1 } } } };
    const onWreck = evaluatePlacementGhost({ building: 'solar', q: -3, r: 0, rotation: 0, flags: GHOST_FLAGS, view });
    expect(onWreck.valid).toBe(false);
    expect(onWreck.reason).toBe('wreckage: terraform to clear');

    // Fallback path (when owner is incomplete so evaluateSiteWithSim returns null): still rejects deposits on non-extractors & mixed deposits
    const noOwnerView = {
      ...view,
      tiles: { count: view.tiles!.count, terrain: view.tiles!.terrain, prep: view.tiles!.prep, deposit: view.tiles!.deposit, height: view.tiles!.height },
    } as unknown as GameView;
    setDep(3, 0, DEPOSIT.minerals, 10000);
    setDep(4, 0, DEPOSIT.oil, 10000);
    expect(evaluatePlacementGhost({ building: 'solar', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view: noOwnerView }).valid).toBe(false);
    expect(evaluatePlacementGhost({ building: 'metalsExtractor', q: 3, r: 0, rotation: 0, flags: GHOST_FLAGS, view: noOwnerView })).toMatchObject({
      valid: false,
      reason: 'only one resource type per extractor',
    });
  });
});
