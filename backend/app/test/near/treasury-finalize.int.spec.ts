import 'reflect-metadata';
import type { SimCommandV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import type { PlanetEventV1 } from '../../src/bus/channels';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { effectUntilTick } from '../../src/near/treasury/finalize-effect';
import { TreasuryFinalizeService } from '../../src/near/treasury/finalize.service';
import { GuildSubsidyService } from '../../src/near/treasury/guild-subsidy';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';
import { TreasuryController } from '../../src/near/treasury/treasury.controller';

const A = 'col-a.pilot.terraagent.mock';
const B = 'col-b.pilot.terraagent.mock';
const C = 'col-c.pilot.terraagent.mock';
const TOKEN = 'metals.t1';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => { await db?.drop(); });

interface Posted {
  readonly planetId: string;
  readonly cmd: SimCommandV1;
}

interface Harness {
  readonly controller: TreasuryController;
  readonly finalize: TreasuryFinalizeService;
  readonly pushes: { payload: { state: string } }[];
  readonly events: PlanetEventV1[];
  readonly posted: Posted[];
}

function harness(taWaves: string): Harness {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 9 }, { sleep: async () => undefined });
  const outbox = new ChainOutboxRepository(db.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, env as never);
  const bus = new EventBus();
  const pushes: Harness['pushes'] = [];
  const events: PlanetEventV1[] = [];
  const posted: Posted[] = [];
  bus.on('near.treasury.proposal', (event) => { pushes.push(event); }, { module: 'test' });
  bus.on('planet.event', (event) => { events.push(event); }, { module: 'test' });
  const proposals = new TreasuryProposalsService(flags, lifecycle, dao, db.prisma, env as never, outbox, bus);
  const sim = { submit: async (planetId: string, cmd: SimCommandV1) => { posted.push({ planetId, cmd }); return { ok: true as const }; } };
  const finalize = new TreasuryFinalizeService(flags, dao, db.prisma, new GuildSubsidyService(db.prisma, flags), bus, outbox, sim);
  return { controller: new TreasuryController(proposals, flags), finalize, pushes, events, posted };
}

function req(): IncomingMessage {
  return { headers: {} } as IncomingMessage;
}

async function openCouncil(h: Harness, planetId: string, amount: string): Promise<void> {
  const council = await h.controller.council(planetId);
  const dao = new MockTreasuryDaoAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 9 }, { sleep: async () => undefined });
  await dao.deposit({ opId: `dep:${planetId}:${amount}`, daoAccountId: council.daoAccountId, from: A, tokenId: TOKEN, amount });
  for (const member of [A, B, C]) {
    await dao.addMember({ opId: `add:${planetId}:${member}`, daoAccountId: council.daoAccountId, member });
  }
}

function balance(h: Harness, planetId: string): Promise<string> {
  return h.controller.council(planetId).then((council) => council.balance[TOKEN] ?? '0');
}

async function propose(h: Harness, planetId: string, kind: string): Promise<{ proposalId: number; deadlineMs: number }> {
  return h.controller.propose(planetId, { kind, colonyAccountId: A, description: kind }, req());
}

function vote(h: Harness, planetId: string, id: number, accountId: string): Promise<{ state: string }> {
  return h.controller.vote(planetId, String(id), { vote: 'approve', colonyAccountId: accountId }, req());
}

describe('W22-09 treasury finalize positive', () => {
  it('approves 2 yes of 3 before the deadline and posts the effect once', async () => {
    const h = harness('..22');
    const planetId = 'pl-fin-pass';
    await openCouncil(h, planetId, '2000');
    const opened = await propose(h, planetId, 'meteor_shield');
    await vote(h, planetId, opened.proposalId, A);
    const passed = await vote(h, planetId, opened.proposalId, B);
    expect(passed.state).toBe('Approved');
    expect(Date.now()).toBeLessThan(opened.deadlineMs);
    expect(await balance(h, planetId)).toBe('500');
    const first = await h.finalize.finalizeDue(Date.now(), planetId);
    const again = await h.finalize.finalizeDue(Date.now(), planetId);
    expect(first).toMatchObject({ effects: 1, expired: 0 });
    expect(again.effects).toBe(0);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]).toMatchObject({
      planetId,
      cmd: {
        source: 'system',
        kind: 'system.treasuryEffect',
        colonyIndex: null,
        args: { kind: 'meteor_shield', untilTick: effectUntilTick(0, 6), params: { magnitudeBp: 7500 } },
      },
    });
    expect(h.events.filter((event) => event.kind === 'treasuryProposalPassed')).toHaveLength(1);
    expect(await balance(h, planetId)).toBe('500');
    expect(await db.prisma.chainGuildVisit.count({ where: { planetId } })).toBe(0);
  });
});

