import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { daoAccountIdFor } from '../../src/near/treasury/policy';
import type { NearTreasuryProposalBusEvent } from '../../src/near/treasury/proposal-push';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';
import { TreasuryController } from '../../src/near/treasury/treasury.controller';
import { devPlayerId } from '../../src/ws/session-verifier';

const A = 'col-a.pilot.terraagent.mock';
const B = 'col-b.pilot.terraagent.mock';
const C = 'col-c.pilot.terraagent.mock';
const OUT = 'outsider.pilot.terraagent.mock';
const TOKEN = 'metals.t1';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => { await db?.drop(); });

interface Harness {
  readonly dao: MockTreasuryDaoAdapter;
  readonly controller: TreasuryController;
  readonly pushes: NearTreasuryProposalBusEvent[];
}

function harness(taWaves: string, nodeEnv = 'test'): Harness {
  const env = { NODE_ENV: nodeEnv, DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 8 },
    { sleep: async () => undefined },
  );
  const outbox = new ChainOutboxRepository(db.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, env as never);
  const bus = new EventBus();
  const pushes: NearTreasuryProposalBusEvent[] = [];
  bus.on('near.treasury.proposal', (ev) => { pushes.push(ev); }, { module: 'test' });
  const proposals = new TreasuryProposalsService(flags, lifecycle, dao, db.prisma, env as never, outbox, bus);
  return { dao, controller: new TreasuryController(proposals, flags), pushes };
}

function req(headerAccount?: string, authorization?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (headerAccount) headers['x-colony-account-id'] = headerAccount;
  if (authorization) headers.authorization = authorization;
  return { headers } as IncomingMessage;
}

function proposeBody(kind: string, accountId?: string, description?: string): Record<string, string> {
  return { kind, ...(description ? { description } : {}), ...(accountId ? { colonyAccountId: accountId } : {}) };
}

async function fund(h: Harness, planetId: string, amount: string, from: string): Promise<string> {
  const council = await h.controller.council(planetId);
  await h.dao.deposit({
    opId: `dep:${planetId}:${amount}:${from}`,
    daoAccountId: council.daoAccountId,
    from,
    tokenId: TOKEN,
    amount,
  });
  return council.daoAccountId;
}

async function seat(h: Harness, daoAccountId: string, members: readonly string[]): Promise<void> {
  for (const member of members) {
    await h.dao.addMember({ opId: `add:${daoAccountId}:${member}`, daoAccountId, member });
  }
}

function proposalCount(daoId: string): Promise<number> {
  return db.prisma.mockChainDaoProposal.count({ where: { daoId } });
}

describe('W22-08 treasury proposals API positive', () => {
  it('proposes meteor_shield when 2000 covers the cost and two yes votes pass it', async () => {
    const h = harness('..22');
    const planetId = 'pl-rich';
    const daoId = await fund(h, planetId, '2000', A);
    await seat(h, daoId, [A, B, C]);
    const opened = await h.controller.propose(planetId, proposeBody('meteor_shield', A, 'Meteor shield'), req());
    expect(opened).toMatchObject({ kind: 'meteor_shield', state: 'InProgress', cost: '1500', yes: 0, proposer: A });
    expect(opened.deadlineMs).toBeGreaterThan(Date.now());
    const yesA = await h.controller.vote(planetId, String(opened.proposalId), { vote: 'approve', colonyAccountId: A }, req());
    expect(yesA).toMatchObject({ state: 'InProgress', yes: 1, no: 0 });
    const yesB = await h.controller.vote(planetId, String(opened.proposalId), { vote: 'approve' }, req(B));
    expect(yesB).toMatchObject({ state: 'Approved', yes: 2, no: 0, cost: '1500' });
    const council = await h.controller.council(planetId);
    expect(council.effects).toEqual([]);
    expect(council.members).toHaveLength(3);
    expect(council.balance[TOKEN]).toBe('500');
    expect(council.proposals).toHaveLength(1);
    expect(council.projects).toEqual([
      { kind: 'meteor_shield', cost: '1500', durationH: 6, magnitudeBp: 7500, visits: 0 },
      { kind: 'terraform_boost', cost: '1000', durationH: 12, magnitudeBp: 2500, visits: 0 },
      { kind: 'guild_subsidy', cost: '800', durationH: 0, magnitudeBp: 0, visits: 1 },
    ]);
    expect(h.pushes.map((event) => event.payload.state)).toEqual(['InProgress', 'InProgress', 'Approved']);
    expect(h.pushes.at(-1)?.payload).toMatchObject({ kind: 'meteor_shield', cost: '1500', members: 3, yes: 2 });
    const outbox = await db.prisma.chainOutbox.findUnique({ where: { opId: `dao-propose:${planetId}:${A}:1` } });
    expect(outbox?.status).toBe('DONE');
  });

  it('proposes as the session colony account when the body does not name one', async () => {
    const h = harness('..22');
    const planetId = 'pl-sess';
    const playerId = devPlayerId('w2208');
    const accountId = 'co-sess.pilot.terraagent.mock';
    await db.prisma.player.create({ data: { id: playerId, handle: 'w2208' } });
    await db.prisma.planet.create({ data: { id: planetId, name: 'Sess' } });
    await db.prisma.colony.create({
      data: { id: 'co_sess', playerId, planetId, colonyIndex: 0, name: 'Sess' },
    });
    await db.prisma.nearColonyAccount.create({
      data: {
        accountId, playerId, slot: 'co_sess', colonyId: 'co_sess',
        ownerAccountId: 'pilot.terraagent.mock', publicKey: 'ed25519:test', encryptedSecret: 'cipher', kekVersion: 1,
      },
    });
    const daoId = await fund(h, planetId, '2000', accountId);
    await seat(h, daoId, [accountId]);
    const opened = await h.controller.propose(
      planetId,
      { kind: 'meteor_shield', description: 'From session' },
      req(undefined, 'Bearer dev:w2208'),
    );
    expect(opened).toMatchObject({ proposer: accountId, state: 'InProgress', cost: '1500' });
    expect((await h.controller.council(planetId)).balance[TOKEN]).toBe('2000');
  });
});

