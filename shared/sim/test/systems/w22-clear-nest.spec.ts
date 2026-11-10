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
  dataRow,
  ensureColonyRecord,
  ENTITY_KIND,
  hexIndex,
  insertRow,
  markTileExplored,
  placeSpawnedEntity,
  step,
  type PlanetState,
  type SimEvent,
  type StepContext,
} from '../../src';
import bountyMod, { readBounty } from '../../src/systems/bounty';

const REWARD = { resource: 'metals.t1' as const, amount: 200 };
const EXPIRES = 1_700_000_000_000;

function world(flags = '..22') {
  const state = createState({ planetId: 'pl_w22_nest', planetType: 'temperate', seed: 'w22-nest', radius: 16 });
  ensureColonyRecord(state, 2, 0);
  const pipe = createRegistryPipeline({ flags: parseWaves(flags), modules: [bountyMod] });
  return { state, pipe, hiveId: spawnHive(state) };
}

function spawnHive(state: PlanetState): number {
  const hiveId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, hiveId, state.meta.tick);
  state.entities.cols.kind[row] = ENTITY_KIND.hiveBlackAnt;
  state.entities.cols.owner[row] = -1;
  state.entities.cols.hp[row] = 1500;
  state.entities.cols.hpMax[row] = 1500;
  placeSpawnedEntity(state.entities, row, 8, -4, state.meta.tick);
  const tile = hexIndex(state.grid.radius).indexOf(8, -4);
  markTileExplored(state.grid, tile, 0, state.meta.tick);
  return hiveId;
}

function postCmd(colonyIndex: number, nestId: string, commandId: string): SimCommandV1 {
  return {
    colonyIndex,
    source: 'player',
    commandId,
    kind: 'bounty.post',
    args: { target: { kind: 'clear_nest', nestId: String(nestId) }, reward: REWARD, expiresAt: EXPIRES },
  };
}

function claimCmd(colonyIndex: number, bountyId: string, commandId: string): SimCommandV1 {
  return { colonyIndex, source: 'player', commandId, kind: 'bounty.claim', args: { bountyId } };
}

function hit(state: PlanetState, pipe: ReturnType<typeof world>['pipe'], hiveId: number, amount: number, attackerOwner: number, tick: number): SimEvent[] {
  const events: SimEvent[] = [];
  const ctx: StepContext = {
    dt: 1,
    tick,
    flags: pipe.config.flags,
    data: pipe.config.data,
    events,
    postings: [],
    rng: (s) => state.rng[s],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => {
      events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: tick });
    },
    record: () => undefined,
  };
  applyDamage(state, hiveId, amount, { attackerOwner, tick, ctx });
  return events;
}

