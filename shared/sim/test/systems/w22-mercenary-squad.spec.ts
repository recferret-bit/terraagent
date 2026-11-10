import {
  BountyCompletedDataSchema,
  parseWaves,
  type SimCommandV1,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ensureColonyRecord,
  hexDistance,
  insertRow,
  placeSpawnedEntity,
  step,
  type PlanetState,
  type SimEvent,
} from '../../src';
import bountyMod, { readBounty } from '../../src/systems/bounty';
import { getUnitStance } from '../../src/systems/combat/stances';
import mercenaryMod, { MERCENARY_FACTION, MERCENARY_OWNER, readMercenary } from '../../src/systems/mercenary';
import { computeColonySupply } from '../../src/systems/supply/compute';
import { unitSupplyOfKind } from '../../src/systems/supply/sources';

const REWARD = { resource: 'metals.t1' as const, amount: 200 };
const EXPIRES = 1_700_000_000_000;
/** 100 ticks. `round((100/18000) * 18000) = 100` at 200 ms/tick. */
const DURATION_H = 100 / 18000;
const AREA = { q: 4, r: -2, radius: 3 };

function world(flags = '..22') {
  const state = createState({ planetId: 'pl_w22_merc', planetType: 'temperate', seed: 'w22-merc', radius: 16 });
  ensureColonyRecord(state, 0, 0);
  const pipe = createRegistryPipeline({ flags: parseWaves(flags), modules: [bountyMod, mercenaryMod] });
  return { state, pipe };
}

function placeHub(state: PlanetState, q: number, r: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.hub;
  cols.owner[row] = 0;
  cols.hp[row] = 800;
  cols.hpMax[row] = 800;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
}

function hire(count: number, endTick: number, bountyId?: string): SimCommandV1 {
  return {
    colonyIndex: 0,
    source: 'dev',
    commandId: `cm_hire_${count}`,
    kind: 'mercenary.spawn',
    args: { ...AREA, endTick, count, ...(bountyId ? { bountyId } : {}) },
  };
}

function postAndClaim(): SimCommandV1[] {
  return [
    {
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_post',
      kind: 'bounty.post',
      args: { target: { kind: 'defend_area', ...AREA, durationH: DURATION_H }, reward: REWARD, expiresAt: EXPIRES },
    },
    { colonyIndex: 0, source: 'player', commandId: 'cm_claim', kind: 'bounty.claim', args: { bountyId: 'bt:0:1' } },
  ];
}

function advance(state: PlanetState, pipe: ReturnType<typeof world>['pipe'], n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...step(state, [], 1, pipe).events);
  return events;
}

function livingRecon(state: PlanetState) {
  const cols = state.entities.cols;
  const out: { id: number; owner: number; q: number; r: number }[] = [];
  for (let row = 0; row < state.entities.count; row++) {
    if (cols.kind[row] !== ENTITY_KIND.recon || cols.hp[row]! <= 0) continue;
    out.push({ id: cols.id[row]!, owner: cols.owner[row]!, q: cols.q[row]!, r: cols.r[row]! });
  }
  return out;
}

