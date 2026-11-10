import 'reflect-metadata';
import { newId } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/bus/event-bus';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { PlanetDaoLifecycleBind } from '../../src/near/treasury/lifecycle.bind';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { daoMemberOpId, daoMemberRemoveOpId } from '../../src/near/treasury/membership';
import { PlanetDaoMembershipService } from '../../src/near/treasury/membership.service';
import { daoAccountIdFor } from '../../src/near/treasury/policy';
import { proposalPasses, tallyMemberVotes } from '../../src/near/treasury/pass-rule';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

function harness(taWaves: string) {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 6 },
    { sleep: async () => undefined },
  );
  const outbox = new ChainOutboxRepository(db.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, env as never);
  const membership = new PlanetDaoMembershipService(flags, lifecycle, dao, db.prisma, env as never, outbox);
  const bus = new EventBus();
  const bind = new PlanetDaoLifecycleBind(lifecycle, bus, undefined, membership);
  bind.onModuleInit();
  return { dao, bus, bind };
}

async function seedColony(colonyId: string): Promise<string> {
  const accountId = `${colonyId.toLowerCase()}.pilot.terraagent.mock`;
  await db.prisma.nearColonyAccount.create({
    data: {
      accountId,
      playerId: newId('pr'),
      slot: colonyId,
      colonyId,
      ownerAccountId: 'pilot.terraagent.mock',
      publicKey: 'ed25519:testkey',
      encryptedSecret: 'cipher',
      kekVersion: 1,
    },
  });
  return accountId;
}

function emitFounded(bus: EventBus, planetId: string, colonyId: string): void {
  bus.emit('planet.event', {
    planetId,
    tick: 1,
    kind: 'colonyFounded',
    severity: 'info',
    colonyIds: [colonyId],
    data: { colonyId, playerId: 'pr_member' },
  });
}

function emitEliminated(bus: EventBus, planetId: string, colonyId: string): void {
  bus.emit('planet.event', {
    planetId,
    tick: 4,
    kind: 'colonyEliminated',
    severity: 'critical',
    colonyIds: [colonyId],
    data: { colonyId, cause: 'other', atTick: 4 },
  });
}

function emitSettled(bus: EventBus, planetId: string, colonyId: string): void {
  bus.emit('planet.event', {
    planetId,
    tick: 8,
    kind: 'deedSettled',
    severity: 'info',
    colonyIds: [colonyId],
    data: { colonyId, planetId, tokenId: 'deed-1', version: 1 },
  });
}

async function membersOf(dao: MockTreasuryDaoAdapter, planetId: string) {
  const view = await dao.get({ daoAccountId: daoAccountIdFor(planetId) });
  return view.members;
}

async function waitMembers(dao: MockTreasuryDaoAdapter, planetId: string, count: number) {
  let members: Awaited<ReturnType<typeof membersOf>> = [];
  await vi.waitFor(async () => {
    members = await membersOf(dao, planetId);
    expect(members).toHaveLength(count);
  });
  return members;
}

