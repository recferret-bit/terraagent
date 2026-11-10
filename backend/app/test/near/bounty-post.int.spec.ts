import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyPostError } from '../../src/near/bounty/errors.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { HOUR_MS } from '../../src/near/bounty/validate.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { escrowHoldAccount, escrowIdFromOp } from '../../src/near/infrastructure/adapters/mock/escrow-id.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';

const TOKEN = 'metals.t1';
const NOW = 1_700_000_000_000;
const PLANET = 'pl_w22_bounty';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 19 });

let db: TestDatabase;
let posts: BountyPostService;
let world: PlanetState;
let seenNest = 0;
let hiddenNest = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-19', radius: 8 });
  seenNest = hive(world, 3, -1);
  hiddenNest = hive(world, 6, 2);
  const tile = hexIndex(world.grid.radius).indexOf(3, -1);
  recordColonyTileExplored(world.grid.layers as TileLayersLike, world.grid.count, tile, 0, world.meta.tick, world.meta, world.blobs);
  const cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  const escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  posts = new BountyPostService(
    escrow,
    cargo,
    new BountyRepository(db.prisma),
    new ChainOutboxRepository(db.prisma),
    { load: async () => world },
    { has: () => true },
  );
});

afterAll(async () => {
  await db?.drop();
});

describe('bounty post (W22-19)', () => {
  it('opens escrow for a visible nest and reduces cargo by the reward', async () => {
    const poster = await fund('w2219-poster.terraagent.mock', 500);
    const expiresAt = NOW + 48 * HOUR_MS;
    const posted = await posts.post(input(poster, 'col_poster', 'bt_seen', String(seenNest), 200, expiresAt));
    expect(posted.state).toBe('open');
    expect(posted.expiresAt).toBe(expiresAt);
    expect(posted.opId).toBe('bounty-open:bt_seen');
    expect(posted.receipt.status).toBe('success');
    expect(posted.receipt.txHash.startsWith('mock:')).toBe(true);
    expect(posted.escrowId).toBe(escrowIdFromOp(posted.opId));
    expect(await units(poster.accountId)).toBe(300);
    const escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
    const view = await escrow.get({ escrowId: posted.escrowId });
    expect(view.expiresAtMs).toBe(0);
    expect(view.beneficiary).toBe(escrowHoldAccount(posted.escrowId));
    expect(view.amount).toBe(toCargoBaseUnits(200));
    expect(view.status).toBe('open');
    const outbox = await db.prisma.chainOutbox.findUnique({ where: { opId: posted.opId } });
    expect(outbox?.status).toBe('DONE');
    const row = await db.prisma.chainBounty.findUnique({ where: { id: posted.id } });
    expect(row?.expiresAt.getTime()).toBe(expiresAt);
    expect(row?.state).toBe('open');
  });

  it('rejects a hidden or missing nest and leaves cargo alone', async () => {
    const poster = await fund('w2219-hidden.terraagent.mock', 80);
    await expect(posts.post(input(poster, 'col_hidden', 'bt_hidden', String(hiddenNest), 10, NOW + 2 * HOUR_MS)))
      .rejects.toMatchObject({ code: 'invalid_target' });
    await expect(posts.post(input(poster, 'col_hidden', 'bt_missing', '404', 10, NOW + 2 * HOUR_MS)))
      .rejects.toBeInstanceOf(BountyPostError);
    expect(await units(poster.accountId)).toBe(80);
    expect(await db.prisma.mockChainEscrow.count({ where: { opener: poster.accountId } })).toBe(0);
    expect(await db.prisma.chainBounty.count({ where: { posterColonyId: 'col_hidden' } })).toBe(0);
  });

  it('rejects a reward above the cargo balance and writes no escrow row', async () => {
    const poster = await fund('w2219-poor.terraagent.mock', 40);
    await expect(posts.post(input(poster, 'col_poor', 'bt_poor', String(seenNest), 200, NOW + 3 * HOUR_MS)))
      .rejects.toMatchObject({ code: 'insufficient_cargo' });
    expect(await units(poster.accountId)).toBe(40);
    expect(await db.prisma.mockChainEscrow.count({ where: { opener: poster.accountId } })).toBe(0);
    expect(await db.prisma.chainBounty.count({ where: { id: 'bt_poor' } })).toBe(0);
  });

  it('rejects a fourth active bounty and an expiry of 1 h, and accepts 48 h', async () => {
    const poster = await fund('w2219-cap.terraagent.mock', 100);
    for (let n = 1; n <= 3; n += 1) {
      const posted = await posts.post(input(poster, 'col_cap', `bt_cap_${n}`, String(seenNest), 10, NOW + 48 * HOUR_MS));
      expect(posted.state).toBe('open');
    }
    await expect(posts.post(input(poster, 'col_cap', 'bt_cap_4', String(seenNest), 10, NOW + 48 * HOUR_MS)))
      .rejects.toMatchObject({ code: 'queue_full' });
    expect(await units(poster.accountId)).toBe(70);
    expect(await db.prisma.chainBounty.count({ where: { posterColonyId: 'col_cap' } })).toBe(3);

    const early = await fund('w2219-early.terraagent.mock', 20);
    await expect(posts.post(input(early, 'col_early', 'bt_early', String(seenNest), 5, NOW + HOUR_MS)))
      .rejects.toMatchObject({ code: 'invalid_args' });
    expect(await units(early.accountId)).toBe(20);
    expect(await db.prisma.mockChainEscrow.count({ where: { opener: early.accountId } })).toBe(0);

    const edge = await fund('w2219-edge.terraagent.mock', 20);
    const posted = await posts.post(input(edge, 'col_edge', 'bt_edge', String(seenNest), 5, NOW + 48 * HOUR_MS));
    expect(posted.state).toBe('open');
    expect(posted.expiresAt).toBe(NOW + 48 * HOUR_MS);
    expect(await units(edge.accountId)).toBe(15);
  });

  it('does not debit twice for the same bounty id and opId', async () => {
    const poster = await fund('w2219-idem.terraagent.mock', 90);
    const body = input(poster, 'col_idem', 'bt_idem', String(seenNest), 25, NOW + 4 * HOUR_MS);
    const first = await posts.post(body);
    const second = await posts.post(body);
    expect(second.id).toBe(first.id);
    expect(second.escrowTx).toBe(first.escrowTx);
    expect(second.receipt.txHash).toBe(first.receipt.txHash);
    expect(await units(poster.accountId)).toBe(65);
    expect(await db.prisma.mockChainEscrow.count({ where: { opener: poster.accountId } })).toBe(1);
    expect(await db.prisma.chainBounty.count({ where: { opId: 'bounty-open:bt_idem' } })).toBe(1);
  });
});

