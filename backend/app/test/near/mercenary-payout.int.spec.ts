import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createState, hexIndex, type PlanetState } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { escrowHoldAccount } from '../../src/near/application/escrow-id.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService } from '../../src/near/bounty/post.service.js';
import { HOUR_MS } from '../../src/near/bounty/validate.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { MercenaryHireService, type MercenaryHireInput } from '../../src/near/mercenary/hire.service.js';
import { MercenaryPayoutService } from '../../src/near/mercenary/payout.service.js';

const TOKEN = 'metals.t1';
const NOW = 1_700_000_000_000;
const PLANET = 'pl_w22_payout';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 30 });
const flags = { has: () => true };

let db: TestDatabase;
let hires: MercenaryHireService;
let payouts: MercenaryPayoutService;
let pay: BountyPayService;
let escrow: MockEscrowAdapter;
let world: PlanetState;

beforeAll(async () => {
  db = await createTestDatabase();
  world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-30', radius: 4 });
  const tile = hexIndex(world.grid.radius).indexOf(0, 0);
  if (tile < 0) throw new Error('origin tile missing');
  world.grid.layers.owner[tile] = 0;
  const cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  const repo = new BountyRepository(db.prisma);
  const outbox = new ChainOutboxRepository(db.prisma);
  const posts = new BountyPostService(escrow, cargo, repo, outbox, { load: async () => world }, flags);
  hires = new MercenaryHireService(posts, repo, escrow, outbox, flags);
  payouts = new MercenaryPayoutService(escrow, outbox, repo, flags);
  pay = new BountyPayService(escrow, outbox, repo, flags);
});

afterAll(async () => {
  await db?.drop();
});

describe('mercenary payout (W22-30)', () => {
  it('pays the mercenary 100 and refunds the poster 100 when the squad is wiped halfway', halfway);
  it('a second payout, and W22-23 pay, leaves those balances unchanged', twice);
  it('a wipe at the start refunds 200 and a full contract pays 200', bothEnds);
  it('claims the open remainder after cancel and does nothing when W22 is off', cancelThenOff);
});

async function halfway(): Promise<void> {
  const hired = await open('w2230-half.terraagent.mock', 'col_half', 'bt_pay_half');
  const mercBefore = await units(hired.mercenaryAccountId);
  const settled = await payouts.payout({ bountyId: hired.bountyId, nowMs: NOW + HOUR_MS, reason: 'wiped' });
  expect(settled).toMatchObject({ paid: 100, refunded: 100 });
  expect(await units(hired.mercenaryAccountId)).toBe(mercBefore + 100);
  expect(await units(hired.accountId)).toBe(100);
  await expectEmpty(hired.escrowId, 'claimed');
  expect(await stateOf(hired.bountyId)).toBe('paid');
}

async function twice(): Promise<void> {
  const hired = await open('w2230-twice.terraagent.mock', 'col_twice', 'bt_pay_twice');
  await payouts.payout({ bountyId: hired.bountyId, nowMs: NOW + HOUR_MS });
  const merc = await units(hired.mercenaryAccountId);
  const poster = await units(hired.accountId);
  const hold = await units(escrowHoldAccount(hired.escrowId));
  const again = await payouts.payout({ bountyId: hired.bountyId, nowMs: NOW + 2 * HOUR_MS });
  expect(again).toMatchObject({ paid: 100, refunded: 100 });
  expect(await pay.pay(hired.bountyId)).toBe(true);
  expect(await units(hired.mercenaryAccountId)).toBe(merc);
  expect(await units(hired.accountId)).toBe(poster);
  expect(await units(escrowHoldAccount(hired.escrowId))).toBe(hold);
  expect(hold).toBe(0);
  expect(poster).toBe(100);
}

async function bothEnds(): Promise<void> {
  const wiped = await open('w2230-start.terraagent.mock', 'col_start', 'bt_pay_start');
  const mercAtStart = await units(wiped.mercenaryAccountId);
  const atStart = await payouts.payout({ bountyId: wiped.bountyId, nowMs: NOW, reason: 'wiped' });
  expect(atStart).toMatchObject({ paid: 0, refunded: 200 });
  expect(await units(wiped.mercenaryAccountId)).toBe(mercAtStart);
  expect(await units(wiped.accountId)).toBe(200);
  await expectEmpty(wiped.escrowId, 'refunded');

  const done = await open('w2230-end.terraagent.mock', 'col_end', 'bt_pay_end');
  const mercAtEnd = await units(done.mercenaryAccountId);
  const atEnd = await payouts.payout({ bountyId: done.bountyId, nowMs: NOW + 2 * HOUR_MS, reason: 'ended' });
  expect(atEnd).toMatchObject({ paid: 200, refunded: 0 });
  expect(await units(done.mercenaryAccountId)).toBe(mercAtEnd + 200);
  expect(await units(done.accountId)).toBe(0);
  await expectEmpty(done.escrowId, 'claimed');
}

async function cancelThenOff(): Promise<void> {
  const hired = await open('w2230-cancel.terraagent.mock', 'col_cancel', 'bt_pay_cancel');
  const mercBefore = await units(hired.mercenaryAccountId);
  const cancelled = await hires.cancel({ bountyId: hired.bountyId, nowMs: NOW + HOUR_MS });
  expect(cancelled.refunded).toBe(100);
  expect(await units(hired.mercenaryAccountId)).toBe(mercBefore);
  expect(await units(hired.accountId)).toBe(100);
  const settled = await payouts.payout({ bountyId: hired.bountyId, nowMs: NOW });
  expect(settled).toMatchObject({ paid: 100, refunded: 100 });
  expect(await units(hired.mercenaryAccountId)).toBe(mercBefore + 100);
  expect(await units(hired.accountId)).toBe(100);
  await expectEmpty(hired.escrowId, 'claimed');

  const parked = await open('w2230-off.terraagent.mock', 'col_off', 'bt_pay_off');
  const off = new MercenaryPayoutService(escrow, new ChainOutboxRepository(db.prisma), new BountyRepository(db.prisma), {
    has: () => false,
  });
  const before = await units(parked.accountId);
  expect(await off.payout({ bountyId: parked.bountyId, nowMs: NOW + HOUR_MS, reason: 'wiped' })).toBeNull();
  expect(await units(parked.accountId)).toBe(before);
  expect(await units(escrowHoldAccount(parked.escrowId))).toBe(200);
  expect(await stateOf(parked.bountyId)).toBe('claimed');
}

async function open(accountId: string, colonyId: string, bountyId: string) {
  await fund(accountId);
  const hired = await hires.hire(input(accountId, colonyId, bountyId));
  expect(hired.total).toBe(200);
  expect(await units(accountId)).toBe(0);
  expect(await units(escrowHoldAccount(hired.escrowId))).toBe(200);
  return { ...hired, accountId };
}

async function expectEmpty(escrowId: string, status: string): Promise<void> {
  expect(await units(escrowHoldAccount(escrowId))).toBe(0);
  expect((await escrow.get({ escrowId })).status).toBe(status);
}

async function fund(accountId: string): Promise<void> {
  await new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }).mint({
    opId: `w2230:fund:${accountId}`,
    to: accountId,
    tokenId: TOKEN,
    amount: toCargoBaseUnits(200),
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

async function stateOf(id: string): Promise<string | undefined> {
  return (await db.prisma.chainBounty.findUnique({ where: { id } }))?.state;
}

function input(accountId: string, colonyId: string, bountyId: string): MercenaryHireInput {
  return {
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId,
    rosterId: 'light',
    hours: 2,
    q: 0,
    r: 0,
    bountyId,
    nowMs: NOW,
  };
}
