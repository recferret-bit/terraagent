import {
  ENTITY_KIND,
  createState,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  recordColonyTileExplored,
  type PlanetState,
  type TileLayersLike,
} from '@terra/sim';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import { FlagsService } from '../../src/flags/flags.service';
import { toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port';
import {
  TreasuryDaoPort,
  type DaoView,
  type ProposeInput,
  type ProposeResult,
  type VoteInput,
} from '../../src/near/application/ports/treasury-dao.port';
import { BountyRepository } from '../../src/near/bounty/bounty.repository';
import { BountyLifecycleListener } from '../../src/near/bounty/lifecycle.listener';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service';
import { HOUR_MS, bountyOpenOpId } from '../../src/near/bounty/validate';
import type { ChainReceipt } from '../../src/near/domain/types';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { daoAccountIdFor } from '../../src/near/treasury/policy';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';

const ENV = { NODE_ENV: 'test', DATABASE_URL: 'postgres://treasury-bounty-edges', TA_WAVES: '..22' };
const VOTER = 'voter.pilot.terraagent.mock';
const CLAIMER = 'claimer.pilot.terraagent.mock';
const OTHER = 'other.pilot.terraagent.mock';
const TOKEN = 'metals.t1';
const NOW = 1_700_000_000_000;
const FUNDED = 80;
const RECEIPT: ChainReceipt = { txHash: 'mock:edge', status: 'success', network: 'mock', at: 1 };

interface PlanetMark {
  readonly lifecycle: string;
  readonly state: string;
}

interface HeldBounty {
  id: string;
  state: string;
  claimerAccountId: string | null;
  escrowId: string;
}

const field = buildField();

afterEach(() => {
  mockChainControls.reset();
});

describe('treasury bounty edges (W22-33)', () => {
  it('rejects a proposal on an ended planet', async () => {
    const planets = new Map<string, PlanetMark>([
      ['pl-archived', { lifecycle: 'ARCHIVED', state: 'RECRUITING' }],
      ['pl-ended', { lifecycle: 'ACTIVE', state: 'ENDED' }],
    ]);
    const dao = new MemoryDao(daoAccountIdFor('pl-archived'));
    const proposals = council(planets, dao);
    await expect(proposals.propose('pl-archived', proposeBody(), req())).rejects.toMatchObject({
      errorCode: 'planet_ended',
      status: 409,
    });
    await expect(proposals.propose('pl-ended', proposeBody(), req())).rejects.toMatchObject({
      errorCode: 'planet_ended',
    });
    expect(dao.proposes).toBe(0);
  });

  it('rejects a second vote with ALREADY_VOTED', async () => {
    const planetId = 'pl-vote';
    const dao = new MemoryDao(daoAccountIdFor(planetId));
    const proposals = council(new Map([[planetId, { lifecycle: 'ACTIVE', state: 'ACTIVE' }]]), dao);
    const opened = await proposals.propose(planetId, proposeBody(), req());
    await proposals.vote(planetId, String(opened.proposalId), { vote: 'approve', colonyAccountId: VOTER }, req());
    await expect(
      proposals.vote(planetId, String(opened.proposalId), { vote: 'reject', colonyAccountId: VOTER }, req()),
    ).rejects.toMatchObject({ errorCode: 'ALREADY_VOTED', status: 409 });
    expect(dao.votes).toBe(1);
    expect(dao.proposals[0]).toMatchObject({ state: 'InProgress', yes: 1, no: 0 });
  });

  it('rejects a bounty on a dead nest with invalid_target', async () => {
    const cargo = new HoldingCargo(FUNDED);
    let opened = 0;
    const escrow = {
      open: () => {
        opened += 1;
        return Promise.reject(new Error('escrow opened'));
      },
    };
    const { posts } = board(escrow, cargo);
    await expect(
      posts.post(nestPost('poster-dead.terraagent.mock', 'col_dead', 'bt_dead', field.deadId)),
    ).rejects.toMatchObject({ code: 'invalid_target', errorCode: 'invalid_target' });
    expect(opened).toBe(0);
    expect(cargo.units).toBe(FUNDED);
    expect(cargo.writes).toBe(0);
  });

  it('leaves the bounty not open and the cargo unchanged when escrow fail rate is 1', async () => {
    const cargo = new HoldingCargo(FUNDED);
    const repo = new MemoryBounties();
    const outbox = new MemoryOutbox();
    const escrow = new MockEscrowAdapter(
      { mockChainReceipt: { findUnique: async () => null } } as never,
      { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 3 },
      { sleep: async () => undefined },
    );
    const posts = new BountyPostService(
      escrow,
      cargo as never,
      repo as never,
      outbox as never,
      { load: async () => field.state },
      {
        has: () => true,
      },
    );
    mockChainControls.setFail('escrow', 1);
    await expect(
      posts.post(nestPost('poster-fail.terraagent.mock', 'col_fail', 'bt_fail', field.liveId)),
    ).rejects.toMatchObject({ errorCode: 'NEAR_MOCK_INJECTED_FAILURE' });
    expect(repo.rows.some((row) => row.state === 'open')).toBe(false);
    expect(repo.rows.find((row) => row.id === 'bt_fail')?.state ?? 'pending').not.toBe('open');
    expect(outbox.status.get(bountyOpenOpId('bt_fail'))).toBe('DEAD');
    expect(cargo.units).toBe(FUNDED);
    expect(cargo.writes).toBe(0);
  });

  it('reopens a claimed bounty when the claimer is eliminated', async () => {
    const rows = seedRows();
    const calls: Array<{ data: { state: string; claimerAccountId: string | null } }> = [];
    const db = eliminationDb(rows, calls);
    const bus = new EventBus();
    const listener = new BountyLifecycleListener(
      bus,
      {} as never,
      {} as never,
      new BountyRepository(db),
      new FlagsService(ENV as never),
      db,
    );
    listener.onModuleInit();
    bus.emit('planet.event', {
      planetId: 'pl_edge',
      tick: 4,
      kind: 'colonyEliminated',
      severity: 'critical',
      colonyIds: ['col_1'],
      data: { colonyId: 'col_1', colonyIndex: 1, cause: 'raid', atTick: 4 },
    });
    await flush();
    listener.onModuleDestroy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toEqual({ state: 'open', claimerAccountId: null });
    expect(rows[0]).toMatchObject({ id: 'bt_claimed', state: 'open', claimerAccountId: null, escrowId: 'esc_keep' });
    expect(rows[1]).toMatchObject({ state: 'completed', claimerAccountId: CLAIMER, escrowId: 'esc_done' });
    expect(rows[2]).toMatchObject({ state: 'claimed', claimerAccountId: OTHER, escrowId: 'esc_other' });
  });
});

function council(planets: Map<string, PlanetMark>, dao: MemoryDao): TreasuryProposalsService {
  const flags = new FlagsService(ENV as never);
  const prisma = fakePrisma(planets);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, undefined, prisma, ENV as never);
  return new TreasuryProposalsService(flags, lifecycle, dao, prisma, ENV as never);
}

