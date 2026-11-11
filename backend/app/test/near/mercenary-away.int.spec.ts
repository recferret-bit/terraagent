import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { compileData, createState, hexIndex, type PlanetState } from '@terra/sim';
import { openAwaySession } from '@terra/sim/systems/away/session';
import { applyAutopilot, readAwaySettings } from '@terra/sim/systems/away/store';
import { writePresence } from '@terra/sim/systems/presence/blob';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AwayDigestService } from '../../src/game/digest/service.js';
import { PrismaDigestStore } from '../../src/game/digest/prisma-store.js';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyPostService } from '../../src/near/bounty/post.service.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { MercenaryAwayService, type AwayRaidEvent } from '../../src/near/mercenary/away.service.js';
import { MercenaryHireService } from '../../src/near/mercenary/hire.service.js';

const TOKEN = 'metals.t1';
const PLANET = 'pl_w22_away';
const LIGHT = 'merc-1.npc.terraagent.mock';
const LINE = 'Hired light squad for 100 metals.t1';
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 31 });
const onFlags = { has: (wave: string) => wave === 'W22' || wave === 'W09' || wave === 'W00' };
const w09Off = { has: (wave: string) => wave === 'W22' || wave === 'W00' };

let db: TestDatabase;
let world: PlanetState;
let digests: AwayDigestService;
let aways: MercenaryAwayService;
let withoutW09: MercenaryAwayService;

beforeAll(async () => {
  db = await createTestDatabase();
  world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-31', radius: 4 });
  const tile = hexIndex(world.grid.radius).indexOf(0, 0);
  if (tile < 0) throw new Error('origin tile missing');
  world.grid.layers.owner[tile] = 0;
  const posts = new BountyPostService(
    new MockEscrowAdapter(db.prisma, cfg(), { sleep }),
    new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }),
    new BountyRepository(db.prisma),
    new ChainOutboxRepository(db.prisma),
    { load: async () => world },
    { has: () => true },
  );
  const hires = new MercenaryHireService(
    posts,
    new BountyRepository(db.prisma),
    new MockEscrowAdapter(db.prisma, cfg(), { sleep }),
    new ChainOutboxRepository(db.prisma),
    { has: () => true },
  );
  digests = new AwayDigestService({ store: new PrismaDigestStore(db.prisma) });
  const bounties = new BountyRepository(db.prisma);
  const worldSource = { load: async () => world };
  aways = new MercenaryAwayService(onFlags, hires, bounties, worldSource, db.prisma, digests);
  withoutW09 = new MercenaryAwayService(w09Off, hires, bounties, worldSource, db.prisma, digests);
});

afterAll(async () => {
  await db?.drop();
});

describe('W22-31 away mercenary hire positive', () => {
  it('hires one light squad and lists it on the open digest', hired);
});

describe('W22-31 away mercenary hire negative', () => {
  it('does not hire when the setting is off', settingOff);
  it('does not hire when the max spend is 50 and the light squad costs 100', maxTooLow);
});

describe('W22-31 away mercenary hire corner', () => {
  it('does not hire a second squad for a second raid while the first bounty is active', secondRaid);
  it('does not hire when W09 is off', waveOff);
});

