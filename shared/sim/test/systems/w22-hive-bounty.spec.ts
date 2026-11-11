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
  ensureColonyRecord,
  ENTITY_KIND,
  hexIndex,
  insertRow,
  markTileExplored,
  placeSpawnedEntity,
  rowOf,
  step,
  type PlanetState,
  type SimEvent,
  type StepContext,
} from '../../src';
import bountyMod, { readBounty } from '../../src/systems/bounty';

const REWARD = { resource: 'metals.t1' as const, amount: 200 };
const EXPIRES = 1_700_000_000_000;

/** Anchor tiles inside one recon's view (radius 10) and far enough apart to stay distinct. */
const SPECIES = [
  { kind: ENTITY_KIND.hiveBlackAnt, species: 'blackAnt', q: 2, r: 0 },
  { kind: ENTITY_KIND.hiveBlueBeetle, species: 'blueBeetle', q: 0, r: 3 },
  { kind: ENTITY_KIND.hiveGreenSpitter, species: 'greenSpitter', q: -3, r: 1 },
] as const;

function world() {
  const state = createState({ planetId: 'pl_w22_hive', planetType: 'temperate', seed: 'w22-hive', radius: 16 });
  ensureColonyRecord(state, 1, 0);
  const pipe = createRegistryPipeline({ flags: parseWaves('..22'), modules: [bountyMod] });
  return { state, pipe };
}

function spawnHive(state: PlanetState, kind: number, q: number, r: number): number {
  const hiveId = state.meta.nextEntityId++;
  const row = insertRow(state.entities, hiveId, state.meta.tick);
  state.entities.cols.kind[row] = kind;
  state.entities.cols.owner[row] = -1;
  state.entities.cols.hp[row] = 1500;
  state.entities.cols.hpMax[row] = 1500;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return hiveId;
}

/** Living recon. Idle (state 0) contributes W07 vision; view radius 10. */
function placeScout(state: PlanetState, colony: number, q: number, r: number): void {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = ENTITY_KIND.recon;
  state.entities.cols.owner[row] = colony;
  state.entities.cols.hp[row] = 80;
  state.entities.cols.hpMax[row] = 80;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
}

function explore(state: PlanetState, colony: number, q: number, r: number): void {
  markTileExplored(state.grid, hexIndex(state.grid.radius).indexOf(q, r), colony, state.meta.tick);
}

function postCmd(colonyIndex: number, nestId: number, commandId: string): SimCommandV1 {
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

function kill(
  state: PlanetState,
  pipe: ReturnType<typeof world>['pipe'],
  hiveId: number,
  attackerOwner: number,
): SimEvent[] {
  const tick = state.meta.tick;
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
  applyDamage(state, hiveId, 1500, { attackerOwner, tick, ctx });
  return events;
}

describe('W22-37 species hive clear_nest', () => {
  it('completes for the claimer who destroys each spotted species hive', () => {
    const { state, pipe } = world();
    const hives = SPECIES.map((hive) => ({ ...hive, id: spawnHive(state, hive.kind, hive.q, hive.r) }));
    placeScout(state, 0, 0, 0);
    expect(hives.map((hive) => hive.id)).toEqual([1, 2, 3]);

    for (const hive of hives) {
      const bountyId = `bt:0:${state.meta.tick + 1}`;
      const posted = step(state, [postCmd(0, hive.id, `cm_post_${hive.id}`), claimCmd(1, bountyId, `cm_claim_${hive.id}`)], 1, pipe);
      expect(posted.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined]);
    }

    for (const hive of hives) {
      const events = kill(state, pipe, hive.id, 1);
      const bountyId = `bt:0:${hive.id}`;
      expect(events.find((event) => event.kind === 'nestDestroyed')?.data).toMatchObject({
        hiveId: hive.id,
        species: hive.species,
        q: hive.q,
        r: hive.r,
      });
      const completed = events.filter((event) => event.kind === 'bountyCompleted');
      expect(completed).toHaveLength(1);
      expect(BountyCompletedDataSchema.parse(completed[0]?.data)).toMatchObject({
        bountyId,
        claimer: 'col_1',
        kind: 'clear_nest',
      });
      expect(events.filter((event) => event.kind === 'bountyRefunded')).toEqual([]);
    }
    expect(readBounty(state).bounties.map((bounty) => bounty.state)).toEqual(['completed', 'completed', 'completed']);
  });

  it('refunds when the poster destroys their own spotted hive', () => {
    const { state, pipe } = world();
    const hiveId = spawnHive(state, ENTITY_KIND.hiveBlueBeetle, 2, 0);
    placeScout(state, 0, 0, 0);
    const bountyId = 'bt:0:1';
    const claimed = step(state, [postCmd(0, hiveId, 'cm_post'), claimCmd(0, bountyId, 'cm_claim')], 1, pipe);
    expect(claimed.outcomes.map((outcome) => outcome.code)).toEqual([undefined, undefined]);

    const events = kill(state, pipe, hiveId, 0);
    expect(events.find((event) => event.kind === 'nestDestroyed')?.data).toMatchObject({ hiveId, species: 'blueBeetle' });
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

  it('rejects an already-dead spotted hive and a living hive the poster has not spotted', () => {
    const dead = world();
    const deadId = spawnHive(dead.state, ENTITY_KIND.hiveGreenSpitter, 2, 0);
    placeScout(dead.state, 0, 0, 0);
    explore(dead.state, 0, 2, 0);
    dead.state.entities.cols.hp[rowOf(dead.state.entities, deadId)] = 0;
    const deadPost = step(dead.state, [postCmd(0, deadId, 'cm_dead')], 1, dead.pipe);
    expect(deadPost.outcomes[0]?.code).toBe('invalid_target');
    expect(readBounty(dead.state).bounties).toEqual([]);

    const hidden = world();
    const hiddenId = spawnHive(hidden.state, ENTITY_KIND.hiveBlackAnt, 14, 0);
    const hiddenPost = step(hidden.state, [postCmd(0, hiddenId, 'cm_hidden')], 1, hidden.pipe);
    expect(hiddenPost.outcomes[0]?.code).toBe('invalid_target');
    expect(hidden.state.entities.cols.hp[rowOf(hidden.state.entities, hiddenId)]).toBe(1500);
    expect(readBounty(hidden.state).bounties).toEqual([]);
  });
});
