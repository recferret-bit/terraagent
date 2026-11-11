import { parseCommandArgs } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createState, hexIndex, type PlanetState } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { escrowHoldAccount } from '../../src/near/application/escrow-id.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyPostService } from '../../src/near/bounty/post.service.js';
import { HOUR_MS } from '../../src/near/bounty/validate.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { MercenaryHireService, type MercenaryHireInput } from '../../src/near/mercenary/hire.service.js';
import { mercenaryRoster } from '../../src/near/mercenary/roster.js';
import { contractEndTick } from '../../src/near/mercenary/spawn-order.js';

const TOKEN = 'metals.t1';
const NOW = 1_700_000_000_000;
const PLANET = 'pl_w22_hire';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 28 });
const flags = { has: () => true };

let db: TestDatabase;
let hires: MercenaryHireService;
let escrow: MockEscrowAdapter;
let world: PlanetState;

beforeAll(async () => {
  db = await createTestDatabase();
  world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-28', radius: 4 });
  const tile = hexIndex(world.grid.radius).indexOf(0, 0);
  if (tile < 0) throw new Error('origin tile missing');
  world.grid.layers.owner[tile] = 0;
  const cargo = new MockCargoTokenAdapter(db.prisma, cfg(), { sleep });
  escrow = new MockEscrowAdapter(db.prisma, cfg(), { sleep });
  const posts = new BountyPostService(
    escrow,
    cargo,
    new BountyRepository(db.prisma),
    new ChainOutboxRepository(db.prisma),
    { load: async () => world },
    flags,
  );
  hires = new MercenaryHireService(posts, new BountyRepository(db.prisma), escrow, new ChainOutboxRepository(db.prisma), flags);
});

afterAll(async () => {
  await db?.drop();
});

describe('mercenary hire (W22-28)', () => {
  it('hires a light squad for 2 h at 200 and refunds 100 after 1 h, not to the mercenary', halfRefund);
  it('does not open escrow when the hire exceeds the poster cargo', poorCargo);
  it('refunds the full escrow at once and nothing once the contract has ended', bothEnds);
  it('rejects a hire when W22 is off and writes no escrow', waveOff);
});

async function halfRefund(): Promise<void> {
  const light = mercenaryRoster(flags).find((row) => row.id === 'light');
  expect(light?.pricePerGameHour[TOKEN]).toBe(100);
  const poster = await fund('w2228-half.terraagent.mock', 500);
  const hired = await hires.hire(input(poster.accountId, 'col_half', 'bt_half', 2));
  await expectOpened(hired, light?.count ?? 0, poster.accountId);
  const cancelled = await hires.cancel({ bountyId: hired.bountyId, nowMs: NOW + HOUR_MS });
  expect(cancelled.refunded).toBe(100);
  expect(cancelled.paid).toBe(100);
  expect(await units(poster.accountId)).toBe(400);
  expect(await units(hired.mercenaryAccountId)).toBe(0);
  expect(await units(escrowHoldAccount(hired.escrowId))).toBe(100);
  const left = await escrow.get({ escrowId: hired.escrowId });
  expect(left.status).toBe('open');
  expect(left.amount).toBe(toCargoBaseUnits(100));
  expect((await db.prisma.chainBounty.findUnique({ where: { id: hired.bountyId } }))?.state).toBe('refunded');
  const again = await hires.cancel({ bountyId: hired.bountyId, nowMs: NOW + HOUR_MS });
  expect(again.refunded).toBe(100);
  expect(await units(poster.accountId)).toBe(400);
  expect(await units(hired.mercenaryAccountId)).toBe(0);
}

async function expectOpened(
  hired: Awaited<ReturnType<MercenaryHireService['hire']>>,
  count: number,
  poster: string,
): Promise<void> {
  expect(hired.total).toBe(200);
  expect(hired.mercenaryAccountId).toBe('merc-1.npc.terraagent.mock');
  expect(hired.claimerAccountId).toBe(hired.mercenaryAccountId);
  expect(hired.spawn).toMatchObject({ kind: 'mercenary.spawn', source: 'system', colonyIndex: 0 });
  expect(parseCommandArgs(hired.spawn.kind, hired.spawn.args).success).toBe(true);
  expect(hired.spawn.args).toMatchObject({
    count,
    rosterId: 'light',
    bountyId: 'bt_half',
    endTick: contractEndTick(0, 2),
    q: 0,
    r: 0,
    radius: 1,
  });
  expect(await units(poster)).toBe(300);
  expect(await units(hired.mercenaryAccountId)).toBe(0);
  const opened = await escrow.get({ escrowId: hired.escrowId });
  expect(opened.status).toBe('open');
  expect(opened.beneficiary).toBe(escrowHoldAccount(hired.escrowId));
  expect(opened.amount).toBe(toCargoBaseUnits(200));
  const row = await db.prisma.chainBounty.findUnique({ where: { id: hired.bountyId } });
  expect(row?.state).toBe('claimed');
  expect(row?.claimerAccountId).toBe(hired.mercenaryAccountId);
}

