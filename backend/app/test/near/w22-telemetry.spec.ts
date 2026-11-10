import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import { NearException } from '../../src/near/domain/errors.js';
import { BountyClaimService } from '../../src/near/bounty/claim.service.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { proposalResultLabel, W22TelemetryService } from '../../src/near/telemetry/w22-telemetry.service.js';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service.js';

const A = 'a.pilot.terraagent.mock';
const B = 'b.pilot.terraagent.mock';
const NOW = 1_700_000_000_000;

function telemetry(on = true, prisma?: unknown): { metrics: MetricsRegistry; telemetry: W22TelemetryService } {
  const metrics = new MetricsRegistry();
  return {
    metrics,
    telemetry: new W22TelemetryService(metrics, { has: (wave) => on && wave === 'W22' }, prisma as never),
  };
}

function deliver(over: Partial<BountyPostInput> = {}): BountyPostInput {
  return {
    planetId: 'p', colonyId: 'col', colonyIndex: 0, accountId: A, bountyId: 'bt1', nowMs: NOW,
    args: {
      target: { kind: 'deliver_units', resource: 'bio.water', amount: 1 },
      reward: { resource: 'metals.t1', amount: 10 },
      expiresAt: NOW + 4 * 3_600_000,
    },
    ...over,
  };
}