describe('W22-08 treasury proposals API negative', () => {
  it('rejects meteor_shield when the balance is 100 and writes no proposal', async () => {
    const h = harness('..22');
    const planetId = 'pl-poor';
    const daoId = await fund(h, planetId, '100', A);
    await seat(h, daoId, [A, B, C]);
    await expect(h.controller.propose(planetId, proposeBody('meteor_shield', A), req()))
      .rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT', status: 409 });
    expect(await proposalCount(daoId)).toBe(0);
    expect((await h.controller.council(planetId)).balance[TOKEN]).toBe('100');
    const failed = await db.prisma.chainOutbox.findUnique({ where: { opId: `dao-propose:${planetId}:${A}:1` } });
    expect(failed?.status).toBe('DEAD');
  });

  it('rejects a non-member vote and a second vote from the same colony', async () => {
    const h = harness('..22');
    const planetId = 'pl-vote';
    const daoId = await fund(h, planetId, '2000', A);
    await seat(h, daoId, [A, B, C]);
    const opened = await h.controller.propose(planetId, proposeBody('terraform_boost', A), req());
    expect(opened.cost).toBe('1000');
    await expect(h.controller.vote(planetId, String(opened.proposalId), { vote: 'approve', colonyAccountId: OUT }, req()))
      .rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER', status: 403 });
    await h.controller.vote(planetId, String(opened.proposalId), { vote: 'approve', colonyAccountId: A }, req());
    await expect(h.controller.vote(planetId, String(opened.proposalId), { vote: 'reject', colonyAccountId: A }, req()))
      .rejects.toMatchObject({ errorCode: 'ALREADY_VOTED', status: 409 });
    const council = await h.controller.council(planetId);
    expect(council.proposals[0]).toMatchObject({ state: 'InProgress', yes: 1 });
    expect(council.balance[TOKEN]).toBe('2000');
  });
});

describe('W22-08 treasury proposals API corner', () => {
  it('rejects a second open proposal from the same colony and an unknown kind', async () => {
    const h = harness('..22');
    const planetId = 'pl-open';
    const daoId = await fund(h, planetId, '2000', A);
    await seat(h, daoId, [A, B]);
    await h.controller.propose(planetId, proposeBody('guild_subsidy', A), req());
    await expect(h.controller.propose(planetId, proposeBody('meteor_shield', A), req()))
      .rejects.toMatchObject({ errorCode: 'PROPOSAL_OPEN', status: 409 });
    const other = await h.controller.propose(planetId, proposeBody('terraform_boost', B), req());
    expect(other).toMatchObject({ proposer: B, cost: '1000', state: 'InProgress' });
    expect(await proposalCount(daoId)).toBe(2);
    await expect(h.controller.propose('pl-kind', proposeBody('laser_beam', A), req()))
      .rejects.toMatchObject({ errorCode: 'invalid_args', status: 400 });
    expect(await db.prisma.mockChainDao.findUnique({ where: { id: daoAccountIdFor('pl-kind') } })).toBeNull();
  });

  it('answers 404 when W22 is off and ignores colonyAccountId outside test', async () => {
    const off = harness('..21');
    await expect(off.controller.council('pl-off')).rejects.toMatchObject({ errorCode: 'NOT_FOUND', status: 404 });
    await expect(off.controller.propose('pl-off', proposeBody('meteor_shield', A), req())).rejects.toMatchObject({ status: 404 });
    await expect(off.controller.vote('pl-off', '0', { vote: 'approve', colonyAccountId: A }, req())).rejects.toMatchObject({ status: 404 });
    expect(await db.prisma.mockChainDao.findUnique({ where: { id: daoAccountIdFor('pl-off') } })).toBeNull();

    const dev = harness('..22', 'development');
    await expect(dev.controller.propose('pl-devmode', proposeBody('meteor_shield', A), req()))
      .rejects.toMatchObject({ errorCode: 'UNAUTHORIZED', status: 401 });
    expect(await db.prisma.mockChainDao.findUnique({ where: { id: daoAccountIdFor('pl-devmode') } })).toBeNull();
  });
});
