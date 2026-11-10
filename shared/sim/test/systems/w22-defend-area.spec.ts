import {
  BountyCompletedDataSchema,
  BountyRefundedDataSchema,
  parseWaves,
  type SimCommandV1,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  createRegistryPipeline,
  createState,
  ENTITY_KIND,
  ensureColonyRecord,
  insertRow,
  placeSpawnedEntity,
  step,
  type PlanetState,
  type SimEvent,
  type StepContext,
} from '../../src';
import bountyMod, { readBounty } from '../../src/systems/bounty';

const REWARD = { resource: 'metals.t1' as const, amount: 200 };
const EXPIRES = 1_700_000_000_000;
/** 100 ticks. `round((100/18000) * 18000) = 100` at 200 ms/tick. */
const DURATION_H = 100 / 18000;
const AREA = { q: 4, r: -2, radius: 3 };

function world() {
  const state = createState({ planetId: 'pl_w22_defend', planetType: 'temperate', seed: 'w22-defend', radius: 16 });
  ensureColonyRecord(state, 2, 0);
  const pipe = createRegistryPipeline({ flags: parseWaves('..22'), modules: [bountyMod] });
  return { state, pipe };
}

function postCmd(): SimCommandV1 {
  return {
    colonyIndex: 0,
    source: 'player',
    commandId: 'cm_post',
    kind: 'bounty.post',
    args: { target: { kind: 'defend_area', ...AREA, durationH: DURATION_H }, reward: REWARD, expiresAt: EXPIRES },
  };
}

function claimCmd(colonyIndex: number, commandId = 'cm_claim'): SimCommandV1 {
  return { colonyIndex, source: 'player', commandId, kind: 'bounty.claim', args: { bountyId: 'bt:0:1' } };
}

function spawn(state: PlanetState, kind: number, owner: number, q: number, r: number, hp = 160): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = owner;
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = hp;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

function advance(state: PlanetState, pipe: ReturnType<typeof world>['pipe'], n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...step(state, [], 1, pipe).events);
  return events;
}

function defend(state: PlanetState) {
  const row = readBounty(state).bounties[0];
  if (!row || row.startTick === undefined || row.endTick === undefined || row.presentTicks === undefined) {
    throw new Error('defend bounty missing');
  }
  return { row, duration: row.endTick - row.startTick, presentTicks: row.presentTicks, endTick: row.endTick };
}

function openAndClaim(state: PlanetState, pipe: ReturnType<typeof world>['pipe']) {
  const opened = step(state, [postCmd(), claimCmd(1)], 1, pipe);
  expect(opened.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined]);
  expect(opened.events.find((event) => event.kind === 'bountyPosted')?.data).toMatchObject({ bountyId: 'bt:0:1', posterId: 'col_0' });
  expect(defend(state).duration).toBe(100);
  expect(defend(state).endTick).toBe(101);
  return opened;
}

describe('W22-21 defend_area', () => {
  it('completes when a claimer combat unit holds the area for the whole window', () => {
    const { state, pipe } = world();
    spawn(state, ENTITY_KIND.recon, 1, AREA.q, AREA.r);
    openAndClaim(state, pipe);
    expect(defend(state).presentTicks).toBe(1);

    const mid = advance(state, pipe, 99);
    expect(defend(state).presentTicks).toBe(100);
    expect(mid.filter((event) => event.kind === 'bountyCompleted' || event.kind === 'bountyRefunded')).toEqual([]);

    const done = advance(state, pipe, 1);
    const completed = done.filter((event) => event.kind === 'bountyCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.atTick).toBe(101);
    expect(BountyCompletedDataSchema.parse(completed[0]?.data)).toMatchObject({
      bountyId: 'bt:0:1',
      claimer: 'col_1',
      kind: 'defend_area',
    });
    expect(done.filter((event) => event.kind === 'bountyRefunded')).toEqual([]);
    expect(readBounty(state).bounties[0]?.state).toBe('completed');
    expect(defend(state).presentTicks).toBe(100);
  });

  it('refunds when the combat unit stays outside the radius', () => {
    const { state, pipe } = world();
    spawn(state, ENTITY_KIND.recon, 1, AREA.q + AREA.radius + 1, AREA.r);
    openAndClaim(state, pipe);
    expect(defend(state).presentTicks).toBe(0);

    const mid = advance(state, pipe, 99);
    expect(defend(state).presentTicks).toBe(0);
    expect(mid.filter((event) => event.kind === 'bountyCompleted' || event.kind === 'bountyRefunded')).toEqual([]);

    const done = advance(state, pipe, 1);
    expect(done.filter((event) => event.kind === 'bountyCompleted')).toEqual([]);
    expect(BountyRefundedDataSchema.parse(done.find((event) => event.kind === 'bountyRefunded')?.data)).toEqual({
      bountyId: 'bt:0:1',
      posterId: 'col_0',
      resource: 'metals.t1',
      amount: 200,
      reason: 'failed',
    });
    expect(readBounty(state).bounties[0]?.state).toBe('refunded');
  });

  it('rejects a second claimer with queue_full and still rejects deliver_units', () => {
    const { state, pipe } = world();
    const claimed = step(state, [postCmd(), claimCmd(1), claimCmd(2, 'cm_claim_2')], 1, pipe);
    expect(claimed.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined, 'queue_full']);
    expect(readBounty(state).bounties[0]?.claimers).toEqual([1]);
    expect(readBounty(state).bounties[0]?.state).toBe('claimed');

    const delivered = step(state, [{
      colonyIndex: 0,
      source: 'player',
      commandId: 'cm_deliver',
      kind: 'bounty.post',
      args: { target: { kind: 'deliver_units', resource: 'bio.water', amount: 10 }, reward: REWARD, expiresAt: EXPIRES },
    }], 1, pipe);
    expect(delivered.outcomes[0]?.code).toBe('invalid_args');
  });
});

