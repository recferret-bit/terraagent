import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createState, hexIndex, setTileOwner } from '@terra/sim';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyClaimService } from '../../src/near/bounty/claim.service.js';
import { BountyExpiryService } from '../../src/near/bounty/expiry.service.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { bountyRefundOpId, HOUR_MS } from '../../src/near/bounty/validate.js';
import { toBountyView } from '../../src/near/bounty/view.js';
import { escrowHoldAccount } from '../../src/near/infrastructure/adapters/mock/escrow-id.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';

const TOKEN = 'metals.t1';
const PLANET = 'pl_w22_expiry';
const REWARD = 200;
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 24 });
const waves = { w22: true };

let db: TestDatabase;
let posts: BountyPostService;
let claims: BountyClaimService;
let pay: BountyPayService;
let job: BountyExpiryService;
let cargo: MockCargoTokenAdapter;
let escrow: MockEscrowAdapter;

beforeAll(async () => {
  db = await createTestDatabase();
  const world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-24', radius: 4 });
  setTileOwner(world.grid, hexIndex(world.grid.radius).indexOf(0, 0), 0, world.meta.tick);
  cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  const flags = { has: (wave: string) => wave === 'W22' && waves.w22 };
  const repo = new BountyRepository(db.prisma);
  const outbox = new ChainOutboxRepository(db.prisma);
  posts = new BountyPostService(escrow, cargo, repo, outbox, { load: async () => world }, { has: () => true });
  claims = new BountyClaimService(repo, flags);
  pay = new BountyPayService(escrow, outbox, repo, flags);
  job = new BountyExpiryService(escrow, outbox, repo, flags);
  await db.prisma.player.create({ data: { id: 'pr_w2224', handle: 'w2224' } });
  await db.prisma.planet.create({ data: { id: PLANET, name: 'Expiry' } });
});

afterAll(async () => {
  await db?.drop();
});

describe('bounty expiry refund (W22-24)', () => {
  it('refunds an expired bounty once and the board reads Expired', async () => {
    const poster = 'w2224-poster.terraagent.mock';
    const posted = await postReward(poster, 'col_due', 'bt_due', REWARD);
    const at = posted.expiresAt + 1;
    expect(await job.refundDue(at)).toEqual({ refunded: 1 });
    expect(await stateOf(posted.id)).toBe('refunded');
    expect(await units(poster)).toBe(REWARD);
    expect((await escrow.get({ escrowId: posted.escrowId })).status).toBe('refunded');
    expect(await units(escrowHoldAccount(posted.escrowId))).toBe(0);
    const row = await db.prisma.chainBounty.findUniqueOrThrow({ where: { id: posted.id } });
    expect(toBountyView(row, at).board).toBe('Expired');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyRefundOpId(posted.id) } })).toBe(1);

    const beforeSecond = await units(poster);
    expect(await job.refundDue(at + HOUR_MS)).toEqual({ refunded: 0 });
    const afterSecond = await units(poster);
    expect(beforeSecond).toBe(REWARD);
    expect(afterSecond).toBe(beforeSecond);
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyRefundOpId(posted.id) } })).toBe(1);
  });

  it('leaves a bounty that is not yet expired open, and does nothing when W22 is off', async () => {
    const poster = 'w2224-early.terraagent.mock';
    const posted = await postReward(poster, 'col_early', 'bt_early', REWARD);
    const held = await escrow.get({ escrowId: posted.escrowId });
    expect(held.expiresAtMs).toBe(0);
    expect(held.status).toBe('open');
    expect(await job.refundDue(posted.expiresAt - 1)).toEqual({ refunded: 0 });
    expect(await stateOf(posted.id)).toBe('open');
    expect(await units(poster)).toBe(0);
    expect(await units(escrowHoldAccount(posted.escrowId))).toBe(REWARD);

    const offPoster = 'w2224-off.terraagent.mock';
    const off = await postReward(offPoster, 'col_off', 'bt_off', REWARD, Date.now() - 6 * HOUR_MS);
    waves.w22 = false;
    try {
      expect(await job.refundDue(Date.now())).toEqual({ refunded: 0 });
      expect(await stateOf(off.id)).toBe('open');
      expect(await units(offPoster)).toBe(0);
      expect((await escrow.get({ escrowId: off.escrowId })).status).toBe('open');
    } finally {
      waves.w22 = true;
    }
  });

  it('refunds an eliminated poster on the colony account and does not refund a paid bounty', async () => {
    const poster = 'w2224-elim.terraagent.mock';
    const colonyId = 'col_elim';
    await db.prisma.colony.create({
      data: {
        id: colonyId,
        playerId: 'pr_w2224',
        planetId: PLANET,
        colonyIndex: 1,
        name: 'Gone',
        status: 'ELIMINATED',
      },
    });
    await db.prisma.nearColonyAccount.create({
      data: {
        accountId: poster,
        playerId: 'pr_w2224',
        slot: colonyId,
        colonyId,
        ownerAccountId: 'pilot.terraagent.mock',
        publicKey: 'ed25519:test',
        encryptedSecret: 'cipher',
        kekVersion: 1,
      },
    });
    const posted = await postReward(poster, colonyId, 'bt_elim', REWARD);
    await job.refundDue(posted.expiresAt + 1);
    expect(await units(poster)).toBe(REWARD);
    expect(await stateOf(posted.id)).toBe('refunded');
    expect((await db.prisma.colony.findUniqueOrThrow({ where: { id: colonyId } })).status).toBe('ELIMINATED');
    expect((await db.prisma.nearColonyAccount.findUnique({ where: { accountId: poster } }))?.accountId).toBe(poster);

    const paidPoster = 'w2224-paid.terraagent.mock';
    const claimer = 'w2224-claimer.terraagent.mock';
    const paid = await postReward(paidPoster, 'col_paid', 'bt_paid', REWARD);
    await claims.claim({ planetId: PLANET, bountyId: paid.id, accountId: claimer });
    await db.prisma.chainBounty.update({ where: { id: paid.id }, data: { state: 'completed' } });
    expect(await pay.pay(paid.id)).toBe(true);
    expect(await units(paidPoster)).toBe(0);
    expect(await units(claimer)).toBe(REWARD);
    expect(await job.refundDue(paid.expiresAt + 1)).toEqual({ refunded: 0 });
    expect(await stateOf(paid.id)).toBe('paid');
    expect(await units(paidPoster)).toBe(0);
    expect(await units(claimer)).toBe(REWARD);
    expect((await escrow.get({ escrowId: paid.escrowId })).status).toBe('claimed');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: bountyRefundOpId(paid.id) } })).toBe(0);
  });
});

async function postReward(poster: string, colonyId: string, bountyId: string, amount: number, now = Date.now()) {
  await fund(poster, amount, `w2224:fund:${bountyId}`);
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

async function fund(accountId: string, major: number, opId: string): Promise<void> {
  await cargo.mint({
    opId,
    to: accountId,
    tokenId: TOKEN,
    amount: toCargoBaseUnits(major),
    caller: CARGO_MINTER_ACCOUNT,
  });
}

async function units(accountId: string): Promise<number> {
  const row = await db.prisma.mockChainBalance.findUnique({
    where: { accountId_tokenId: { accountId, tokenId: TOKEN } },
  });
  const whole = (row?.amount.toFixed() ?? '0').split('.')[0] ?? '0';
  return Number(BigInt(whole) / 10n ** 18n);
}

async function stateOf(id: string): Promise<string> {
  return (await db.prisma.chainBounty.findUniqueOrThrow({ where: { id } })).state;
}
