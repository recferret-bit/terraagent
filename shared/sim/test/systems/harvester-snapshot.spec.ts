import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  createRegistryPipeline,
  restore,
  snapshot,
  spawnHarvesterUnit,
  spawnHqUnit,
  step,
  type PlanetState,
} from '../../src';

/**
 * Regression (dev server, planet `pl_01M6EG80…`): `col.harvesters` got an index alias (`list[entityId] = view`), so a
 * Harvester with entity id 3 made a sparse `[view, , , view]`. The snapshot codec saves holes as `null`, and the
 * first step after a restore crashed in `syncHarvesterView` ("Cannot read properties of null (reading 'entityId')").
 */
function planetWithHarvester(): { state: PlanetState; harvesterId: number } {
  const state = createPlanet({ type: 'flat', seed: 'harvester-snapshot', radius: 12 });
  spawnHqUnit(state, { owner: 0, q: 2, r: -1 }); // entity ids 1.. go to others first, so the Harvester's id > its index
  spawnHqUnit(state, { owner: 0, q: -2, r: 1 });
  const harvesterId = spawnHarvesterUnit(state, { owner: 0, q: 3, r: 0 });
  return { state, harvesterId };
}

const ids = (list: unknown): unknown[] => (list as Array<{ entityId?: number } | null>).map((u) => (u ? u.entityId : u));

describe('Harvester colony views survive a snapshot round trip', () => {
  it('keeps col.harvesters / col.units dense (one view per Harvester) and steps after restore', () => {
    const { state, harvesterId } = planetWithHarvester();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    expect(ids(state.colonies[0]?.harvesters)).toEqual([harvesterId]);
    expect(ids(state.colonies[0]?.units)).toEqual([harvesterId]);

    const back = restore(snapshot(state));
    expect(ids(back.colonies[0]?.harvesters)).toEqual([harvesterId]);
    expect(() => step(back, [], 1, pipeline)).not.toThrow();
    expect(ids(back.colonies[0]?.harvesters)).toEqual([harvesterId]);
  });

  it('heals a saved planet whose lists hold null holes (written by the old index alias)', () => {
    const { state, harvesterId } = planetWithHarvester();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
    step(state, [], 1, pipeline);
    const view = (state.colonies[0]?.harvesters as unknown[])[0];
    // what the old code left in a snapshot: the view, null holes, and the alias copy at index `entityId`
    const sparse: unknown[] = [view];
    for (let i = 1; i < harvesterId; i++) sparse.push(null);
    sparse.push(view);
    state.colonies[0]!.harvesters = sparse;

    const back = restore(snapshot(state));
    expect(ids(back.colonies[0]?.harvesters)).toContain(null);
    expect(() => step(back, [], 1, pipeline)).not.toThrow();
    expect(ids(back.colonies[0]?.harvesters)).toEqual([harvesterId]);
  });
});