async function fund(accountId: string, major: number): Promise<{ accountId: string }> {
  await new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }).mint({
    opId: `w2219:fund:${accountId}`,
    to: accountId,
    tokenId: TOKEN,
    amount: toCargoBaseUnits(major),
    caller: CARGO_MINTER_ACCOUNT,
  });
  return { accountId };
}

async function units(accountId: string): Promise<number> {
  const row = await db.prisma.mockChainBalance.findUnique({
    where: { accountId_tokenId: { accountId, tokenId: TOKEN } },
  });
  const whole = (row?.amount.toFixed() ?? '0').split('.')[0] ?? '0';
  return Number(BigInt(whole) / 10n ** 18n);
}

function input(
  poster: { accountId: string },
  colonyId: string,
  bountyId: string,
  nestId: string,
  amount: number,
  expiresAt: number,
): BountyPostInput {
  return {
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId: poster.accountId,
    bountyId,
    nowMs: NOW,
    args: {
      target: { kind: 'clear_nest', nestId },
      reward: { resource: TOKEN, amount },
      expiresAt,
    },
  };
}

function hive(state: PlanetState, q: number, r: number): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = ENTITY_KIND.hiveBlackAnt;
  state.entities.cols.hp[row] = 100;
  state.entities.cols.hpMax[row] = 100;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}
