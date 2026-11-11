import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { compileData, createState, hexIndex, type PlanetState } from '@terra/sim';
import { openAwaySession } from '@terra/sim/systems/away/session';
import { applyAutopilot, readAwaySettings } from '@terra/sim/systems/away/store';
import { writePresence } from '@terra/sim/systems/presence/blob';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { AwayDigestService } from '../../src/game/digest/service.js';
import { PrismaDigestStore } from '../../src/game/digest/prisma-store.js';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyPostService } from '../../src/near/bounty/post.service.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter.js';
import { MercenaryAwayService, type AwayRaidEvent } from '../../src/near/mercenary/away.service.js';
import { MercenaryHireService } from '../../src/near/mercenary/hire.service.js';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service.js';
import { TreasuryAwayNoticeService } from '../../src/near/treasury/away-notice.service.js';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service.js';
import { TreasuryController } from '../../src/near/treasury/treasury.controller.js';
import { MockNotifierAdapter } from '../../src/notify/adapters/mock-notifier.adapter.js';

const TOKEN = 'metals.t1';
const LIGHT = 'merc-1.npc.terraagent.mock';
const LINE = 'Hired light squad for 100 metals.t1';
const sleep = async () => undefined;
const chainCfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 38 });

let db: TestDatabase;
let world: PlanetState;
let digests: AwayDigestService;
let aways: MercenaryAwayService;
let awaysNoW22: MercenaryAwayService;
let awaysNoW09: MercenaryAwayService;
let council: TreasuryController;
let noticeOn: TreasuryAwayNoticeService;
let noticeNoW22: TreasuryAwayNoticeService;
let noticeNoW09: TreasuryAwayNoticeService;

beforeAll(async () => {
  db = await createTestDatabase();
  world = flatWorld();
  const hires = hireService(db, world);
  digests = new AwayDigestService({ store: new PrismaDigestStore(db.prisma) });
  const bounties = new BountyRepository(db.prisma);
  const source = { load: async () => world };
  aways = new MercenaryAwayService(flag((wave) => wave === 'W22' || wave === 'W09' || wave === 'W00'), hires, bounties, source, db.prisma, digests);
  awaysNoW22 = new MercenaryAwayService(flag((wave) => wave === 'W09' || wave === 'W00'), hires, bounties, source, db.prisma, digests);
  awaysNoW09 = new MercenaryAwayService(flag((wave) => wave === 'W22' || wave === 'W00'), hires, bounties, source, db.prisma, digests);
  const on = councilFor(db, '..22');
  council = on.controller;
  noticeOn = on.notice;
  noticeNoW22 = councilFor(db, 'W09').notice;
  noticeNoW09 = councilFor(db, 'W22').notice;
});

afterAll(async () => {
  await db?.drop();
});

describe('W22-38 colony book away hire positive', () => {
  it('hires on a 0% metals session, keeps the digest line, and queues one council note', hiredAndNotified);
});

describe('W22-38 colony book away hire negative', () => {
  it('does not hire when the max spend is 50', maxTooLow);
  it('writes no hire and no council note when W22 or W09 is off', wavesOff);
});

describe('W22-38 colony book away hire corner', () => {
  it('does not hire again for a second raid while the squad is active', secondRaid);
});

async function hiredAndNotified(): Promise<void> {
  const planetId = 'pl-w2238-pos';
  const awayId = 'col_w2238_pos_away';
  const awayAccount = 'w2238-pos-away.pilot.terraagent.mock';
  const present = { colonyId: 'col_w2238_pos_here', accountId: 'w2238-pos-here.pilot.terraagent.mock', index: 1 };
  await prepare(planetId, awayId, awayAccount, true, 100);
  await seat(planetId, present.colonyId, present.accountId, present.index);
  await fundCouncil(planetId, [awayAccount, present.accountId]);
  expect(await aways.onRaid(raid(planetId, awayId))).toBe(true);
  expect(await bountyCount(awayId)).toBe(1);
  expect(await oneBounty(awayId)).toMatchObject({ state: 'claimed', claimerAccountId: LIGHT, reward: { resource: TOKEN, amount: 100 } });
  expect(await openLines(awayId)).toEqual([LINE]);
  expect(readAwaySettings(world, 0)?.session.spent.metals).toBe(0);
  expect(await units(awayAccount)).toBe(400);

  await council.propose(planetId, { kind: 'meteor_shield', colonyAccountId: present.accountId, description: 'shield' }, req());
  expect(await noticeOn.notifyDue(planetId)).toEqual({ notified: 1 });
  expect(await noticeOn.notifyDue(planetId)).toEqual({ notified: 1 });
  const queued = await notes(awayId);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ kind: 'council_proposal' });
  expect(noteBody(queued[0]?.payload)).toBe('Planet council: 1 open proposal');

  const delivered = await digests.deliverWelcome(awayId, new Date('2026-11-11T12:00:00.000Z'));
  expect(delivered?.ai.highlights.map((line) => line.summary)).toEqual([LINE]);
  expect(await notes(awayId)).toHaveLength(1);
}

