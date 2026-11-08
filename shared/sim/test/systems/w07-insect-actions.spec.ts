import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  advanceInsectAction, createPlanet, createRegistryPipeline, DEPOSIT, PREP, TERRAIN,
  ensureColonyLedger, ensureColonyRecord, populateInsectAttackScene, readInsectActions,
  rowOf, step, ENTITY_STATE, FIRING_RANGE_BLOB, getResidentBugRecord, issueUnitCommand,
  provokeHiveAgainstColony, setBlob, type StepContext, type FaunaSpeciesId, type InsectActionRecord, type SimEvent,
} from '../../src';
import { hexDistance } from '../../src/grid/hex';

const SCENES = ['blackAnt', 'blueBeetle', 'greenSpitter', 'mixed'] as const;
function fixture(scene: FaunaSpeciesId | 'mixed' = 'mixed', mode: 'bugs' | 'robots' = 'bugs') {
  const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
  const state = createPlanet({ type: 'flat', seed: 'insect-actions', radius: 12, planetId: 'insect-actions' });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);
  state.grid.layers.deposit.fill(DEPOSIT.none);
  state.grid.layers.height.fill(0);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active'; colony.powerSupplyOverride = 800;
  const pairs = populateInsectAttackScene(state, scene, mode, pipeline.config.data);
  return { state, pipeline, pairs };
}

describe('authoritative insect action clock', () => {
  it('releases only after anticipation, once per attack, and preserves the cooldown interval', () => {
    let current: InsectActionRecord | undefined;
    let lastAttackTick = -9999;
    const releases: number[] = [];
    const states = new Set<string>();
    for (let tick = 1; tick <= 18; tick++) {
      const next = advanceInsectAction(current, { tick, species: 'blackAnt', intervalTicks: 5,
        lastAttackTick, moving: false, targetId: 2 });
      current = next.action; states.add(current.state);
      if (next.release) { releases.push(tick); lastAttackTick = tick; }
    }
    expect(releases).toEqual([3, 8, 13, 18]);
    expect(states).toEqual(new Set(['windup', 'attack', 'recovery']));
  });

  it('cancels anticipation when its target leaves range, then transitions to moving or idle', () => {
    const previous: InsectActionRecord = { state: 'windup', startedTick: 1, durationTicks: 3, targetId: 9 };
    const input = { tick: 4, species: 'greenSpitter' as const, intervalTicks: 10, lastAttackTick: -9999, targetId: null };
    const moving = advanceInsectAction(previous, { ...input, moving: true });
    expect(moving.release).toBe(false); expect(moving.action.state).toBe('moving');
    const idle = advanceInsectAction(moving.action, { ...input, moving: false });
    expect(idle.action.state).toBe('idle');
  });

});

describe('normal-game insect attack commands', () => {
  it('uses the discrete fauna release clock instead of generic continuous DPS', () => {
    const { state, pipeline, pairs } = fixture('blackAnt');
    const pair = pairs[0]!;
    for (let i = 0; i < 40 && readInsectActions(state).byEntityId[pair.bugId]?.state !== 'windup'; i++) {
      step(state, [], 1, pipeline);
    }
    expect(readInsectActions(state).byEntityId[pair.bugId]?.state).toBe('windup');
    setBlob(state, FIRING_RANGE_BLOB, null, state.meta.tick);
    const resident = getResidentBugRecord(state, pair.bugId)!;
    provokeHiveAgainstColony(state, resident.homeHiveId, 0, state.meta.tick, pipeline.config.data);
    const ctx: StepContext = {
      dt: 1, tick: state.meta.tick, flags: pipeline.config.flags, data: pipeline.config.data,
      events: [], postings: [], rng: stream => state.rng[stream],
      newEntityId: () => state.meta.nextEntityId++, emit() {}, record() {},
    };
    expect(issueUnitCommand(state, rowOf(state.entities, pair.bugId),
      { kind: 'attack', source: 'player', targetId: pair.robotId }, ctx)).toBeUndefined();
    let totalReleases = 0;
    for (let tick = 0; tick < 12; tick++) {
      const row = rowOf(state.entities, pair.robotId);
      const before = state.entities.cols.hp[row]!;
      const events = step(state, [], 1, pipeline).events;
      const releases = events.filter(e => e.kind === 'projectileFired' && e.data.attackerId === pair.bugId).length;
      totalReleases += releases;
      expect(before - state.entities.cols.hp[row]!).toBe(releases * 8);
    }
    expect(totalReleases).toBeGreaterThan(0);
  });
});

