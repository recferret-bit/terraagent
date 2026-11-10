import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createState, hexIndex, setTileOwner } from '@terra/sim';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyClaimService } from '../../src/near/bounty/claim.service.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { bountyPayOpId, HOUR_MS } from '../../src/near/bounty/validate.js';
import { escrowHoldAccount } from '../../src/near/infrastructure/adapters/mock/escrow-id.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';

const TOKEN = 'metals.t1';
const PLANET = 'pl_w22_pay';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 23 });
const waves = { w22: true };

let db: TestDatabase;
let posts: BountyPostService;
let claims: BountyClaimService;
let pay: BountyPayService;
let cargo: MockCargoTokenAdapter;
let escrow: MockEscrowAdapter;

beforeAll(async () => {
  db = await createTestDatabase();
  const world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-23', radius: 4 });
  setTileOwner(world.grid, hexIndex(world.grid.radius).indexOf(0, 0), 0, world.meta.tick);
  cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  const flags = { has: (wave: string) => wave === 'W22' && waves.w22 };
  const repo = new BountyRepository(db.prisma);
  const outbox = new ChainOutboxRepository(db.prisma);
  posts = new BountyPostService(escrow, cargo, repo, outbox, { load: async () => world }, { has: () => true });
  claims = new BountyClaimService(repo, flags);
  pay = new BountyPayService(escrow, outbox, repo, flags);
});

afterAll(async () => {
  await db?.drop();
});

describe('bounty claim and payout (W22-23)', () => {
  it('pays the claimer 200 metals once', async () => {
    const poster = 'w2223-poster-pay.terraagent.mock';
    const claimer = 'w2223-claimer-pay.terraagent.mock';
    const posted = await postReward(poster, 'col_pay', 'bt_pay', 200);
    await claims.claim({ planetId: PLANET, bountyId: posted.id, accountId: claimer });
    await markCompleted(posted.id);
    expect(await pay.pay(posted.id)).toBe(true);
    expect(await units(claimer)).toBe(200);
    expect((await escrow.get({ escrowId: posted.escrowId })).status).toBe('claimed');
    const beforeSecond = await units(claimer);
    expect(await pay.pay(posted.id)).toBe(true);
    const afterSecond = await units(claimer);
    expect(beforeSecond).toBe(200);
    expect(afterSecond).toBe(beforeSecond);
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyPayOpId(posted.id) } })).toBe(1);
    expect(await stateOf(posted.id)).toBe('paid');
    const pendingSim = await new ChainOutboxRepository(db.prisma).doneMissingFlag('bounty-pay:', 'simPaid');
    expect(pendingSim.map((row) => row.opId)).toContain(bountyPayOpId(posted.id));
  });

  it('does not pay before a claim, rejects a second defend claimer, and rejects when W22 is off', async () => {
    const early = await postReward('w2223-poster-early.terraagent.mock', 'col_early_pay', 'bt_early_pay', 200);
    expect(await pay.pay(early.id)).toBe(false);
    expect(await units('w2223-claimer-early.terraagent.mock')).toBe(0);
    expect((await escrow.get({ escrowId: early.escrowId })).status).toBe('open');

    const defend = await postDefend('w2223-poster-def.terraagent.mock', 'col_def', 'bt_def');
    const first = 'w2223-claimer-def.terraagent.mock';
    const stranger = 'w2223-stranger-def.terraagent.mock';
    expect((await claims.claim({ planetId: PLANET, bountyId: defend.id, accountId: first })).state).toBe('claimed');
    await expect(claims.claim({ planetId: PLANET, bountyId: defend.id, accountId: stranger })).rejects.toMatchObject({ code: 'queue_full' });
    expect((await db.prisma.chainBounty.findUniqueOrThrow({ where: { id: defend.id } })).claimerAccountId).toBe(first);
    expect((await claims.claim({ planetId: PLANET, bountyId: defend.id, accountId: first })).claimerAccountId).toBe(first);

    const nest = await postReward('w2223-poster-nest.terraagent.mock', 'col_nest', 'bt_nest', 10);
    await claims.claim({ planetId: PLANET, bountyId: nest.id, accountId: 'w2223-nest-a.terraagent.mock' });
    await db.prisma.chainBounty.update({ where: { id: nest.id }, data: { target: { kind: 'clear_nest', nestId: '1' } } });
    const other = 'w2223-nest-b.terraagent.mock';
    expect((await claims.claim({ planetId: PLANET, bountyId: nest.id, accountId: other })).claimerAccountId).toBe(other);

    const off = await postReward('w2223-poster-off.terraagent.mock', 'col_off_pay', 'bt_off_pay', 10);
    waves.w22 = false;
    try {
      await expect(claims.claim({ planetId: PLANET, bountyId: off.id, accountId: 'w2223-off.terraagent.mock' })).rejects.toMatchObject({
        errorCode: 'NOT_FOUND',
        status: 404,
      });
      expect(await stateOf(off.id)).toBe('open');
      expect((await db.prisma.chainBounty.findUniqueOrThrow({ where: { id: off.id } })).claimerAccountId).toBeNull();
    } finally {
      waves.w22 = true;
    }
  });

  it('retries the same opId after an empty escrow and pays once', async () => {
    const claimer = 'w2223-claimer-empty.terraagent.mock';
    const posted = await postReward('w2223-poster-empty.terraagent.mock', 'col_empty', 'bt_empty', 200);
    await claims.claim({ planetId: PLANET, bountyId: posted.id, accountId: claimer });
    await markCompleted(posted.id);
    const hold = escrowHoldAccount(posted.escrowId);
    await setHold(hold, '0');
    await expect(pay.pay(posted.id)).rejects.toMatchObject({ errorCode: 'NEAR_INSUFFICIENT_BALANCE' });
    expect(await stateOf(posted.id)).toBe('completed');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyPayOpId(posted.id) } })).toBe(0);
    await setHold(hold, toCargoBaseUnits(200));
    expect(await pay.pay(posted.id)).toBe(true);
    expect(await units(claimer)).toBe(200);
    expect(await pay.pay(posted.id)).toBe(true);
    expect(await units(claimer)).toBe(200);
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyPayOpId(posted.id) } })).toBe(1);
    expect((await escrow.get({ escrowId: posted.escrowId })).status).toBe('claimed');
  });
});

