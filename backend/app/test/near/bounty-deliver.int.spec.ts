import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyClaimService } from '../../src/near/bounty/claim.service.js';
import { BountyDeliverService } from '../../src/near/bounty/deliver.service.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { HOUR_MS } from '../../src/near/bounty/validate.js';
import type { PostedBounty } from '../../src/near/bounty/view.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';

const WATER = 'bio.water';
const REWARD = 'metals.t1';
const PLANET = 'pl_w22_deliver';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 22 });
const waves = { w22: true };

let db: TestDatabase;
let posts: BountyPostService;
let claims: BountyClaimService;
let deliver: BountyDeliverService;
let cargo: MockCargoTokenAdapter;
let escrow: MockEscrowAdapter;

beforeAll(async () => {
  db = await createTestDatabase();
  cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  const flags = { has: (wave: string) => wave === 'W22' && waves.w22 };
  const repo = new BountyRepository(db.prisma);
  const outbox = new ChainOutboxRepository(db.prisma);
  posts = new BountyPostService(
    escrow,
    cargo,
    repo,
    outbox,
    { load: async () => { throw new Error('deliver_units must not load a world'); } },
    { has: () => true },
  );
  claims = new BountyClaimService(repo, flags);
  deliver = new BountyDeliverService(db.prisma, new BountyPayService(escrow, outbox, repo, flags), flags);
  deliver.onModuleInit();
});

afterAll(async () => {
  deliver?.onModuleDestroy();
  await db?.drop();
});

describe('deliver_units tracking (W22-22)', () => {
  it('completes when the claimer transfers the full water amount', async () => {
    const poster = 'w2222-poster-full.terraagent.mock';
    const claimer = 'w2222-claimer-full.terraagent.mock';
    const posted = await postDeliver(poster, 'col_full', 'bt_full');
    await claim(posted.id, claimer);
    await giveWater(claimer, 100);
    await send(claimer, poster, 100, 'w2222:full');
    expect(await stateOf(posted.id)).toBe('paid');
    expect((await escrow.get({ escrowId: posted.escrowId })).status).toBe('claimed');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'bounty-pay:bt_full' } })).toBe(1);
  });

  it('stays open for 99 water, a wrong account, an unclaimed sender, and W22 off', async () => {
    const poster = 'w2222-poster-short.terraagent.mock';
    const claimer = 'w2222-claimer-short.terraagent.mock';
    const posted = await postDeliver(poster, 'col_short', 'bt_short');
    await claim(posted.id, claimer);
    await giveWater(claimer, 99);
    await send(claimer, poster, 99, 'w2222:short');
    expect(await stateOf(posted.id)).toBe('claimed');

    const other = 'w2222-poster-other.terraagent.mock';
    const claimerOther = 'w2222-claimer-other.terraagent.mock';
    const missed = await postDeliver(other, 'col_other', 'bt_other');
    await claim(missed.id, claimerOther);
    await giveWater(claimerOther, 100);
    await send(claimerOther, 'w2222-stranger.terraagent.mock', 100, 'w2222:wrong');
    expect(await stateOf(missed.id)).toBe('claimed');

    const earlyPoster = 'w2222-poster-early.terraagent.mock';
    const early = await postDeliver(earlyPoster, 'col_early', 'bt_early');
    await giveWater('w2222-claimer-early.terraagent.mock', 100);
    await send('w2222-claimer-early.terraagent.mock', earlyPoster, 100, 'w2222:early');
    expect(await stateOf(early.id)).toBe('open');

    const offPoster = 'w2222-poster-off.terraagent.mock';
    const offClaimer = 'w2222-claimer-off.terraagent.mock';
    const off = await postDeliver(offPoster, 'col_off', 'bt_off');
    await claim(off.id, offClaimer);
    await giveWater(offClaimer, 100);
    waves.w22 = false;
    try {
      await send(offClaimer, offPoster, 100, 'w2222:off');
      expect(await stateOf(off.id)).toBe('claimed');
    } finally {
      waves.w22 = true;
    }
  });

  it('adds 60 and 40, pays once, and ignores a transfer after expiry', async () => {
    const poster = 'w2222-poster-sum.terraagent.mock';
    const claimer = 'w2222-claimer-sum.terraagent.mock';
    const posted = await postDeliver(poster, 'col_sum', 'bt_sum');
    await claim(posted.id, claimer);
    await giveWater(claimer, 100);
    await send(claimer, poster, 60, 'w2222:sum60');
    expect(await stateOf(posted.id)).toBe('claimed');
    await send(claimer, poster, 40, 'w2222:sum40');
    expect(await stateOf(posted.id)).toBe('paid');

    const againPoster = 'w2222-poster-again.terraagent.mock';
    const againClaimer = 'w2222-claimer-again.terraagent.mock';
    const again = await postDeliver(againPoster, 'col_again', 'bt_again');
    await claim(again.id, againClaimer);
    await giveWater(againClaimer, 200);
    await send(againClaimer, againPoster, 100, 'w2222:again1');
    await send(againClaimer, againPoster, 100, 'w2222:again2');
    expect(await stateOf(again.id)).toBe('paid');
    expect(await db.prisma.mockChainReceipt.count({ where: { opId: 'bounty-pay:bt_again' } })).toBe(1);

    const latePoster = 'w2222-poster-late.terraagent.mock';
    const lateClaimer = 'w2222-claimer-late.terraagent.mock';
    const late = await postDeliver(latePoster, 'col_late', 'bt_late');
    await claim(late.id, lateClaimer);
    await db.prisma.chainBounty.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await giveWater(lateClaimer, 100);
    await send(lateClaimer, latePoster, 100, 'w2222:late');
    expect(await stateOf(late.id)).toBe('claimed');
  });
});

async function postDeliver(poster: string, colonyId: string, bountyId: string): Promise<PostedBounty> {
  await fund(poster, REWARD, 20, `w2222:reward:${bountyId}`);
  const now = Date.now();
  const input: BountyPostInput = {
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId: poster,
    bountyId,
    nowMs: now,
    args: {
      target: { kind: 'deliver_units', resource: WATER, amount: 100 },
      reward: { resource: REWARD, amount: 5 },
      expiresAt: now + 4 * HOUR_MS,
    },
  };
  return posts.post(input);
}

async function claim(id: string, claimerAccountId: string): Promise<void> {
  await claims.claim({ planetId: PLANET, bountyId: id, accountId: claimerAccountId });
}

async function giveWater(accountId: string, major: number): Promise<void> {
  await fund(accountId, WATER, major, `w2222:water:${accountId}`);
}

async function fund(accountId: string, tokenId: string, major: number, opId: string): Promise<void> {
  await cargo.mint({ opId, to: accountId, tokenId, amount: toCargoBaseUnits(major), caller: CARGO_MINTER_ACCOUNT });
}

async function send(from: string, to: string, major: number, opId: string): Promise<void> {
  await cargo.transfer({ opId, from, to, tokenId: WATER, amount: toCargoBaseUnits(major) });
}

async function stateOf(id: string): Promise<string> {
  const row = await db.prisma.chainBounty.findUniqueOrThrow({ where: { id } });
  return row.state;
}