async function hired(): Promise<void> {
  const colonyId = 'col_away_pos';
  const accountId = 'pos.pilot.terraagent.mock';
  await prepare(colonyId, accountId, true, 100);
  expect(await aways.onRaid(raid(colonyId))).toBe(true);
  const rows = await db.prisma.chainBounty.findMany({ where: { posterColonyId: colonyId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    state: 'claimed',
    claimerAccountId: LIGHT,
    reward: { resource: TOKEN, amount: 100 },
    target: { kind: 'defend_area', durationH: 1, q: 0, r: 0 },
  });
  expect(await highlights(colonyId)).toEqual([LINE]);
  expect(readAwaySettings(world, 0)?.session.spent.metals).toBe(0);
  expect(await units(accountId)).toBe(400);
}

async function settingOff(): Promise<void> {
  const colonyId = 'col_away_off';
  const accountId = 'off.pilot.terraagent.mock';
  await prepare(colonyId, accountId, false, 100);
  expect(await aways.onRaid(raid(colonyId))).toBe(false);
  expect(await db.prisma.chainBounty.count({ where: { posterColonyId: colonyId } })).toBe(0);
  expect(await highlights(colonyId)).toEqual([]);
  expect(await units(accountId)).toBe(500);
}

async function maxTooLow(): Promise<void> {
  const colonyId = 'col_away_cap';
  const accountId = 'cap.pilot.terraagent.mock';
  await prepare(colonyId, accountId, true, 50);
  expect(await aways.onRaid(raid(colonyId))).toBe(false);
  expect(await db.prisma.chainBounty.count({ where: { posterColonyId: colonyId } })).toBe(0);
  expect(await highlights(colonyId)).toEqual([]);
  expect(await units(accountId)).toBe(500);
}

async function secondRaid(): Promise<void> {
  const colonyId = 'col_away_two';
  const accountId = 'two.pilot.terraagent.mock';
  await prepare(colonyId, accountId, true, 100);
  expect(await aways.onRaid(raid(colonyId, 2))).toBe(true);
  expect(await aways.onRaid(raid(colonyId, 4))).toBe(false);
  expect(await db.prisma.chainBounty.count({ where: { posterColonyId: colonyId } })).toBe(1);
  expect(await highlights(colonyId)).toEqual([LINE]);
  expect(await units(accountId)).toBe(400);
}

async function waveOff(): Promise<void> {
  const colonyId = 'col_away_w09';
  const accountId = 'w09.pilot.terraagent.mock';
  await prepare(colonyId, accountId, true, 100);
  expect(await withoutW09.onRaid(raid(colonyId))).toBe(false);
  expect(await db.prisma.chainBounty.count({ where: { posterColonyId: colonyId } })).toBe(0);
  expect(await highlights(colonyId)).toEqual([]);
  expect(await units(accountId)).toBe(500);
}

async function prepare(colonyId: string, accountId: string, on: boolean, maxSpend: number): Promise<void> {
  mark(on, maxSpend);
  await seat(colonyId, accountId);
  await fund(accountId);
  await digests.onPlanetEvent({
    planetId: PLANET,
    tick: 1,
    kind: 'colonyAway',
    colonyIds: [colonyId],
    data: { colonyId, atTick: 1 },
  });
}

function mark(on: boolean, maxSpend: number): void {
  applyAutopilot(world, 0, {
    hireMercenaries: on,
    mercenaryMaxSpend: maxSpend,
    awayBudget: { metals: { perSessionPct: 0 } },
  }, compileData({ has: () => true }), 1);
  openAwaySession(world, 0, colonySession(on, maxSpend), { metals: 1000, minerals: 0, bio: 0 }, 2);
  writePresence(world, 0, true, 3);
}

function colonySession(on: boolean, maxSpend: number): string {
  return `col_session_${on ? 'on' : 'off'}_${maxSpend}`;
}

function raid(colonyId: string, tick = 2): AwayRaidEvent {
  return {
    planetId: PLANET,
    kind: 'raidStarted',
    colonyIds: [colonyId],
    data: { colonyId, colonyIndex: 0, species: 'blackAnt', q: 0, r: 0, count: 3, tick },
  };
}

async function seat(colonyId: string, accountId: string): Promise<void> {
  const playerId = `player_${colonyId}`;
  await db.prisma.player.create({ data: { id: playerId, handle: playerId } });
  await db.prisma.nearColonyAccount.create({
    data: {
      accountId,
      playerId,
      slot: colonyId,
      colonyId,
      ownerAccountId: 'pilot.terraagent.mock',
      publicKey: 'ed25519:test',
      encryptedSecret: 'cipher',
      kekVersion: 1,
    },
  });
}

async function fund(accountId: string): Promise<void> {
  await new MockCargoTokenAdapter(db.prisma, cfg(), { sleep }).mint({
    opId: `w2231:fund:${accountId}`,
    to: accountId,
    tokenId: TOKEN,
    amount: toCargoBaseUnits(500),
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

async function highlights(colonyId: string): Promise<string[]> {
  const row = await db.prisma.planetEventDigest.findFirst({ where: { colonyId, closedAt: null } });
  const body = row?.body as { ai?: { highlights?: { summary: string }[] } } | null;
  return body?.ai?.highlights?.map((line) => line.summary) ?? [];
}