async function maxTooLow(): Promise<void> {
  const planetId = 'pl-w2238-cap';
  const colonyId = 'col_w2238_cap';
  const accountId = 'w2238-cap.pilot.terraagent.mock';
  await prepare(planetId, colonyId, accountId, true, 50);
  expect(await aways.onRaid(raid(planetId, colonyId))).toBe(false);
  expect(await bountyCount(colonyId)).toBe(0);
  expect(await openLines(colonyId)).toEqual([]);
  expect(await units(accountId)).toBe(500);
}

async function secondRaid(): Promise<void> {
  const planetId = 'pl-w2238-two';
  const colonyId = 'col_w2238_two';
  const accountId = 'w2238-two.pilot.terraagent.mock';
  await prepare(planetId, colonyId, accountId, true, 100);
  expect(await aways.onRaid(raid(planetId, colonyId, 2))).toBe(true);
  expect(await aways.onRaid(raid(planetId, colonyId, 4))).toBe(false);
  expect(await bountyCount(colonyId)).toBe(1);
  expect(await openLines(colonyId)).toEqual([LINE]);
  expect(await units(accountId)).toBe(400);
}

async function wavesOff(): Promise<void> {
  const planetId = 'pl-w2238-off';
  const awayId = 'col_w2238_off_away';
  const awayAccount = 'w2238-off-away.pilot.terraagent.mock';
  const presentAccount = 'w2238-off-here.pilot.terraagent.mock';
  await prepare(planetId, awayId, awayAccount, true, 100);
  await seat(planetId, 'col_w2238_off_here', presentAccount, 1);
  await fundCouncil(planetId, [awayAccount, presentAccount]);
  await council.propose(planetId, { kind: 'guild_subsidy', colonyAccountId: presentAccount, description: 'subsidy' }, req());
  expect((await council.council(planetId)).proposals).toHaveLength(1);
  expect(await db.prisma.planetEventDigest.count({ where: { colonyId: awayId, closedAt: null } })).toBe(1);

  expect(await awaysNoW22.onRaid(raid(planetId, awayId))).toBe(false);
  expect(await awaysNoW09.onRaid(raid(planetId, awayId, 3))).toBe(false);
  expect(await bountyCount(awayId)).toBe(0);
  expect(await openLines(awayId)).toEqual([]);
  expect(await noticeNoW22.notifyDue(planetId)).toEqual({ notified: 0 });
  expect(await noticeNoW09.notifyDue(planetId)).toEqual({ notified: 0 });
  expect(await notes(awayId)).toHaveLength(0);
  expect(await units(awayAccount)).toBe(500);
}

function flatWorld(): PlanetState {
  const state = createState({ planetId: 'pl-w2238', planetType: 'temperate', seed: 'w22-38', radius: 4 });
  const tile = hexIndex(state.grid.radius).indexOf(0, 0);
  if (tile < 0) throw new Error('origin tile missing');
  state.grid.layers.owner[tile] = 0;
  return state;
}

function flag(has: (wave: string) => boolean): { has(wave: string): boolean } {
  return { has };
}

function hireService(database: TestDatabase, state: PlanetState): MercenaryHireService {
  const posts = new BountyPostService(
    new MockEscrowAdapter(database.prisma, chainCfg(), { sleep }),
    new MockCargoTokenAdapter(database.prisma, chainCfg(), { sleep }),
    new BountyRepository(database.prisma),
    new ChainOutboxRepository(database.prisma),
    { load: async () => state },
    { has: () => true },
  );
  return new MercenaryHireService(posts, new BountyRepository(database.prisma), new MockEscrowAdapter(database.prisma, chainCfg(), { sleep }), new ChainOutboxRepository(database.prisma), { has: () => true });
}