async function postReward(poster: string, colonyId: string, bountyId: string, amount: number) {
  await fund(poster, amount, `w2223:fund:${bountyId}`);
  const now = Date.now();
  const input: BountyPostInput = {
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId: poster,
    bountyId,
    nowMs: now,
    args: {
      target: { kind: 'deliver_units', resource: 'bio.water', amount: 1 },
      reward: { resource: TOKEN, amount },
      expiresAt: now + 4 * HOUR_MS,
    },
  };
  return posts.post(input);
}

async function postDefend(poster: string, colonyId: string, bountyId: string) {
  await fund(poster, 20, `w2223:fund:${bountyId}`);
  const now = Date.now();
  return posts.post({
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId: poster,
    bountyId,
    nowMs: now,
    args: {
      target: { kind: 'defend_area', q: 0, r: 0, radius: 2, durationH: 2 },
      reward: { resource: TOKEN, amount: 5 },
      expiresAt: now + 4 * HOUR_MS,
    },
  });
}

async function markCompleted(id: string): Promise<void> {
  await db.prisma.chainBounty.update({ where: { id }, data: { state: 'completed' } });
}

async function fund(accountId: string, major: number, opId: string): Promise<void> {
  await cargo.mint({ opId, to: accountId, tokenId: TOKEN, amount: toCargoBaseUnits(major), caller: CARGO_MINTER_ACCOUNT });
}

async function units(accountId: string): Promise<number> {
  const row = await db.prisma.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId: TOKEN } } });
  const whole = (row?.amount.toFixed() ?? '0').split('.')[0] ?? '0';
  return Number(BigInt(whole) / 10n ** 18n);
}

async function setHold(accountId: string, amount: string): Promise<void> {
  await db.prisma.mockChainBalance.update({
    where: { accountId_tokenId: { accountId, tokenId: TOKEN } },
    data: { amount },
  });
}

async function stateOf(id: string): Promise<string> {
  return (await db.prisma.chainBounty.findUniqueOrThrow({ where: { id } })).state;
}