function registerCountTests(): void {
  it('two founded colonies are 2 members, and eliminating B leaves 1', async () => {
    const { dao, bus, bind } = harness('..22');
    const planetId = newId('pl');
    const colonyA = newId('co');
    const colonyB = newId('co');
    const accountA = await seedColony(colonyA);
    const accountB = await seedColony(colonyB);
    emitFounded(bus, planetId, colonyA);
    emitFounded(bus, planetId, colonyB);

    const before = await waitMembers(dao, planetId, 2);
    expect(before.map((member) => member.accountId).sort()).toEqual([accountA, accountB].sort());
    expect(before.every((member) => member.canPropose)).toBe(true);
    expect(await db.prisma.chainOutbox.findUnique({ where: { opId: daoMemberOpId(planetId, colonyB) } })).toMatchObject({
      port: 'TreasuryDao',
      method: 'addMember',
      status: 'DONE',
    });

    emitEliminated(bus, planetId, colonyB);
    const after = await waitMembers(dao, planetId, 1);
    expect(before).toHaveLength(2);
    expect(after).toEqual([{ accountId: accountA, canPropose: true }]);
    bind.onModuleDestroy();
  });

  it('eliminating a colony that was never a member does not throw or change the count', async () => {
    const { dao, bus, bind } = harness('..22');
    const planetId = newId('pl');
    const colonyA = newId('co');
    const stranger = newId('co');
    const accountA = await seedColony(colonyA);
    await seedColony(stranger);
    emitFounded(bus, planetId, colonyA);
    expect(await waitMembers(dao, planetId, 1)).toEqual([{ accountId: accountA, canPropose: true }]);

    const ghost = newId('co');
    emitEliminated(bus, planetId, stranger);
    emitEliminated(bus, planetId, ghost);
    await vi.waitFor(async () => {
      const row = await db.prisma.chainOutbox.findUnique({ where: { opId: daoMemberRemoveOpId(planetId, stranger) } });
      expect(row?.status).toBe('DONE');
    });
    expect(await membersOf(dao, planetId)).toEqual([{ accountId: accountA, canPropose: true }]);
    expect(await db.prisma.chainOutbox.findUnique({ where: { opId: daoMemberRemoveOpId(planetId, ghost) } })).toBeNull();
    bind.onModuleDestroy();
  });

  it('adds and removes nothing when W22 is off', async () => {
    const { dao, bus, bind } = harness('..21');
    const planetId = newId('pl');
    const colonyA = newId('co');
    await seedColony(colonyA);
    emitFounded(bus, planetId, colonyA);
    emitEliminated(bus, planetId, colonyA);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await db.prisma.mockChainDao.findUnique({ where: { id: daoAccountIdFor(planetId) } })).toBeNull();
    expect(await db.prisma.chainOutbox.findUnique({ where: { opId: daoMemberOpId(planetId, colonyA) } })).toBeNull();
    bind.onModuleDestroy();
  });
}

function registerIgnoredYes(): void {
  it('finalize ignores B\'s yes, and one counted yes of the one remaining member passes', async () => {
    const { dao, bus, bind } = harness('..22');
    const planetId = newId('pl');
    const colonyA = newId('co');
    const colonyB = newId('co');
    const accountA = await seedColony(colonyA);
    const accountB = await seedColony(colonyB);
    emitFounded(bus, planetId, colonyA);
    emitFounded(bus, planetId, colonyB);
    await waitMembers(dao, planetId, 2);
    const daoAccountId = daoAccountIdFor(planetId);

    const proposed = await dao.propose({
      opId: `mem:prop:${colonyA}`,
      daoAccountId,
      proposer: accountA,
      description: 'Meteor shield',
      kind: 'meteor_shield',
      payload: {},
    });
    await dao.vote({
      opId: `mem:vote:b:${colonyB}`,
      daoAccountId,
      proposalId: proposed.proposalId,
      voter: accountB,
      vote: 'approve',
    });
    expect((await dao.get({ daoAccountId })).proposals[0]?.state).toBe('InProgress');

    emitEliminated(bus, planetId, colonyB);
    await waitMembers(dao, planetId, 1);
    const open = await dao.get({ daoAccountId });
    const tally = tallyMemberVotes(open.proposals[0]?.votes ?? [], open.members.map((member) => member.accountId));
    expect(tally).toEqual({ yes: 0, no: 0, members: 1 });
    expect(proposalPasses(tally)).toBe(false);
    expect(proposalPasses({ yes: 1, no: 0, members: 1 })).toBe(true);
    expect(open.proposals[0]).toMatchObject({ state: 'InProgress', yes: 0, no: 0 });

    await dao.finalize({ opId: `mem:fin:${colonyB}`, daoAccountId, proposalId: proposed.proposalId });
    expect((await dao.get({ daoAccountId })).proposals[0]?.state).toBe('Expired');

    const second = await dao.propose({
      opId: `mem:prop2:${colonyA}`,
      daoAccountId,
      proposer: accountA,
      description: 'Terraform boost',
      kind: 'terraform_boost',
      payload: {},
    });
    await dao.vote({
      opId: `mem:vote:a:${colonyA}`,
      daoAccountId,
      proposalId: second.proposalId,
      voter: accountA,
      vote: 'approve',
    });
    expect((await dao.get({ daoAccountId })).proposals[1]).toMatchObject({ state: 'Approved', yes: 1, no: 0 });
    bind.onModuleDestroy();
  });
}