describe('W22-09 treasury finalize negative', () => {
  it('expires 1 yes of 3 past the deadline and does not move funds', async () => {
    const h = harness('..22');
    const planetId = 'pl-fin-expire';
    await openCouncil(h, planetId, '2000');
    const opened = await propose(h, planetId, 'meteor_shield');
    await vote(h, planetId, opened.proposalId, A);
    const before = await balance(h, planetId);
    expect(before).toBe('2000');
    const result = await h.finalize.finalizeDue(opened.deadlineMs + 1, planetId);
    const council = await h.controller.council(planetId);
    expect(result).toMatchObject({ expired: 1, effects: 0 });
    expect(council.proposals[0]).toMatchObject({ state: 'Expired', yes: 1, no: 0 });
    expect(council.balance[TOKEN]).toBe(before);
    expect(h.posted).toHaveLength(0);
    expect(h.events.filter((event) => event.kind === 'treasuryProposalFailed')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ reason: 'expired', kind: 'meteor_shield' }) }),
    ]);
    expect(h.pushes.at(-1)?.payload.state).toBe('Expired');
    const outbox = await db.prisma.chainOutbox.findUnique({ where: { opId: `dao-finalize:${council.daoAccountId}:0` } });
    expect(outbox?.status).toBe('DONE');
  });
});

describe('W22-09 treasury finalize corner', () => {
  it('does not expire a 1-yes proposal before the deadline', async () => {
    const h = harness('..22');
    const planetId = 'pl-fin-early';
    await openCouncil(h, planetId, '2000');
    const opened = await propose(h, planetId, 'terraform_boost');
    await vote(h, planetId, opened.proposalId, A);
    const result = await h.finalize.finalizeDue(opened.deadlineMs - 1, planetId);
    expect(result).toEqual({ expired: 0, approved: 0, effects: 0 });
    expect((await h.controller.council(planetId)).proposals[0]?.state).toBe('InProgress');
    expect(await balance(h, planetId)).toBe('2000');
    expect(h.posted).toHaveLength(0);
  });

  it('posts guild_subsidy once when finalizeDue runs twice', async () => {
    const h = harness('..22');
    const planetId = 'pl-fin-twice';
    await openCouncil(h, planetId, '2000');
    const opened = await propose(h, planetId, 'guild_subsidy');
    await vote(h, planetId, opened.proposalId, A);
    expect((await vote(h, planetId, opened.proposalId, B)).state).toBe('Approved');
    const now = Date.now();
    await h.finalize.finalizeDue(now, planetId);
    await h.finalize.finalizeDue(now, planetId);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]?.cmd.args).toMatchObject({ kind: 'guild_subsidy', params: { visits: 1 } });
    expect(h.events.filter((event) => event.kind === 'treasuryProposalPassed')).toHaveLength(1);
    expect(await db.prisma.chainGuildVisit.count({ where: { planetId } })).toBe(1);
    expect(await balance(h, planetId)).toBe('1200');
  });

  it('does nothing when W22 is off', async () => {
    const on = harness('..22');
    const planetId = 'pl-fin-off';
    await openCouncil(on, planetId, '2000');
    const opened = await propose(on, planetId, 'meteor_shield');
    await vote(on, planetId, opened.proposalId, A);
    const off = harness('..21');
    const result = await off.finalize.finalizeDue(opened.deadlineMs + 1, planetId);
    expect(result).toEqual({ expired: 0, approved: 0, effects: 0 });
    expect((await on.controller.council(planetId)).proposals[0]?.state).toBe('InProgress');
    expect(await balance(on, planetId)).toBe('2000');
    expect(off.posted).toHaveLength(0);
  });
});
