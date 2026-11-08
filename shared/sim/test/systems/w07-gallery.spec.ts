import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyDamage, setBlob, COMBAT_DRY_FIRE_BLOB, createPlanet, createRegistryPipeline, DEPOSIT, PREP, TERRAIN,
  ensureColonyLedger, ensureColonyRecord, populateShootingGallery, readBattleState,
  rowOf, step, type SimEvent,
} from '../../src';

function fixture() {
  const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
  const state = createPlanet({ type: 'flat', seed: 'gallery', radius: 12, planetId: 'gallery' });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  state.grid.layers.deposit.fill(DEPOSIT.none);
  state.grid.layers.height.fill(0);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.powerSupplyOverride = 800;
  const lanes = populateShootingGallery(state, 'mixed', pipeline.config.data);
  return { state, pipeline, lanes };
}

describe('authoritative shooting gallery', () => {
  it('holds five paired lanes for 60 ticks and fires every weapon only at its own target', () => {
    const { state, pipeline, lanes } = fixture();
    const positions = lanes.flatMap(l => [l.shooterId, l.targetId]).map(id => {
      const row = rowOf(state.entities, id);
      return { id, x: state.entities.cols.x[row], y: state.entities.cols.y[row], hp: state.entities.cols.hp[row] };
    });
    const shots: SimEvent[] = [];
    for (let i = 0; i < 60; i++) { shots.push(...step(state, [], 1, pipeline).events.filter(e => e.kind === 'projectileFired')); }
    for (const lane of lanes) {
      const fired = shots.filter(e => e.data.attackerId === lane.shooterId);
      expect(fired.length, `kind ${lane.kind} should fire`).toBeGreaterThan(1);
      expect(new Set(fired.map(e => e.data.targetId))).toEqual(new Set([lane.targetId]));
      expect(readBattleState(state).byEntityId[lane.shooterId]?.targetId).toBe(lane.targetId);
    }
    for (const before of positions) {
      const row = rowOf(state.entities, before.id);
      expect([state.entities.cols.x[row], state.entities.cols.y[row], state.entities.cols.hp[row]]).toEqual([before.x, before.y, before.hp]);
    }
    expect(shots.every(e => lanes.some(l => l.shooterId === e.data.attackerId))).toBe(true);
  });

  it('server and client pipelines produce identical battle records and events', () => {
    const server = fixture(), client = fixture();
    for (let tick = 0; tick < 30; tick++) {
      const a = step(server.state, [], 1, server.pipeline);
      const b = step(client.state, [], 1, client.pipeline);
      expect(b.events).toEqual(a.events);
      expect(readBattleState(client.state)).toEqual(readBattleState(server.state));
    }
  });

  it('does not redirect a lost lane target to its neighbor', () => {
    const { state, pipeline, lanes } = fixture();
    step(state, [], 1, pipeline);
    const lost = lanes[0]!;
    setBlob(state, COMBAT_DRY_FIRE_BLOB, false, state.meta.tick);
    applyDamage(state, lost.targetId, 99999, { tick: state.meta.tick, data: pipeline.config.data });
    setBlob(state, COMBAT_DRY_FIRE_BLOB, true, state.meta.tick);
    for (let i = 0; i < 10; i++) {
      const events = step(state, [], 1, pipeline).events;
      expect(events.filter(e => e.kind === 'projectileFired' && e.data.attackerId === lost.shooterId)).toHaveLength(0);
    }
    expect(readBattleState(state).byEntityId[lost.shooterId]?.targetId).toBeNull();
  });
});
