import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyFaunaDirective, createRegistryPipeline, createState, ensureColonyRecord, ENTITY_KIND,
  ENTITY_STATE, getUnitCommand, hexDistance, insertRow, issueUnitCommand, placeSpawnedEntity,
  PREP, provokeFaunaBug, resolveSpeciesConfig, rowOf, SimHost, spawnFaunaBug, TERRAIN,
  type FaunaSpeciesId,
} from '../../src';
import { makeDirectiveStepCtx } from '../../src/systems/fauna/directivePayloads';

function fixture(species: FaunaSpeciesId, mode: 'live' | 'provoke' | 'directive' | 'attack') {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const data = pipeline.config.data;
  const state = createState({ planetId: 'approach', planetType: 'temperate', seed: 'approach', radius: 16 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  ensureColonyRecord(state, 0, 0).status = 'active';
  const targetId = state.meta.nextEntityId++;
  const target = insertRow(state.entities, targetId, 0);
  const cols = state.entities.cols;
  cols.kind[target] = ENTITY_KIND.commandHub;
  cols.owner[target] = 0;
  cols.hp[target] = cols.hpMax[target] = 100000;
  cols.footprintW[target] = cols.footprintD[target] = 3;
  cols.state[target] = ENTITY_STATE.active;
  placeSpawnedEntity(state.entities, target, 10, 0, 0);
  const id = spawnFaunaBug(state, { species, q: 0, r: 0, mode: mode === 'live' ? 'aggressive' : 'passive' }, 0, data);
  const row = rowOf(state.entities, id);
  const ctx = makeDirectiveStepCtx(state, 0, data);
  if (mode === 'provoke') provokeFaunaBug(state, id, 0, { targetId, data }, ctx);
  if (mode === 'attack') issueUnitCommand(state, row, { kind: 'attack', source: 'player', targetId }, ctx);
  if (mode === 'directive') applyFaunaDirective(state, {
    version: 1, seq: 1, effectiveTick: 0, hiveId: 0, decisionIndex: 1, kind: 'targetChange',
    payload: { bugId: id, memberIds: [id], species, targetColony: 0, targetEntityId: targetId },
  }, { data });
  const host = new SimHost(pipeline);
  host.load(state);
  return { host, state, row, id, range: resolveSpeciesConfig(species, data).range + 1 };
}

describe('shared combat approach bands (GP-87)', () => {
  it.each(['blackAnt', 'greenSpitter'] as const)('%s live chase, directives, provocation and attack stop at the same footprint edge', species => {
    const finals: number[] = [];
    for (const mode of ['live', 'provoke', 'directive', 'attack'] as const) {
      const { host, state, row, id, range } = fixture(species, mode);
      if (mode === 'directive' || mode === 'provoke') expect(getUnitCommand(state, id)).toMatchObject({ maxDist: Math.floor(range) });
      const samples: number[] = [];
      for (let tick = 0; tick < 100; tick++) {
        host.step(1);
        samples.push(hexDistance(state.entities.cols.x[row], state.entities.cols.y[row], 10, 0));
      }
      expect(samples[0]).toBeGreaterThan(range);
      expect(samples[99]).toBeLessThanOrEqual(range + 1e-4);
      expect(samples[99]).toBeGreaterThanOrEqual(range - 0.5);
      expect(new Set(samples.slice(-10)).size).toBe(1);
      finals.push(samples[99]);
    }
    expect(Math.max(...finals) - Math.min(...finals)).toBeLessThanOrEqual(0.5);
  });
});