function fakePrisma(planets: Map<string, PlanetMark>): PrismaClient {
  return {
    planet: {
      findUnique: async ({ where }: { where: { id: string } }) => planets.get(where.id) ?? null,
    },
    mockChainDao: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }),
    },
    mockChainDaoProposal: { findMany: async () => [] },
    nearColonyAccount: { findUnique: async () => null },
  } as unknown as PrismaClient;
}

function proposeBody(): { kind: string; colonyAccountId: string } {
  return { kind: 'meteor_shield', colonyAccountId: VOTER };
}

function req(): IncomingMessage {
  return { headers: {} } as IncomingMessage;
}

class MemoryDao extends TreasuryDaoPort {
  readonly proposals: DaoView['proposals'][number][] = [];
  proposes = 0;
  votes = 0;
  private nextId = 1;

  constructor(readonly daoAccountId: string) {
    super();
  }

  propose(input: ProposeInput): Promise<ProposeResult> {
    this.proposes += 1;
    const proposalId = this.nextId;
    this.nextId += 1;
    this.proposals.push({
      proposalId,
      proposer: input.proposer,
      kind: input.kind,
      description: input.description,
      state: 'InProgress',
      yes: 0,
      no: 0,
      votes: [],
    });
    return Promise.resolve({ proposalId, receipt: RECEIPT });
  }

  vote(input: VoteInput): Promise<ChainReceipt> {
    const row = this.proposals.find((proposal) => proposal.proposalId === input.proposalId);
    if (!row) return Promise.reject(new Error('missing proposal'));
    this.votes += 1;
    const vote = input.vote === 'reject' ? 'reject' : 'approve';
    row.votes.push({ voter: input.voter, vote });
    if (vote === 'approve') row.yes += 1;
    else row.no += 1;
    return Promise.resolve(RECEIPT);
  }

  get(): Promise<DaoView> {
    return Promise.resolve({
      daoAccountId: this.daoAccountId,
      name: 'edge',
      members: [{ accountId: VOTER, canPropose: true }],
      balances: { [TOKEN]: '2000' },
      proposals: this.proposals,
    });
  }

