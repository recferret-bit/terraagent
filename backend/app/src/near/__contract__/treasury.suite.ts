import { expect } from 'vitest';
import type { TreasuryDaoPort } from '../application/ports/treasury-dao.port';
import type { ChainReceipt } from '../domain/types';
import type { NearContractApi, NearContractSuite } from './harness';

const COLONY_A = 'col-a.pilot.terraagent.mock';
const COLONY_B = 'col-b.pilot.terraagent.mock';
const COLONY_C = 'col-c.pilot.terraagent.mock';
const OUTSIDER = 'outsider.pilot.terraagent.mock';
const TOKEN = 'metals.t1';
const COUNCIL = [COLONY_A, COLONY_B, COLONY_C];

const tag = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function openDao(port: TreasuryDaoPort, members: readonly string[]): Promise<string> {
  const created = await port.createDao({
    opId: `create:${tag()}`,
    name: `council-${tag()}`,
    councilAccountIds: [...members],
  });
  return created.daoAccountId;
}

async function propose(
  port: TreasuryDaoPort,
  daoAccountId: string,
  proposer: string,
  payload: Record<string, unknown> = {},
): Promise<number> {
  const result = await port.propose({
    opId: `propose:${tag()}`,
    daoAccountId,
    proposer,
    description: 'Meteor shield',
    kind: 'meteor_shield',
    payload,
  });
  return result.proposalId;
}

async function castYes(
  port: TreasuryDaoPort,
  daoAccountId: string,
  proposalId: number,
  voter: string,
): Promise<ChainReceipt> {
  return port.vote({ opId: `vote:${tag()}`, daoAccountId, proposalId, voter, vote: 'approve' });
}

async function deposit(port: TreasuryDaoPort, daoAccountId: string, amount: string): Promise<void> {
  await port.deposit({
    opId: `deposit:${tag()}`,
    daoAccountId,
    from: COLONY_A,
    tokenId: TOKEN,
    amount,
  });
}

async function tokenBalance(port: TreasuryDaoPort, daoAccountId: string): Promise<string> {
  const view = await port.get({ daoAccountId });
  return view.balances[TOKEN] ?? '0';
}

function addPositiveTests(api: NearContractApi<TreasuryDaoPort>): void {
  const { test, expectReceipt } = api;

  test('createDao twice with the same opId returns the same dao and does not duplicate members', async (a) => {
    const opId = `create:${tag()}`;
    const name = `council-${tag()}`;
    const first = await a.port.createDao({ opId, name, councilAccountIds: [...COUNCIL] });
    const replay = await a.port.createDao({
      opId,
      name,
      councilAccountIds: [COLONY_A, COLONY_B, COLONY_C, COLONY_A, OUTSIDER],
    });
    expect(replay.daoAccountId).toBe(first.daoAccountId);
    expect(replay.receipt.txHash).toBe(first.receipt.txHash);
    expectReceipt(first.receipt, a, 'success');
    const view = await a.port.get({ daoAccountId: first.daoAccountId });
    expect(view.members.map((member) => member.accountId)).toEqual(COUNCIL);
  });

  test('addMember then get shows the member', async (a) => {
    const daoAccountId = await openDao(a.port, [COLONY_A]);
    const receipt = await a.port.addMember({ opId: `add:${tag()}`, daoAccountId, member: COLONY_B });
    expectReceipt(receipt, a, 'success');
    const view = await a.port.get({ daoAccountId });
    expect(view.members).toEqual([
      { accountId: COLONY_A, canPropose: true },
      { accountId: COLONY_B, canPropose: true },
    ]);
  });

  test('two yes votes on three members approve the proposal', async (a) => {
    const daoAccountId = await openDao(a.port, COUNCIL);
    const proposalId = await propose(a.port, daoAccountId, COLONY_A);
    await castYes(a.port, daoAccountId, proposalId, COLONY_A);
    expect((await a.port.get({ daoAccountId })).proposals[0]).toMatchObject({ state: 'InProgress', yes: 1, no: 0 });
    const deciding = await castYes(a.port, daoAccountId, proposalId, COLONY_B);
    expectReceipt(deciding, a, 'success');
    expect((await a.port.get({ daoAccountId })).proposals[0]).toMatchObject({
      proposalId,
      state: 'Approved',
      yes: 2,
      no: 0,
    });
  });
}