describe('insect attack scene fixtures', () => {
  it.each(SCENES)('%s has every bug attack its paired stationary robot through actual movement and timed release', scene => {
    const { state, pipeline, pairs } = fixture(scene);
    const robotPositions = pairs.map(p => {
      const row = rowOf(state.entities, p.robotId);
      // Match the renderer's contact audit: the silent scout presents its side to the oncoming bug.
      expect(state.entities.cols.rot[row]).toBeCloseTo(-Math.PI / 2, 5);
      return [state.entities.cols.x[row], state.entities.cols.y[row]];
    });
    const shots: SimEvent[] = [];
    const visited = new Map(pairs.map(p => [p.bugId, new Set<string>()]));
    for (let tick = 0; tick < 85; tick++) {
      const events = step(state, [], 1, pipeline).events;
      for (const pair of pairs) {
        const action = readInsectActions(state).byEntityId[pair.bugId];
        const row = rowOf(state.entities, pair.bugId);
        visited.get(pair.bugId)!.add(action?.state ?? (state.entities.cols.state[row] === ENTITY_STATE.moving ? 'moving' : 'idle'));
      }
      for (const ev of events.filter(e => e.kind === 'projectileFired')) {
        shots.push(ev);
        const pair = pairs.find(p => p.bugId === ev.data.attackerId)!;
        expect(pair).toBeDefined(); expect(ev.data.targetId).toBe(pair.robotId);
        const action = readInsectActions(state).byEntityId[pair.bugId]!;
        expect(action.state).toBe('attack'); expect(action.startedTick).toBe(ev.atTick);
        if (pair.species !== 'greenSpitter') {
          const a = rowOf(state.entities, pair.bugId), b = rowOf(state.entities, pair.robotId);
          expect(hexDistance(state.entities.cols.x[a]!, state.entities.cols.y[a]!, state.entities.cols.x[b]!, state.entities.cols.y[b]!)).toBeLessThanOrEqual(1.0001);
        }
      }
    }
    for (const [i, pair] of pairs.entries()) {
      expect(shots.filter(e => e.data.attackerId === pair.bugId).length).toBeGreaterThan(2);
      for (const phase of ['windup', 'attack', 'recovery']) expect(visited.get(pair.bugId)!.has(phase)).toBe(true);
      if (pair.species !== 'greenSpitter') expect(visited.get(pair.bugId)!.has('moving')).toBe(true);
      const robot = rowOf(state.entities, pair.robotId);
      expect([state.entities.cols.x[robot], state.entities.cols.y[robot]]).toEqual(robotPositions[i]);
    }
  });

  it('a melee robot receives damage only on discrete contact ticks, never during windup or recovery', () => {
    const { state, pipeline, pairs } = fixture('blackAnt');
    const pair = pairs[0]!;
    for (let tick = 0; tick < 40; tick++) {
      const row = rowOf(state.entities, pair.robotId);
      const hpBefore = state.entities.cols.hp[row]!;
      const events = step(state, [], 1, pipeline).events;
      const releases = events.filter(e => e.kind === 'projectileFired' && e.data.attackerId === pair.bugId).length;
      expect(hpBefore - state.entities.cols.hp[row]!).toBe(releases * 8);
    }
  });

  it.each(SCENES)('%s robot attack direction holds bugs still and permits a real insect death', scene => {
    const { state, pipeline, pairs } = fixture(scene, 'robots');
    const bugPositions = pairs.map(pair => {
      const row = rowOf(state.entities, pair.bugId); return [state.entities.cols.x[row], state.entities.cols.y[row]];
    });
    const fired: SimEvent[] = [];
    for (let tick = 0; tick < 65; tick++) {
      fired.push(...step(state, [], 1, pipeline).events.filter(e => e.kind === 'projectileFired'));
      for (const [i, pair] of pairs.entries()) {
        const row = rowOf(state.entities, pair.bugId);
        if (row >= 0) expect([state.entities.cols.x[row], state.entities.cols.y[row]]).toEqual(bugPositions[i]);
      }
    }
    expect(fired.length).toBeGreaterThan(0);
    for (const event of fired) expect(pairs.some(p => p.robotId === event.data.attackerId && p.bugId === event.data.targetId)).toBe(true);
    for (const pair of pairs) expect(rowOf(state.entities, pair.bugId)).toBe(-1);
  });

  it('server and client pipelines reproduce the same action transitions, movement and releases', () => {
    const server = fixture(), client = fixture();
    for (let tick = 0; tick < 45; tick++) {
      expect(step(client.state, [], 1, client.pipeline).events).toEqual(step(server.state, [], 1, server.pipeline).events);
      expect(readInsectActions(client.state)).toEqual(readInsectActions(server.state));
      expect(client.state.entities.cols.x).toEqual(server.state.entities.cols.x);
      expect(client.state.entities.cols.y).toEqual(server.state.entities.cols.y);
    }
  });
});