describe('W22-20 clear_nest', () => {
  it('completes for the claimer who deals the killing damage', () => {
    const { state, pipe, hiveId } = world();
    const bountyId = 'bt:0:1';
    const posted = step(state, [postCmd(0, String(hiveId), 'cm_post'), claimCmd(1, bountyId, 'cm_claim')], 1, pipe);
    expect(posted.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined]);
    expect(posted.events.find((event) => event.kind === 'bountyPosted')?.data).toMatchObject({ bountyId, posterId: 'col_0' });
    expect(state.colonies[1]?.id).toBe('col_1');

    const events = hit(state, pipe, hiveId, 1500, 1, state.meta.tick);
    const completed = events.filter((event) => event.kind === 'bountyCompleted');
    expect(completed).toHaveLength(1);
    expect(BountyCompletedDataSchema.parse(completed[0]?.data)).toMatchObject({
      bountyId,
      claimer: 'col_1',
      kind: 'clear_nest',
    });
    expect(events.filter((event) => event.kind === 'bountyRefunded')).toEqual([]);
    expect(readBounty(state).bounties[0]?.state).toBe('completed');

    const paid = step(state, [{
      colonyIndex: null,
      source: 'near',
      commandId: 'cm_paid',
      kind: 'bounty.paid',
      args: { bountyId, claimerId: 'col_1', amount: 200 },
    }], 1, pipe);
    expect(paid.outcomes[0]?.code).toBeUndefined();
    expect(paid.events.filter((event) => event.kind === 'bountyPaid')).toEqual([]);
    expect(paid.postings).toEqual([]);
    expect(readBounty(state).bounties[0]?.state).toBe('paid');
  });

  it('refunds when the poster deals the killing damage, even if they claimed', () => {
    const { state, pipe, hiveId } = world();
    const bountyId = 'bt:0:1';
    const claimed = step(state, [postCmd(0, String(hiveId), 'cm_post'), claimCmd(0, bountyId, 'cm_claim')], 1, pipe);
    expect(claimed.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined]);
    expect(claimed.events.find((event) => event.kind === 'bountyClaimed')?.data).toMatchObject({ claimer: 'col_0', kind: 'clear_nest' });

    const events = hit(state, pipe, hiveId, 1500, 0, state.meta.tick);
    expect(events.filter((event) => event.kind === 'bountyCompleted')).toEqual([]);
    const refunded = events.filter((event) => event.kind === 'bountyRefunded');
    expect(refunded).toHaveLength(1);
    expect(BountyRefundedDataSchema.parse(refunded[0]?.data)).toEqual({
      bountyId,
      posterId: 'col_0',
      resource: 'metals.t1',
      amount: 200,
      reason: 'cancelled',
    });
    expect(readBounty(state).bounties[0]?.state).toBe('refunded');
  });

  it('ignores damage older than the window and refunds when a non-claimer dealt all of it', () => {
    const { state, pipe, hiveId } = world();
    const windowTicks = dataRow(pipe.config.data, 'bounty', 'clear_nest').damageWindowTicks;
    expect(windowTicks).toBe(300);
    const bountyId = 'bt:0:1';
    step(state, [postCmd(0, String(hiveId), 'cm_post'), claimCmd(1, bountyId, 'cm_claim')], 1, pipe);

    hit(state, pipe, hiveId, 1400, 2, 10);
    const fresh = hit(state, pipe, hiveId, 200, 1, 10 + Number(windowTicks) + 1);
    const completed = fresh.filter((event) => event.kind === 'bountyCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.data).toMatchObject({ bountyId, claimer: 'col_1' });
    expect(fresh.filter((event) => event.kind === 'bountyRefunded')).toEqual([]);

    const other = world();
    const otherId = 'bt:0:1';
    step(other.state, [postCmd(0, String(other.hiveId), 'cm_post'), claimCmd(1, otherId, 'cm_claim')], 1, other.pipe);
    const stolen = hit(other.state, other.pipe, other.hiveId, 1500, 2, other.state.meta.tick);
    expect(stolen.filter((event) => event.kind === 'bountyCompleted')).toEqual([]);
    expect(BountyRefundedDataSchema.parse(stolen.find((event) => event.kind === 'bountyRefunded')?.data)).toMatchObject({
      bountyId: otherId,
      posterId: 'col_0',
      reason: 'failed',
    });
    expect(readBounty(other.state).bounties[0]?.state).toBe('refunded');
  });

  it('does not run bounty handlers when W22 is off', () => {
    const flags = parseWaves('..21');
    const pipe = createRegistryPipeline({ flags });
    expect(pipe.handlers.get('bounty.post')?.wave).toBe('W22');
    expect(pipe.handlers.get('bounty.claim')?.wave).toBe('W22');
    expect(pipe.handlers.get('bounty.paid')?.wave).toBe('W22');
    expect(flags.has('W22')).toBe(false);

    const state = createState({ planetId: 'pl_w22_off', planetType: 'temperate', seed: 'w22-off', radius: 4 });
    ensureColonyRecord(state, 0, 0);
    const res = step(state, [postCmd(0, 'hive-1', 'cm_off')], 1, pipe);
    expect(res.outcomes[0]?.code).toBe('wave_disabled');
    expect(res.events.filter((event) => event.kind === 'bountyPosted')).toEqual([]);
    expect(state.blobs.bounty).toBeUndefined();
  });
});