function registerTippingYes(): void {
  it('does not pass a proposal that only clears because of a removed yes', async () => {
    const { dao, bus, bind } = harness('..22');
    const planetId = newId('pl');
    const ids = [newId('co'), newId('co'), newId('co'), newId('co')];
    const accounts: string[] = [];
    for (const colonyId of ids) {
      accounts.push(await seedColony(colonyId));
      emitFounded(bus, planetId, colonyId);
    }
    await waitMembers(dao, planetId, 4);
    const daoAccountId = daoAccountIdFor(planetId);
    const [accountA, accountB, accountC] = accounts;
    const proposed = await dao.propose({
      opId: `mem:tip:${planetId}`,
      daoAccountId,
      proposer: accountA!,
      description: 'Shield',
      kind: 'meteor_shield',
      payload: {},
    });
    await dao.vote({ opId: `mem:tip:a:${planetId}`, daoAccountId, proposalId: proposed.proposalId, voter: accountA!, vote: 'approve' });
    await dao.vote({ opId: `mem:tip:c:${planetId}`, daoAccountId, proposalId: proposed.proposalId, voter: accountC!, vote: 'reject' });
    await dao.vote({ opId: `mem:tip:b:${planetId}`, daoAccountId, proposalId: proposed.proposalId, voter: accountB!, vote: 'approve' });
    expect((await dao.get({ daoAccountId })).proposals[0]).toMatchObject({ state: 'InProgress', yes: 2, no: 1 });
    expect(proposalPasses({ yes: 2, no: 1, members: 3 })).toBe(true);

    emitEliminated(bus, planetId, ids[1]!);
    await waitMembers(dao, planetId, 3);
    const view = await dao.get({ daoAccountId });
    const tally = tallyMemberVotes(view.proposals[0]?.votes ?? [], view.members.map((member) => member.accountId));
    expect(tally).toEqual({ yes: 1, no: 1, members: 3 });
    expect(proposalPasses(tally)).toBe(false);
    await dao.finalize({ opId: `mem:tip:fin:${planetId}`, daoAccountId, proposalId: proposed.proposalId });
    expect((await dao.get({ daoAccountId })).proposals[0]?.state).toBe('Expired');
    bind.onModuleDestroy();
  });
}

function registerSettled(): void {
  it('keeps a settled colony as a member that cannot propose', async () => {
    const { dao, bus, bind } = harness('..22');
    const planetId = newId('pl');
    const colonyA = newId('co');
    const accountA = await seedColony(colonyA);
    emitFounded(bus, planetId, colonyA);
    await waitMembers(dao, planetId, 1);
    emitSettled(bus, planetId, colonyA);
    await vi.waitFor(async () => {
      expect(await membersOf(dao, planetId)).toEqual([{ accountId: accountA, canPropose: false }]);
    });
    await expect(dao.propose({
      opId: `mem:settled:${colonyA}`,
      daoAccountId: daoAccountIdFor(planetId),
      proposer: accountA,
      description: 'No',
      kind: 'meteor_shield',
      payload: {},
    })).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
    bind.onModuleDestroy();
  });
}

describe('W22-06 DAO membership', () => {
  registerCountTests();
  registerIgnoredYes();
  registerTippingYes();
  registerSettled();
});