function councilFor(database: TestDatabase, waves: string): { controller: TreasuryController; notice: TreasuryAwayNoticeService } {
  const env = { NODE_ENV: 'test', DATABASE_URL: database.url, TA_WAVES: waves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(database.prisma, chainCfg(), { sleep });
  const outbox = new ChainOutboxRepository(database.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, database.prisma, env as never);
  const proposals = new TreasuryProposalsService(flags, lifecycle, dao, database.prisma, env as never, outbox);
  const notifier = new MockNotifierAdapter(database.prisma, { isConnected: () => false });
  return {
    controller: new TreasuryController(proposals, flags),
    notice: new TreasuryAwayNoticeService(flags, database.prisma, notifier, env as never),
  };
}

async function prepare(planetId: string, colonyId: string, accountId: string, on: boolean, maxSpend: number): Promise<void> {
  applyAutopilot(world, 0, {
    hireMercenaries: on,
    mercenaryMaxSpend: maxSpend,
    awayBudget: { metals: { perSessionPct: 0 } },
  }, compileData({ has: () => true }), 1);
  openAwaySession(world, 0, colonyId, { metals: 1000, minerals: 0, bio: 0 }, 2);
  writePresence(world, 0, true, 3);
  await seat(planetId, colonyId, accountId, 0);
  await fund(accountId);
  await digests.onPlanetEvent({
    planetId, tick: 1, kind: 'colonyAway', colonyIds: [colonyId], data: { colonyId, atTick: 1 },
  });
}

async function seat(planetId: string, colonyId: string, accountId: string, index: number): Promise<void> {
  const playerId = `player_${colonyId}`;
  await db.prisma.player.create({ data: { id: playerId, handle: playerId } });
  await db.prisma.planet.upsert({ where: { id: planetId }, create: { id: planetId, name: planetId }, update: {} });
  await db.prisma.colony.create({
    data: { id: colonyId, playerId, planetId, colonyIndex: index, name: colonyId },
  });
  await db.prisma.nearColonyAccount.create({
    data: {
      accountId, playerId, slot: colonyId, colonyId,
      ownerAccountId: 'pilot.terraagent.mock', publicKey: 'ed25519:test', encryptedSecret: 'cipher', kekVersion: 1,
    },
  });
}

async function fund(accountId: string): Promise<void> {
  await new MockCargoTokenAdapter(db.prisma, chainCfg(), { sleep }).mint({
    opId: `w2238:fund:${accountId}`, to: accountId, tokenId: TOKEN, amount: toCargoBaseUnits(500), caller: CARGO_MINTER_ACCOUNT,
  });
}

async function fundCouncil(planetId: string, members: readonly string[]): Promise<void> {
  const view = await council.council(planetId);
  const dao = new MockTreasuryDaoAdapter(db.prisma, chainCfg(), { sleep });
  await dao.deposit({ opId: `dep:${planetId}`, daoAccountId: view.daoAccountId, from: members[0] ?? 'funder.pilot.terraagent.mock', tokenId: TOKEN, amount: '5000' });
  for (const member of members) {
    await dao.addMember({ opId: `add:${planetId}:${member}`, daoAccountId: view.daoAccountId, member });
  }
}

function raid(planetId: string, colonyId: string, tick = 2): AwayRaidEvent {
  return {
    planetId, kind: 'raidStarted', colonyIds: [colonyId],
    data: { colonyId, colonyIndex: 0, species: 'blackAnt', q: 0, r: 0, count: 3, tick },
  };
}

function req(): IncomingMessage {
  return { headers: {} } as IncomingMessage;
}

function bountyCount(colonyId: string): Promise<number> {
  return db.prisma.chainBounty.count({ where: { posterColonyId: colonyId } });
}

async function oneBounty(colonyId: string): Promise<{ state: string; claimerAccountId: string | null; reward: unknown }> {
  const row = await db.prisma.chainBounty.findFirst({ where: { posterColonyId: colonyId } });
  if (!row) throw new Error('missing bounty');
  return row;
}

async function openLines(colonyId: string): Promise<string[]> {
  const row = await db.prisma.planetEventDigest.findFirst({ where: { colonyId, closedAt: null } });
  const body = row?.body as { ai?: { highlights?: { summary: string }[] } } | null;
  return body?.ai?.highlights?.map((line) => line.summary) ?? [];
}

function notes(colonyId: string): Promise<{ kind: string; payload: unknown }[]> {
  return db.prisma.mockNotify.findMany({ where: { colonyId }, orderBy: { id: 'asc' } });
}

function noteBody(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'body' in payload && typeof payload.body === 'string'
    ? payload.body
    : '';
}

async function units(accountId: string): Promise<number> {
  const row = await db.prisma.mockChainBalance.findUnique({ where: { accountId_tokenId: { accountId, tokenId: TOKEN } } });
  const whole = (row?.amount.toFixed() ?? '0').split('.')[0] ?? '0';
  return Number(BigInt(whole) / 10n ** 18n);
}