describe('W22-29 mercenary squads', () => {
  it('spawns 4 recon at the hub edge who complete a defend bounty with no other units and cost no supply', () => {
    const { state, pipe } = world();
    placeHub(state, AREA.q, AREA.r);
    expect(unitSupplyOfKind(ENTITY_KIND.recon, pipe.config.data)).toBe(1);

    const opened = step(state, [...postAndClaim(), hire(4, 101, 'bt:0:1')], 1, pipe);
    expect(opened.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined, undefined]);
    const squad = livingRecon(state);
    expect(squad).toHaveLength(4);
    expect(squad.every((unit) => unit.owner === MERCENARY_OWNER)).toBe(true);
    expect(squad.every((unit) => hexDistance(unit.q, unit.r, AREA.q, AREA.r) === 1)).toBe(true);
    expect(squad.every((unit) => getUnitStance(state, unit.id) === 'defend')).toBe(true);
    expect(readMercenary(state).contracts[0]).toMatchObject({ faction: MERCENARY_FACTION, poster: 0, rosterId: 'light' });
    expect(computeColonySupply(state, 0, pipe.config.data).units).toBe(0);
    expect(computeColonySupply(state, 0, pipe.config.data).used).toBe(0);
    expect(opened.events.some((event) => event.kind === 'mercenaryArrived')).toBe(true);

    const mid = advance(state, pipe, 99);
    expect(state.meta.tick).toBe(100);
    expect(livingRecon(state)).toHaveLength(4);
    expect(readBounty(state).bounties[0]?.presentTicks).toBe(100);
    expect(mid.filter((event) => event.kind === 'bountyCompleted' || event.kind === 'bountyRefunded')).toEqual([]);
    expect(computeColonySupply(state, 0, pipe.config.data).used).toBe(0);

    const done = advance(state, pipe, 1);
    const completed = done.filter((event) => event.kind === 'bountyCompleted');
    expect(completed).toHaveLength(1);
    expect(BountyCompletedDataSchema.parse(completed[0]?.data)).toMatchObject({
      bountyId: 'bt:0:1',
      claimer: 'col_0',
      kind: 'defend_area',
    });
    expect(livingRecon(state)).toHaveLength(0);
    expect(done.find((event) => event.kind === 'mercenaryLeft')?.data).toMatchObject({ bountyId: 'bt:0:1', reason: 'ended' });
    expect(computeColonySupply(state, 0, pipe.config.data).used).toBe(0);
  });

  it('removes the squad at endTick and does not bring it back', () => {
    const { state, pipe } = world();
    placeHub(state, AREA.q, AREA.r);
    const hired = step(state, [hire(4, 3)], 1, pipe);
    expect(hired.outcomes[0]?.code).toBeUndefined();
    expect(livingRecon(state)).toHaveLength(4);
    expect(state.meta.tick).toBe(1);

    expect(advance(state, pipe, 1).filter((event) => event.kind === 'mercenaryLeft')).toEqual([]);
    expect(state.meta.tick).toBe(2);
    expect(livingRecon(state)).toHaveLength(4);

    const left = advance(state, pipe, 1);
    expect(state.meta.tick).toBe(3);
    expect(livingRecon(state)).toHaveLength(0);
    expect(left.find((event) => event.kind === 'mercenaryLeft')?.data).toMatchObject({ rosterId: 'light', reason: 'ended' });
    advance(state, pipe, 2);
    expect(livingRecon(state)).toHaveLength(0);
    expect(readMercenary(state).contracts[0]?.left).toBe('ended');
  });

  it('spawns a heavy squad of 6, and a hire with W22 off does not spawn', () => {
    const on = world();
    placeHub(on.state, AREA.q, AREA.r);
    const heavy = step(on.state, [hire(6, 20)], 1, on.pipe);
    expect(heavy.outcomes[0]?.code).toBeUndefined();
    const squad = livingRecon(on.state);
    expect(squad).toHaveLength(6);
    expect(squad.every((unit) => unit.owner === MERCENARY_OWNER && hexDistance(unit.q, unit.r, AREA.q, AREA.r) === 1)).toBe(true);
    expect(readMercenary(on.state).contracts[0]?.rosterId).toBe('heavy');
    expect(computeColonySupply(on.state, 0, on.pipe.config.data).used).toBe(0);

    const off = world('..21');
    placeHub(off.state, AREA.q, AREA.r);
    const before = off.state.entities.count;
    const rejected = step(off.state, [hire(4, 20)], 1, off.pipe);
    expect(rejected.outcomes[0]?.code).toBe('wave_disabled');
    expect(livingRecon(off.state)).toHaveLength(0);
    expect(off.state.entities.count).toBe(before);
    expect(readMercenary(off.state).contracts).toEqual([]);
  });
});
