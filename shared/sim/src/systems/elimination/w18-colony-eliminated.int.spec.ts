import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  claimTerritoryRadius,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '../../index';
import { hasActiveTruce, markColonyContact } from '../diplomacy';
import { isEntityRuin } from './store';

function createW18EliminationHost() {
  const flags = parseWaves('..18');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({
    planetId: 'pl-w18-09-int',
    planetType: 'temperate',
    seed: 'w18-09-int',
    radius: 16,
  });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);

  for (const idx of [0, 1]) {
    const col = ensureColonyLedger(ensureColonyRecord(state, idx, 0));
    col.status = 'active';
    col.stock['metals.t1'] = 400;
    col.stock['minerals.t1'] = 400;
  }

  const hub0 = state.meta.nextEntityId++;
  const hub0Row = insertRow(state.entities, hub0, 0);
  state.entities.cols.kind[hub0Row] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hub0Row] = 0;
  state.entities.cols.q[hub0Row] = 0;
  state.entities.cols.r[hub0Row] = 0;
  state.entities.cols.hp[hub0Row] = 1500;
  state.entities.cols.hpMax[hub0Row] = 1500;
  state.entities.cols.state[hub0Row] = ENTITY_STATE.active;
  state.entities.cols.footprintW[hub0Row] = 3;
  state.entities.cols.footprintD[hub0Row] = 3;
  state.colonies[0].hubEntityId = hub0;

  const solar0 = state.meta.nextEntityId++;
  const solar0Row = insertRow(state.entities, solar0, 0);
  state.entities.cols.kind[solar0Row] = ENTITY_KIND.solar;
  state.entities.cols.owner[solar0Row] = 0;
  state.entities.cols.q[solar0Row] = 4;
  state.entities.cols.r[solar0Row] = 0;
  state.entities.cols.hp[solar0Row] = 400;
  state.entities.cols.hpMax[solar0Row] = 400;
  state.entities.cols.state[solar0Row] = ENTITY_STATE.active;
  state.entities.cols.footprintW[solar0Row] = 2;
  state.entities.cols.footprintD[solar0Row] = 2;

  const hq0 = spawnHqUnit(state, { owner: 0, q: 2, r: 0, tick: 0 });
  const hq1 = spawnHqUnit(state, { owner: 1, q: 10, r: 0, tick: 0 });
  claimTerritoryRadius(state, { colonyId: 0, q: 0, r: 0, radius: 4, tick: 0 });
  markColonyContact(state, 0, 1, 0);

  host.load(state);
  return { host, state, hub0, solar0, hq0, hq1 };
}

describe('W18-09 · Colony Eliminated & Ruins SimHost integration tests', () => {
  it('expires 10-min critical timer -> emits colonyEliminated -> buildings become decaying ruins -> territory reverts after 60s grace', () => {
    const { host, state, solar0, hq0 } = createW18EliminationHost();

    // Sign a truce between 0 and 1 first to verify elimination cancels it cleanly
    host.submit({
      commandId: 'offer-truce',
      colonyIndex: 1,
      source: 'dev',
      kind: 'dev.offerTruce',
      args: { fromColony: 1, toColony: 0, hours: 6 },
    });
    const offerStep = host.step(1);
    const offerId = (offerStep.events.find((e) => e.kind === 'truceOffered')?.data as { offerId: string }).offerId;
    host.submit({
      commandId: 'accept-truce',
      colonyIndex: 0,
      source: 'player',
      kind: 'diplomacy.respondTruce',
      args: { offerId, accept: true },
    });
    host.step(1);
    expect(hasActiveTruce(state, 0, 1, host.tick)).toBe(true);

    // Destroy Hub -> Colony Critical (3000 ticks = 10 min)
    host.submit({
      commandId: 'kill-hub-0',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    const critStep = host.step(1);
    expect(state.colonies[0]?.status).toBe('critical');
    expect(critStep.events.some((e) => e.kind === 'colonyCritical')).toBe(true);

    // Advance 2999 ticks -> still critical
    host.step(2999);
    expect(state.colonies[0]?.status).toBe('critical');

    // Tick 3000 after Hub loss -> critical timer expires -> Colony Eliminated!
    const elimStep = host.step(1);
    expect(state.colonies[0]?.status).toBe('eliminated');
    const elimEv = elimStep.events.find((e) => e.kind === 'colonyEliminated');
    expect(elimEv?.data).toMatchObject({ colonyIndex: 0, cause: 'timer', reason: 'timer' });

    // Truce cancelled without Oathbreaker, HQ removed, solar building turned into decaying ruin
    expect(hasActiveTruce(state, 0, 1, host.tick)).toBe(false);
    expect(rowOf(state.entities, hq0)).toBe(-1);
    const solarRow = rowOf(state.entities, solar0);
    expect(solarRow).toBeGreaterThanOrEqual(0);
    expect(state.entities.cols.owner[solarRow]).toBe(-1);
    expect(state.entities.cols.state[solarRow]).toBe(ENTITY_STATE.inert);
    expect(isEntityRuin(state, solar0)).toBe(true);

    // Territory still owned during 60s (300 ticks) grace
    const centerIdx = hexIndex(state.grid.radius).indexOf(0, 0);
    expect(state.grid.layers.owner[centerIdx]).toBe(0);

    // Advance 300 ticks (60s) -> territory reverts to -1 and ruin decays by 60% (from 400 to ~160 HP)
    const revertStep = host.step(300);
    expect(state.grid.layers.owner[centerIdx]).toBe(-1);
    expect(revertStep.events.some((e) => e.kind === 'territoryReverting' && e.data?.reverted === true)).toBe(true);
    expect(state.entities.cols.hp[rowOf(state.entities, solar0)]).toBeLessThan(200);

    // Advance another 200 ticks (40s, total 100s) -> ruin reaches 0 HP and is cleared
    host.step(200);
    expect(rowOf(state.entities, solar0)).toBe(-1);
    expect(isEntityRuin(state, solar0)).toBe(false);
  });
});
