import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TreasuryDaoPort } from '../../src/near/application/ports/treasury-dao.port';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { mockChainControls } from '../../src/near/infrastructure/mock/mock-controls';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module';

const A = 'col-a.pilot.terraagent.mock';
const B = 'col-b.pilot.terraagent.mock';
const C = 'col-c.pilot.terraagent.mock';
const D = 'col-d.pilot.terraagent.mock';
const E = 'col-e.pilot.terraagent.mock';
const OUT = 'outsider.pilot.terraagent.mock';

let db: TestDatabase;
let dao: MockTreasuryDaoAdapter;

beforeAll(async () => {
  mockChainControls.reset();
  db = await createTestDatabase();
  dao = new MockTreasuryDaoAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 3 }, { sleep: async () => undefined });
});
afterAll(async () => { await db?.drop(); });

async function open(name: string, members: string[], opId: string): Promise<string> {
  const created = await dao.createDao({ opId, name, councilAccountIds: members });
  return created.daoAccountId;
}

describe('W22-03 MockTreasuryDaoAdapter positive', () => {
    it('approves a 3-member DAO after two yes votes and debits the cost once', async () => {
      expect(nearAdapters.some((a) => a.port === TreasuryDaoPort && a.kind === 'mock' && a.useClass === MockTreasuryDaoAdapter)).toBe(true);
      const created = await dao.createDao({ opId: 'pos:create', name: 'Planet Dune', councilAccountIds: [A, B, C] });
      expect(created.daoAccountId).toBe('planet-dune.dao.mock');
      expect(created.receipt.txHash.startsWith('mock:')).toBe(true);
      expect(created.receipt).toMatchObject({ status: 'success', network: 'mock' });
      const replay = await dao.createDao({ opId: 'pos:create', name: 'Other', councilAccountIds: [A] });
      expect(replay.receipt.txHash).toBe(created.receipt.txHash);
      const id = created.daoAccountId;
      expect(await db.prisma.mockChainAccount.findUnique({ where: { accountId: id } })).toBeTruthy();
      const kept = await dao.createDao({ opId: 'pos:create-again', name: 'Planet Dune', councilAccountIds: [A] });
      expect(kept.daoAccountId).toBe(id);
      expect((await dao.get({ daoAccountId: id })).members).toHaveLength(3);

      await dao.deposit({ opId: 'pos:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '5000' });
      await dao.deposit({ opId: 'pos:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '5000' });
      const proposed = await dao.propose({
        opId: 'pos:prop', daoAccountId: id, proposer: A, description: 'Meteor shield', kind: 'meteor_shield',
        payload: { cost: '1500', tokenId: 'metals.t1' },
      });
      await dao.vote({ opId: 'pos:va', daoAccountId: id, proposalId: proposed.proposalId, voter: A, vote: 'approve' });
      expect((await dao.get({ daoAccountId: id })).proposals[0]).toMatchObject({ state: 'InProgress', yes: 1, no: 0 });
      await dao.vote({ opId: 'pos:vb', daoAccountId: id, proposalId: proposed.proposalId, voter: B, vote: 'approve' });
      const view = await dao.get({ daoAccountId: id });
      expect(view.name).toBe('Planet Dune');
      expect(view.members.every((member) => member.canPropose)).toBe(true);
      expect(view.proposals[0]).toMatchObject({ state: 'Approved', yes: 2, no: 0 });
      expect(view.balances['metals.t1']).toBe('3500');
      await dao.finalize({ opId: 'pos:fin', daoAccountId: id, proposalId: proposed.proposalId });
      expect((await dao.get({ daoAccountId: id })).balances['metals.t1']).toBe('3500');
      const policy = (await db.prisma.mockChainDao.findUnique({ where: { id } }))?.policy as { members: unknown[]; balances: Record<string, string> };
      expect(policy.members).toHaveLength(3);
      expect(policy.balances['metals.t1']).toBe('3500');
    });
});

describe('W22-03 MockTreasuryDaoAdapter negative', () => {
    it('rejects a second vote from the same colony', async () => {
      const id = await open('Twice', [A, B, C], 'neg:twice');
      const prop = await dao.propose({ opId: 'neg:twice:prop', daoAccountId: id, proposer: A, description: 'Once', kind: 'meteor_shield', payload: {} });
      await dao.vote({ opId: 'neg:twice:v1', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' });
      await expect(dao.vote({ opId: 'neg:twice:v2', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' })).rejects.toMatchObject({ errorCode: 'ALREADY_VOTED' });
      const replay = await dao.vote({ opId: 'neg:twice:v1', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'reject' });
      expect(replay.status).toBe('success');
      expect((await dao.get({ daoAccountId: id })).proposals[0].votes).toEqual([{ voter: A, vote: 'approve' }]);
    });

    it('rejects an outsider propose and vote', async () => {
      const id = await open('Gate', [A, B, C], 'neg:out');
      const prop = await dao.propose({ opId: 'neg:out:prop', daoAccountId: id, proposer: A, description: 'Members', kind: 'meteor_shield', payload: {} });
      await expect(dao.vote({ opId: 'neg:out:vote', daoAccountId: id, proposalId: prop.proposalId, voter: OUT, vote: 'approve' })).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
      await expect(dao.propose({ opId: 'neg:out:bad', daoAccountId: id, proposer: OUT, description: 'No', kind: 'meteor_shield', payload: {} })).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
    });

    it('rejects a member who cannot propose', async () => {
      const id = await open('Settled', [A], 'neg:settle');
      await dao.addMember({ opId: 'neg:settle:add', daoAccountId: id, member: OUT, canPropose: false });
      await expect(dao.propose({ opId: 'neg:settle:prop', daoAccountId: id, proposer: OUT, description: 'No', kind: 'meteor_shield', payload: {} })).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
    });

    it('returns DAO_NOT_FOUND for a missing council', async () => {
      const missing = 'missing.dao.mock';
      await expect(dao.get({ daoAccountId: missing })).rejects.toMatchObject({ errorCode: 'DAO_NOT_FOUND' });
      await expect(dao.propose({ opId: 'neg:miss:prop', daoAccountId: missing, proposer: A, description: 'Gone', kind: 'meteor_shield', payload: {} })).rejects.toMatchObject({ errorCode: 'DAO_NOT_FOUND' });
      await expect(dao.addMember({ opId: 'neg:miss:add', daoAccountId: missing, member: A })).rejects.toMatchObject({ errorCode: 'DAO_NOT_FOUND' });
    });

    it('refuses a proposal whose cost is above the balance and writes no row', async () => {
      const id = await open('Poor', [A, B, C], 'neg:poor');
      await dao.deposit({ opId: 'neg:poor:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '10' });
      await expect(dao.propose({
        opId: 'neg:poor:prop', daoAccountId: id, proposer: A, description: 'Too dear', kind: 'meteor_shield', payload: { cost: '11' },
      })).rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT' });
      expect(await db.prisma.mockChainDaoProposal.count({ where: { daoId: id } })).toBe(0);
      expect((await dao.get({ daoAccountId: id })).balances['metals.t1']).toBe('10');
    });

    it('rejects a vote on an approved proposal', async () => {
      const id = await open('Done', [A, B, C], 'neg:closed');
      const prop = await dao.propose({ opId: 'neg:closed:prop', daoAccountId: id, proposer: A, description: 'Pass', kind: 'meteor_shield', payload: {} });
      await dao.vote({ opId: 'neg:closed:va', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' });
      await dao.vote({ opId: 'neg:closed:vb', daoAccountId: id, proposalId: prop.proposalId, voter: B, vote: 'approve' });
      await expect(dao.vote({ opId: 'neg:closed:vc', daoAccountId: id, proposalId: prop.proposalId, voter: C, vote: 'approve' })).rejects.toMatchObject({ errorCode: 'PROPOSAL_CLOSED' });
    });
});

describe('W22-03 MockTreasuryDaoAdapter corner', () => {
    it('keeps 1 yes of 3 in progress, then expires it without moving funds', async () => {
      const id = await open('Stall', [A, B, C], 'cor:stall');
      await dao.deposit({ opId: 'cor:stall:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '800' });
      const prop = await dao.propose({
        opId: 'cor:stall:prop', daoAccountId: id, proposer: A, description: 'Wait', kind: 'terraform_boost', payload: { cost: '100', tokenId: 'metals.t1' },
      });
      await dao.vote({ opId: 'cor:stall:va', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' });
      expect((await dao.get({ daoAccountId: id })).proposals[0].state).toBe('InProgress');
      await dao.finalize({ opId: 'cor:stall:fin', daoAccountId: id, proposalId: prop.proposalId });
      const view = await dao.get({ daoAccountId: id });
      expect(view.proposals[0].state).toBe('Expired');
      expect(view.balances['metals.t1']).toBe('800');
      await dao.finalize({ opId: 'cor:stall:fin2', daoAccountId: id, proposalId: prop.proposalId });
      expect((await dao.get({ daoAccountId: id })).balances['metals.t1']).toBe('800');
    });

    it('does not create a second proposal when the opId repeats', async () => {
      const id = await open('Replay', [A, B], 'cor:replay');
      const first = await dao.propose({ opId: 'cor:replay:prop', daoAccountId: id, proposer: A, description: 'Once', kind: 'guild_subsidy', payload: {} });
      const second = await dao.propose({ opId: 'cor:replay:prop', daoAccountId: id, proposer: A, description: 'Twice', kind: 'guild_subsidy', payload: { cost: '1' } });
      expect(second.proposalId).toBe(first.proposalId);
      expect(await db.prisma.mockChainDaoProposal.count({ where: { daoId: id } })).toBe(1);
    });

    it('passes 2 yes and 0 no on a 5-member DAO', async () => {
      const id = await open('Five', [A, B, C, D, E], 'cor:five');
      await dao.deposit({ opId: 'cor:five:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '100' });
      const prop = await dao.propose({
        opId: 'cor:five:prop', daoAccountId: id, proposer: A, description: 'Minority', kind: 'meteor_shield', payload: { cost: '40' },
      });
      await dao.vote({ opId: 'cor:five:va', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' });
      expect((await dao.get({ daoAccountId: id })).proposals[0].state).toBe('InProgress');
      await dao.vote({ opId: 'cor:five:vb', daoAccountId: id, proposalId: prop.proposalId, voter: B, vote: 'approve' });
      const view = await dao.get({ daoAccountId: id });
      expect(view.proposals[0]).toMatchObject({ state: 'Approved', yes: 2, no: 0 });
      expect(view.balances['metals.t1']).toBe('60');
    });

    it('counts a remove vote as no, so 2 yes and 1 remove on 5 members stays open', async () => {
      const id = await open('Remove', [A, B, C, D, E], 'cor:rm');
      const prop = await dao.propose({ opId: 'cor:rm:prop', daoAccountId: id, proposer: A, description: 'Pull', kind: 'meteor_shield', payload: {} });
      await dao.vote({ opId: 'cor:rm:va', daoAccountId: id, proposalId: prop.proposalId, voter: A, vote: 'approve' });
      await dao.vote({ opId: 'cor:rm:vc', daoAccountId: id, proposalId: prop.proposalId, voter: C, vote: 'remove' });
      await dao.vote({ opId: 'cor:rm:vb', daoAccountId: id, proposalId: prop.proposalId, voter: B, vote: 'approve' });
      expect((await dao.get({ daoAccountId: id })).proposals[0]).toMatchObject({ state: 'InProgress', yes: 2, no: 1 });
    });

    it('rolls back the deciding vote when the debit would go negative', async () => {
      const id = await open('Drain', [A, B, C], 'cor:drain');
      await dao.deposit({ opId: 'cor:drain:dep', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '100' });
      const first = await dao.propose({ opId: 'cor:drain:p1', daoAccountId: id, proposer: A, description: 'First', kind: 'meteor_shield', payload: { cost: '100' } });
      const second = await dao.propose({ opId: 'cor:drain:p2', daoAccountId: id, proposer: B, description: 'Second', kind: 'meteor_shield', payload: { cost: '100' } });
      await dao.vote({ opId: 'cor:drain:a1', daoAccountId: id, proposalId: first.proposalId, voter: A, vote: 'approve' });
      await dao.vote({ opId: 'cor:drain:b1', daoAccountId: id, proposalId: first.proposalId, voter: B, vote: 'approve' });
      await dao.vote({ opId: 'cor:drain:a2', daoAccountId: id, proposalId: second.proposalId, voter: A, vote: 'approve' });
      await expect(dao.vote({ opId: 'cor:drain:b2', daoAccountId: id, proposalId: second.proposalId, voter: B, vote: 'approve' })).rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT' });
      expect((await dao.get({ daoAccountId: id })).proposals[1]).toMatchObject({ state: 'InProgress', yes: 1 });
      expect((await dao.get({ daoAccountId: id })).balances['metals.t1']).toBe('0');
      await dao.deposit({ opId: 'cor:drain:dep2', daoAccountId: id, from: A, tokenId: 'metals.t1', amount: '100' });
      await dao.vote({ opId: 'cor:drain:b3', daoAccountId: id, proposalId: second.proposalId, voter: B, vote: 'approve' });
      const view = await dao.get({ daoAccountId: id });
      expect(view.proposals[1].state).toBe('Approved');
      expect(view.balances['metals.t1']).toBe('0');
    });

    it('adds a member once and remove is idempotent', async () => {
      const id = await open('Roster', [A], 'cor:roster');
      await dao.addMember({ opId: 'cor:roster:b1', daoAccountId: id, member: B });
      await dao.addMember({ opId: 'cor:roster:b2', daoAccountId: id, member: B });
      expect((await dao.get({ daoAccountId: id })).members).toHaveLength(2);
      await dao.addMember({ opId: 'cor:roster:b3', daoAccountId: id, member: B, canPropose: false });
      expect((await dao.get({ daoAccountId: id })).members[1]).toEqual({ accountId: B, canPropose: false });
      await dao.addMember({ opId: 'cor:roster:b4', daoAccountId: id, member: B });
      expect((await dao.get({ daoAccountId: id })).members[1]?.canPropose).toBe(false);
      await dao.removeMember({ opId: 'cor:roster:rm', daoAccountId: id, member: B });
      await dao.removeMember({ opId: 'cor:roster:rm2', daoAccountId: id, member: B });
      expect((await dao.get({ daoAccountId: id })).members).toEqual([{ accountId: A, canPropose: true }]);
    });
});