describe('W22-21 defend_area boundaries', () => {
  it('completes at exactly 80% presence (80 of 100 ticks) and refunds at 79% (79 of 100)', () => {
    const held = holdFor(20, 80);
    expect(held.presentTicks).toBe(80);
    expect(held.duration).toBe(100);
    const completed = held.done.filter((event) => event.kind === 'bountyCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.atTick).toBe(101);
    expect(BountyCompletedDataSchema.parse(completed[0]?.data)).toMatchObject({ bountyId: 'bt:0:1', claimer: 'col_1', kind: 'defend_area' });
    expect(held.done.filter((event) => event.kind === 'bountyRefunded')).toEqual([]);
    expect(readBounty(held.state).bounties[0]?.state).toBe('completed');

    const short = holdFor(21, 79);
    expect(short.presentTicks).toBe(79);
    expect(short.duration).toBe(100);
    expect(short.done.filter((event) => event.kind === 'bountyCompleted')).toEqual([]);
    expect(BountyRefundedDataSchema.parse(short.done.find((event) => event.kind === 'bountyRefunded')?.data)).toMatchObject({
      bountyId: 'bt:0:1',
      posterId: 'col_0',
      reason: 'failed',
    });
    expect(readBounty(short.state).bounties[0]?.state).toBe('refunded');
  });

  it('refunds immediately when a poster building in the area is destroyed, even if the unit was present', () => {
    const { state, pipe } = world();
    spawn(state, ENTITY_KIND.recon, 1, AREA.q, AREA.r);
    const buildingId = spawn(state, ENTITY_KIND.autocannon, 0, AREA.q, AREA.r, 100);
    openAndClaim(state, pipe);
    expect(defend(state).presentTicks).toBe(1);

    const lost = destroyBuilding(state, pipe, buildingId);
    expect(lost.filter((event) => event.kind === 'bountyCompleted')).toEqual([]);
    expect(BountyRefundedDataSchema.parse(lost.find((event) => event.kind === 'bountyRefunded')?.data)).toMatchObject({
      bountyId: 'bt:0:1',
      posterId: 'col_0',
      resource: 'metals.t1',
      amount: 200,
      reason: 'building_lost',
    });
    expect(readBounty(state).bounties[0]?.state).toBe('refunded');

    const rest = advance(state, pipe, defend(state).duration);
    expect(rest.filter((event) => event.kind === 'bountyCompleted' || event.kind === 'bountyRefunded')).toEqual([]);
    expect(readBounty(state).bounties[0]?.state).toBe('refunded');
  });
});

/** Absent for the first `absent` window ticks, then a recon stands in the area for `present` ticks. Resolves on the end tick. */
function holdFor(absent: number, present: number) {
  const { state, pipe } = world();
  openAndClaim(state, pipe);
  expect(defend(state).presentTicks).toBe(0);
  advance(state, pipe, absent - 1);
  expect(state.meta.tick).toBe(absent);
  expect(defend(state).presentTicks).toBe(0);
  spawn(state, ENTITY_KIND.recon, 1, AREA.q, AREA.r);
  const held = advance(state, pipe, present);
  expect(held.filter((event) => event.kind === 'bountyCompleted' || event.kind === 'bountyRefunded')).toEqual([]);
  expect(defend(state).presentTicks).toBe(present);
  expect(state.meta.tick).toBe(absent + present);
  const done = advance(state, pipe, 1);
  return { state, done, presentTicks: defend(state).presentTicks, duration: defend(state).duration };
}

function destroyBuilding(state: PlanetState, pipe: ReturnType<typeof world>['pipe'], entityId: number): SimEvent[] {
  const events: SimEvent[] = [];
  const tick = state.meta.tick;
  const ctx: StepContext = {
    dt: 1,
    tick,
    flags: pipe.config.flags,
    data: pipe.config.data,
    events,
    postings: [],
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (event) => {
      events.push({ severity: 'info', colonyIds: [], data: {}, ...event, atTick: tick });
    },
    record: () => undefined,
  };
  applyDamage(state, entityId, 100, { attackerOwner: 2, tick, ctx, data: pipe.config.data });
  return events;
}