  createDao(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  finalize(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  deposit(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  addMember(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }

  removeMember(): Promise<never> {
    return Promise.reject(new Error('not used'));
  }
}

class HoldingCargo {
  writes = 0;

  constructor(public units: number) {}

  balanceOf(): Promise<string> {
    return Promise.resolve(toCargoBaseUnits(this.units));
  }

  transfer(): Promise<never> {
    return this.wrote();
  }

  mint(): Promise<never> {
    return this.wrote();
  }

  burn(): Promise<never> {
    return this.wrote();
  }

  private wrote(): Promise<never> {
    this.writes += 1;
    return Promise.reject(new Error('cargo changed'));
  }
}

class MemoryBounties {
  readonly rows: Array<{ id: string; state: string }> = [];

  find(): Promise<null> {
    return Promise.resolve(null);
  }

  countActive(): Promise<number> {
    return Promise.resolve(0);
  }

  insert(row: { id: string }): Promise<{ id: string; state: string }> {
    const saved = { id: row.id, state: 'open' };
    this.rows.push(saved);
    return Promise.resolve(saved);
  }
}

class MemoryOutbox {
  readonly status = new Map<string, string>();

  enqueue(entry: { opId: string }): Promise<{ opId: string }> {
    this.status.set(entry.opId, 'PENDING');
    return Promise.resolve({ opId: entry.opId });
  }

  abandon(opId: string): Promise<boolean> {
    this.status.set(opId, 'DEAD');
    return Promise.resolve(true);
  }

  markDoneByOpId(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function board(escrow: unknown, cargo: HoldingCargo): { posts: BountyPostService } {
  const service = new BountyPostService(
    escrow as never,
    cargo as never,
    new MemoryBounties() as never,
    new MemoryOutbox() as never,
    { load: async () => field.state },
    { has: () => true },
  );
  return { posts: service };
}

function nestPost(accountId: string, colonyId: string, bountyId: string, nestId: string): BountyPostInput {
  return {
    planetId: 'pl_w22_33',
    colonyId,
    colonyIndex: 0,
    accountId,
    bountyId,
    nowMs: NOW,
    args: {
      target: { kind: 'clear_nest', nestId },
      reward: { resource: TOKEN, amount: 10 },
      expiresAt: NOW + 4 * HOUR_MS,
    },
  };
}

function buildField(): { state: PlanetState; deadId: string; liveId: string } {
  const state = createState({ planetId: 'pl_w22_33', planetType: 'temperate', seed: 'w22-33', radius: 8 });
  const deadId = hive(state, 3, -1, 0);
  const liveId = hive(state, 4, -1, 100);
  explore(state, 3, -1);
  explore(state, 4, -1);
  return { state, deadId: String(deadId), liveId: String(liveId) };
}

function hive(state: PlanetState, q: number, r: number, hp: number): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = ENTITY_KIND.hiveBlackAnt;
  state.entities.cols.hp[row] = hp;
  state.entities.cols.hpMax[row] = 100;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

function explore(state: PlanetState, q: number, r: number): void {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  recordColonyTileExplored(
    state.grid.layers as TileLayersLike,
    state.grid.count,
    tile,
    0,
    state.meta.tick,
    state.meta,
    state.blobs,
  );
}

function seedRows(): HeldBounty[] {
  return [
    { id: 'bt_claimed', state: 'claimed', claimerAccountId: CLAIMER, escrowId: 'esc_keep' },
    { id: 'bt_done', state: 'completed', claimerAccountId: CLAIMER, escrowId: 'esc_done' },
    { id: 'bt_other', state: 'claimed', claimerAccountId: OTHER, escrowId: 'esc_other' },
  ];
}

function eliminationDb(
  rows: HeldBounty[],
  calls: Array<{ data: { state: string; claimerAccountId: string | null } }>,
): PrismaClient {
  return {
    chainBounty: {
      updateMany: async (args: {
        where: { claimerAccountId: string; state: string };
        data: { state: string; claimerAccountId: null };
      }) => {
        calls.push(args);
        let count = 0;
        for (const row of rows) {
          if (row.claimerAccountId === args.where.claimerAccountId && row.state === args.where.state) {
            row.state = args.data.state;
            row.claimerAccountId = args.data.claimerAccountId;
            count += 1;
          }
        }
        return { count };
      },
    },
    nearColonyAccount: {
      findFirst: async () => ({ accountId: CLAIMER, playerId: 'p1' }),
    },
  } as unknown as PrismaClient;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