function addNegativeTests(api: NearContractApi<TreasuryDaoPort>): void {
  const { test } = api;

  test('a second vote from the same colony is ALREADY_VOTED', async ({ port }) => {
    const daoAccountId = await openDao(port, COUNCIL);
    const proposalId = await propose(port, daoAccountId, COLONY_A);
    await castYes(port, daoAccountId, proposalId, COLONY_A);
    const again = port.vote({
      opId: `vote:${tag()}`,
      daoAccountId,
      proposalId,
      voter: COLONY_A,
      vote: 'reject',
    });
    await expect(again).rejects.toMatchObject({ errorCode: 'ALREADY_VOTED' });
    expect((await port.get({ daoAccountId })).proposals[0]?.votes).toEqual([{ voter: COLONY_A, vote: 'approve' }]);
  });

  test('a non-member vote is NOT_A_MEMBER', async ({ port }) => {
    const daoAccountId = await openDao(port, COUNCIL);
    const proposalId = await propose(port, daoAccountId, COLONY_A);
    const outsider = port.vote({
      opId: `vote:${tag()}`,
      daoAccountId,
      proposalId,
      voter: OUTSIDER,
      vote: 'approve',
    });
    await expect(outsider).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
    expect((await port.get({ daoAccountId })).proposals[0]?.votes).toEqual([]);
  });

  test('propose with a cost above the deposited balance is TREASURY_INSUFFICIENT', async ({ port }) => {
    const daoAccountId = await openDao(port, COUNCIL);
    await deposit(port, daoAccountId, '10');
    const tooDear = port.propose({
      opId: `propose:${tag()}`,
      daoAccountId,
      proposer: COLONY_A,
      description: 'Too dear',
      kind: 'meteor_shield',
      payload: { cost: '11', tokenId: TOKEN },
    });
    await expect(tooDear).rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT' });
    const view = await port.get({ daoAccountId });
    expect(view.proposals).toHaveLength(0);
    expect(view.balances[TOKEN]).toBe('10');
  });
}

function addCornerTests(api: NearContractApi<TreasuryDaoPort>): void {
  const { test, expectReceipt } = api;

  test('one yes of three stays in progress, then finalize expires it and leaves the balance', async (a) => {
    const daoAccountId = await openDao(a.port, COUNCIL);
    await deposit(a.port, daoAccountId, '800');
    const proposalId = await propose(a.port, daoAccountId, COLONY_A, { cost: '100', tokenId: TOKEN });
    await castYes(a.port, daoAccountId, proposalId, COLONY_A);
    expect((await a.port.get({ daoAccountId })).proposals[0]?.state).toBe('InProgress');
    expect(await tokenBalance(a.port, daoAccountId)).toBe('800');

    const opId = `finalize:${tag()}`;
    const expired = await a.port.finalize({ opId, daoAccountId, proposalId });
    expectReceipt(expired, a, 'success');
    const view = await a.port.get({ daoAccountId });
    expect(view.proposals[0]).toMatchObject({ state: 'Expired', yes: 1, no: 0 });
    expect(view.balances[TOKEN]).toBe('800');

    const replay = await a.port.finalize({ opId, daoAccountId, proposalId });
    expect(replay.txHash).toBe(expired.txHash);
    expect(await tokenBalance(a.port, daoAccountId)).toBe('800');
  });

  test('a repeated finalize opId does not debit twice', async (a) => {
    const daoAccountId = await openDao(a.port, COUNCIL);
    await deposit(a.port, daoAccountId, '5000');
    const proposalId = await propose(a.port, daoAccountId, COLONY_A, { cost: '1500', tokenId: TOKEN });
    await castYes(a.port, daoAccountId, proposalId, COLONY_A);
    await castYes(a.port, daoAccountId, proposalId, COLONY_B);
    expect((await a.port.get({ daoAccountId })).proposals[0]?.state).toBe('Approved');
    expect(await tokenBalance(a.port, daoAccountId)).toBe('3500');

    const opId = `finalize:${tag()}`;
    const first = await a.port.finalize({ opId, daoAccountId, proposalId });
    expectReceipt(first, a, 'success');
    const replay = await a.port.finalize({ opId, daoAccountId, proposalId });
    expect(replay.txHash).toBe(first.txHash);
    expect(await tokenBalance(a.port, daoAccountId)).toBe('3500');
  });
}

/** Behaviour every `TreasuryDaoPort` adapter must show (W22-04, NEAR §1a). */
export const treasurySuite: NearContractSuite<TreasuryDaoPort> = (api) => {
  addPositiveTests(api);
  addNegativeTests(api);
  addCornerTests(api);
};