async function poorCargo(): Promise<void> {
  const poster = await fund('w2228-poor.terraagent.mock', 50);
  const before = await db.prisma.mockChainEscrow.count();
  await expect(hires.hire(input(poster.accountId, 'col_poor', 'bt_poor', 2))).rejects.toMatchObject({
    code: 'insufficient_cargo',
  });
  expect(await units(poster.accountId)).toBe(50);
  expect(await db.prisma.mockChainEscrow.count()).toBe(before);
  expect(await db.prisma.chainBounty.count({ where: { id: 'bt_poor' } })).toBe(0);
  expect(await db.prisma.mockChainEscrow.count({ where: { opener: poster.accountId } })).toBe(0);
}

async function bothEnds(): Promise<void> {
  const immediate = await fund('w2228-now.terraagent.mock', 200);
  const hiredNow = await hires.hire(input(immediate.accountId, 'col_now', 'bt_now', 2));
  const back = await hires.cancel({ bountyId: hiredNow.bountyId, nowMs: NOW });
  expect(back.refunded).toBe(200);
  expect(back.paid).toBe(0);
  expect(await units(immediate.accountId)).toBe(200);
  expect(await units(hiredNow.mercenaryAccountId)).toBe(0);
  expect(await units(escrowHoldAccount(hiredNow.escrowId))).toBe(0);
  expect((await escrow.get({ escrowId: hiredNow.escrowId })).status).toBe('refunded');

  const ended = await fund('w2228-end.terraagent.mock', 200);
  const hiredEnd = await hires.hire(input(ended.accountId, 'col_end', 'bt_end', 2));
  const none = await hires.cancel({ bountyId: hiredEnd.bountyId, nowMs: NOW + 2 * HOUR_MS });
  expect(none.refunded).toBe(0);
  expect(none.paid).toBe(200);
  expect(await units(ended.accountId)).toBe(0);
  expect(await units(hiredEnd.mercenaryAccountId)).toBe(0);
  expect(await units(escrowHoldAccount(hiredEnd.escrowId))).toBe(200);
  const view = await escrow.get({ escrowId: hiredEnd.escrowId });
  expect(view.status).toBe('open');
  expect(view.amount).toBe(toCargoBaseUnits(200));
}

async function waveOff(): Promise<void> {
  const off = new MercenaryHireService(
    unusedPosts(),
    new BountyRepository(db.prisma),
    escrow,
    new ChainOutboxRepository(db.prisma),
    { has: () => false },
  );
  const before = await db.prisma.mockChainEscrow.count();
  await expect(off.hire(input('w2228-off.terraagent.mock', 'col_off', 'bt_off', 2))).rejects.toMatchObject({
    errorCode: 'NOT_FOUND',
    status: 404,
  });
  expect(await db.prisma.mockChainEscrow.count()).toBe(before);
  expect(await db.prisma.chainBounty.count({ where: { id: 'bt_off' } })).toBe(0);
}

function unusedPosts(): BountyPostService {
  return new BountyPostService(
    escrow,
    new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }),
    new BountyRepository(db.prisma),
    new ChainOutboxRepository(db.prisma),
    { load: async () => world },
    { has: () => false },
  );
}

async function fund(accountId: string, major: number): Promise<{ accountId: string }> {
  await new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }).mint({
    opId: `w2228:fund:${accountId}`,
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

function input(accountId: string, colonyId: string, bountyId: string, hours: number): MercenaryHireInput {
  return {
    planetId: PLANET,
    colonyId,
    colonyIndex: 0,
    accountId,
    rosterId: 'light',
    hours,
    q: 0,
    r: 0,
    bountyId,
    nowMs: NOW,
  };
}