describe('W22 telemetry recorder', () => {
  it('records each server event and increments the matching counter', async () => {
    const { metrics, telemetry: rec } = telemetry();
    await rec.proposalOpened('pl', 'meteor_shield');
    await rec.voteCast('pl', 'meteor_shield', 'InProgress');
    await rec.voteCast('pl', 'meteor_shield', 'Approved');
    rec.proposalTerminal('terraform_boost', 'Expired');
    rec.proposalTerminal('guild_subsidy', 'Rejected');
    await rec.bountyPosted('clear_nest');
    await rec.bountyClaimed('defend_area');
    await rec.bountyPaid('deliver_units');
    await rec.mercenaryHired();
    await rec.mercenaryHired();
    const names = rec.recorded.map((row) => row.name);
    expect(names).toEqual([
      'proposal_created', 'vote_cast', 'vote_cast', 'bounty_posted', 'bounty_claimed', 'bounty_paid', 'mercenary_hired', 'mercenary_hired',
    ]);
    expect(rec.recorded.every((row) => !JSON.stringify(row.props).match(/account|colony|wallet/i))).toBe(true);
    const text = await metrics.render();
    expect(text).toContain('treasury_proposals_total{kind="meteor_shield",result="open"} 1');
    expect(text).toContain('treasury_proposals_total{kind="meteor_shield",result="approved"} 1');
    expect(text).toContain('treasury_proposals_total{kind="terraform_boost",result="expired"} 1');
    expect(text).toContain('treasury_proposals_total{kind="guild_subsidy",result="rejected"} 1');
    expect(text).toContain('bounties_total{kind="clear_nest",state="open"} 1');
    expect(text).toContain('bounties_total{kind="defend_area",state="claimed"} 1');
    expect(text).toContain('bounties_total{kind="deliver_units",state="paid"} 1');
    expect(text).toContain('mercenary_contracts_total 2');
    expect(proposalResultLabel('InProgress')).toBe('open');
  });

  it('records nothing when W22 is off', async () => {
    const { metrics, telemetry: rec } = telemetry(false);
    await rec.proposalOpened('pl', 'meteor_shield');
    await rec.voteCast('pl', 'meteor_shield', 'Approved');
    rec.proposalTerminal('meteor_shield', 'Expired');
    await rec.bountyPosted('clear_nest');
    await rec.bountyClaimed('defend_area');
    await rec.bountyPaid('deliver_units');
    await rec.mercenaryHired();
    expect(rec.recorded).toEqual([]);
    const text = await metrics.render();
    expect(text).not.toContain('treasury_proposals_total{');
    expect(text).not.toContain('bounties_total{');
    expect(text).toContain('mercenary_contracts_total 0');
  });

  it('a missing or unreadable DAO does not throw and omits the series', async () => {
    const empty = telemetry(true, { mockChainDao: { findMany: async () => [] } });
    await expect(empty.metrics.render()).resolves.not.toMatch(/treasury_balance\{/);
    const missing = telemetry(true, { mockChainDao: { findMany: async () => { throw new Error('no dao'); } } });
    await expect(missing.metrics.render()).resolves.toContain('# TYPE treasury_balance gauge');
    const funded = telemetry(true, {
      mockChainDao: { findMany: async () => [{ policy: { name: 'pl-gauge', members: [], balances: { 'metals.t1': '42' } } }] },
    });
    expect(await funded.metrics.render()).toContain('treasury_balance{planet="pl-gauge"} 42');
    const off = telemetry(false, {
      mockChainDao: { findMany: async () => [{ policy: { name: 'pl-gauge', members: [], balances: { 'metals.t1': '42' } } }] },
    });
    expect(await off.metrics.render()).not.toMatch(/treasury_balance\{/);
  });
});

describe('W22 telemetry hooks', () => {
  it('does not record a rejected propose, vote, post or claim', async () => {
    const { telemetry: rec } = telemetry();
    const council = proposals(rec, {
      get: async () => openView(),
      propose: async () => { throw new NearException('TREASURY_INSUFFICIENT', { details: {} }); },
      vote: async () => { throw new NearException('NOT_A_MEMBER', { details: {} }); },
    });
    await expect(council.propose('p', { kind: 'meteor_shield', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT' });
    await expect(council.propose('p', { kind: 'nuke', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'invalid_args' });
    const open = proposals(rec, { get: async () => ({ ...openView(), proposals: [progress(A)] }) });
    await expect(open.propose('p', { kind: 'meteor_shield', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'PROPOSAL_OPEN' });
    const voted = proposals(rec, { get: async () => ({ ...openView(), proposals: [{ ...progress(B), votes: [{ voter: A, vote: 'approve' }] }] }) });
    await expect(voted.vote('p', '1', { vote: 'reject', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'ALREADY_VOTED' });
    const outsider = proposals(rec, {
      get: async () => ({ ...openView(), proposals: [progress(B)] }),
      vote: async () => { throw new NearException('NOT_A_MEMBER', { details: {} }); },
    });
    await expect(outsider.vote('p', '1', { vote: 'approve', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
    const away = proposals(rec, { get: async () => ({ ...openView(), proposals: [progress(B)] }) }, awayPrisma());
    await expect(away.vote('p', '1', { vote: 'approve', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'away_policy' });
    const posts = poster(rec, { find: async () => null, countActive: async () => 3 });
    await expect(posts.post(deliver())).rejects.toMatchObject({ errorCode: 'queue_full' });
    await expect(posts.post(deliver({
      bountyId: 'bt-nest',
      args: { target: { kind: 'clear_nest', nestId: '9' }, reward: { resource: 'metals.t1', amount: 10 }, expiresAt: NOW + 4 * 3_600_000 },
    }))).rejects.toMatchObject({ errorCode: 'invalid_target' });
    await expect(posts.post(deliver({ args: { ...deliver().args, expiresAt: NOW + 3_600_000 } }))).rejects.toMatchObject({ errorCode: 'invalid_args' });
    const claims = new BountyClaimService(claimRepo('first.pilot.terraagent.mock') as never, { has: () => true }, rec);
    await expect(claims.claim({ planetId: 'p', bountyId: 'b1', accountId: B })).rejects.toMatchObject({ code: 'queue_full' });
    expect(rec.recorded).toEqual([]);
  });

  it('a second pay and a repeated claim do not record again, and W22 off posts nothing', async () => {
    const { metrics, telemetry: rec } = telemetry();
    const paid = payHarness(rec);
    expect(await paid.pay('b1')).toBe(true);
    expect(await paid.pay('b1')).toBe(true);
    expect(rec.recorded.map((row) => row.name)).toEqual(['bounty_paid']);
    expect(await metrics.render()).toContain('bounties_total{kind="deliver_units",state="paid"} 1');
    const same = new BountyClaimService(claimRepo(A, 'claimed') as never, { has: () => true }, rec);
    expect((await same.claim({ planetId: 'p', bountyId: 'b1', accountId: A })).state).toBe('claimed');
    expect(rec.recorded).toHaveLength(1);
    const before = rec.recorded.length;
    const off = poster(rec, { find: async () => null, countActive: async () => 0 }, false);
    await expect(off.post(deliver())).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    expect(rec.recorded).toHaveLength(before);
  });
});

function proposals(
  rec: W22TelemetryService,
  dao: { get: () => Promise<unknown>; propose?: () => Promise<unknown>; vote?: () => Promise<unknown> },
  prisma?: unknown,
): TreasuryProposalsService {
  const flags = { has: (wave: string) => wave === 'W22', flags: parseWaves('..22') };
  return new TreasuryProposalsService(
    flags as never,
    { ensurePlanetDao: async () => ({ planetId: 'p', daoAccountId: 'p.dao.mock', opId: 'dao-create:p' }) } as never,
    dao as never,
    prisma as never,
    { NODE_ENV: 'test' } as never,
    undefined,
    undefined,
    undefined,
    rec,
  );
}

function openView(): Record<string, unknown> {
  return {
    daoAccountId: 'p.dao.mock', name: 'p', members: [{ accountId: A, canPropose: true }, { accountId: B, canPropose: true }],
    balances: { 'metals.t1': '100' }, proposals: [],
  };
}

function progress(proposer: string): Record<string, unknown> {
  return { proposalId: 1, proposer, kind: 'meteor_shield', description: 'm', state: 'InProgress', yes: 0, no: 0, votes: [] };
}

function awayPrisma(): unknown {
  return {
    nearColonyAccount: { findUnique: async () => ({ colonyId: 'co' }) },
    planetEventDigest: { findMany: async () => [{ colonyId: 'co' }] },
  };
}

function req(): never {
  return { headers: {} } as never;
}

function poster(
  rec: W22TelemetryService,
  repo: { find: (id: string) => Promise<unknown>; countActive: () => Promise<number> },
  on = true,
): BountyPostService {
  const boom = async () => { throw new Error('should not run'); };
  return new BountyPostService(
    { open: boom } as never,
    { balanceOf: boom } as never,
    { ...repo, insert: boom } as never,
    { enqueue: boom, abandon: async () => undefined, markDoneByOpId: async () => false } as never,
    { load: async () => null } as never,
    { has: () => on },
    rec,
  );
}

function claimRepo(claimer: string, state = 'claimed'): unknown {
  const row = {
    id: 'b1', planetId: 'p', posterColonyId: 'col', colonyIndex: 0, accountId: A, state,
    claimerAccountId: claimer, escrowId: 'e', escrowTx: 'tx', opId: 'bounty-open:b1',
    createdAt: new Date(NOW), expiresAt: new Date(NOW + 4 * 3_600_000),
    target: { kind: 'defend_area', q: 0, r: 0, radius: 1, durationH: 2 },
    reward: { resource: 'metals.t1', amount: 5 },
  };
  return { find: async () => row, markClaimed: async () => false };
}

function payHarness(rec: W22TelemetryService): BountyPayService {
  const row = {
    id: 'b1', state: 'completed', claimerAccountId: A, planetId: 'p', escrowId: 'e1',
    target: { kind: 'deliver_units', resource: 'bio.water', amount: 1 },
    reward: { resource: 'metals.t1', amount: 10 },
  };
  const repo = {
    find: async () => row,
    markPaid: async () => {
      if (row.state !== 'completed') return false;
      row.state = 'paid';
      return true;
    },
  };
  const outbox = { enqueue: async () => undefined, markDoneByOpId: async () => true, flagPayload: async () => true };
  const escrow = { claim: async () => ({ txHash: 'mock:1' }) };
  return new BountyPayService(escrow as never, outbox as never, repo as never, { has: () => true }, undefined, undefined, rec);
}
