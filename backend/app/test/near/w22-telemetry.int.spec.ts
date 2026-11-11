import { AnalyticsBatchV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createState, hexIndex, type PlanetState } from '@terra/sim';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsService } from '../../src/analytics/analytics.service.js';
import { AnalyticsCounters } from '../../src/analytics/analytics.counters.js';
import { MetricsRegistry } from '../../src/core/metrics.registry.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../../src/near/application/ports/cargo-token.port.js';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository.js';
import { BountyRepository } from '../../src/near/bounty/bounty.repository.js';
import { BountyClaimService } from '../../src/near/bounty/claim.service.js';
import { BountyPayService } from '../../src/near/bounty/pay.service.js';
import { BountyPostService, type BountyPostInput } from '../../src/near/bounty/post.service.js';
import { HOUR_MS } from '../../src/near/bounty/validate.js';
import { MockCargoTokenAdapter } from '../../src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.js';
import { MockEscrowAdapter } from '../../src/near/infrastructure/adapters/mock/escrow.adapter.js';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter.js';
import { MercenaryHireService } from '../../src/near/mercenary/hire.service.js';
import { W22TelemetryService } from '../../src/near/telemetry/w22-telemetry.service.js';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service.js';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service.js';

const A = 'w2234-a.pilot.terraagent.mock';
const B = 'w2234-b.pilot.terraagent.mock';
const C = 'w2234-c.pilot.terraagent.mock';
const POSTER = 'w2234-poster.terraagent.mock';
const CLAIMER = 'w2234-claimer.terraagent.mock';
const HIRER = 'w2234-hirer.terraagent.mock';
const TOKEN = 'metals.t1';
const PLANET = 'pl-w22-tel';
const POOR = 'pl-w22-poor';
const NOW = 1_700_000_000_000;
const sleep = async () => undefined;
const chain = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 34 });

let db: TestDatabase;

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describe('W22-34 telemetry', () => {
  it('stores each funnel name once and exposes the four metrics', async () => {
    const h = harness(true);
    await poorPropose(h);
    await council(h);
    await bounty(h);
    await hire(h, 'bt_hire', HIRER);
    await h.intake.ingest(AnalyticsBatchV1.parse({
      anonId: '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11', sessionId: 's1',
      events: [{ name: 'council_opened', ts: NOW, props: {} }],
    }));
    const names = (await db.prisma.analyticsEvent.findMany({ orderBy: { id: 'asc' } })).map((row) => row.name);
    expect(names.filter((name) => name === 'proposal_created')).toEqual(['proposal_created']);
    expect(names.filter((name) => name === 'vote_cast')).toEqual(['vote_cast']);
    expect(names.filter((name) => name === 'bounty_posted')).toEqual(['bounty_posted']);
    expect(names.filter((name) => name === 'bounty_claimed')).toEqual(['bounty_claimed']);
    expect(names.filter((name) => name === 'bounty_paid')).toEqual(['bounty_paid']);
    expect(names.filter((name) => name === 'mercenary_hired')).toEqual(['mercenary_hired']);
    expect(names.filter((name) => name === 'council_opened')).toEqual(['council_opened']);
    const text = await h.metrics.render();
    expect(text).toContain('treasury_balance{planet="pl-w22-tel"} 2000');
    expect(text).toContain('treasury_proposals_total{kind="meteor_shield",result="open"} 1');
    expect(text).toContain('bounties_total{kind="deliver_units",state="open"} 1');
    expect(text).toContain('bounties_total{kind="deliver_units",state="claimed"} 1');
    expect(text).toContain('bounties_total{kind="deliver_units",state="paid"} 1');
    expect(text).toContain('mercenary_contracts_total 1');
    expect(text).not.toContain('result="approved"');
  });

  it('a second hire increments the mercenary counter and W22 off writes nothing', async () => {
    const beforeHired = await db.prisma.analyticsEvent.count({ where: { name: 'mercenary_hired' } });
    const beforePosted = await db.prisma.analyticsEvent.count({ where: { name: 'bounty_posted' } });
    const h = harness(true);
    await hire(h, 'bt_hire_2', 'w2234-hirer2.terraagent.mock');
    await hire(h, 'bt_hire_3', 'w2234-hirer3.terraagent.mock');
    expect(await db.prisma.analyticsEvent.count({ where: { name: 'mercenary_hired' } })).toBe(beforeHired + 2);
    expect(await db.prisma.analyticsEvent.count({ where: { name: 'bounty_posted' } })).toBe(beforePosted);
    expect(await h.metrics.render()).toContain('mercenary_contracts_total 2');
    const before = await db.prisma.analyticsEvent.count();
    const off = harness(false);
    await off.telemetry.proposalOpened(PLANET, 'meteor_shield');
    await off.telemetry.bountyPosted('deliver_units');
    await off.telemetry.mercenaryHired();
    await expect(off.posts.post(bountyInput('bt_off', POSTER))).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
    expect(await db.prisma.analyticsEvent.count()).toBe(before);
    expect(await off.metrics.render()).not.toMatch(/treasury_proposals_total\{/);
  });
});

interface Story {
  readonly metrics: MetricsRegistry;
  readonly telemetry: W22TelemetryService;
  readonly proposals: TreasuryProposalsService;
  readonly dao: MockTreasuryDaoAdapter;
  readonly posts: BountyPostService;
  readonly claims: BountyClaimService;
  readonly pay: BountyPayService;
  readonly hires: MercenaryHireService;
  readonly intake: AnalyticsService;
  readonly cargo: MockCargoTokenAdapter;
}

function harness(on: boolean): Story {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: on ? '..22' : '..21' };
  const flags = new FlagsService(env as never);
  const metrics = new MetricsRegistry();
  const telemetry = new W22TelemetryService(metrics, flags, db.prisma, env as never);
  const dao = new MockTreasuryDaoAdapter(db.prisma, chain(), { sleep });
  const outbox = new ChainOutboxRepository(db.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, env as never);
  const proposals = new TreasuryProposalsService(flags, lifecycle, dao, db.prisma, env as never, outbox, undefined, undefined, telemetry);
  const world = ownedWorld();
  const cargo = new MockCargoTokenAdapter(db.prisma, chain(), { sleep });
  const escrow = new MockEscrowAdapter(db.prisma, chain(), { sleep });
  const repo = new BountyRepository(db.prisma);
  const posts = new BountyPostService(escrow, cargo, repo, outbox, { load: async () => world }, flags, telemetry);
  const claims = new BountyClaimService(repo, flags, telemetry);
  const pay = new BountyPayService(escrow, outbox, repo, flags, undefined, undefined, telemetry);
  const hires = new MercenaryHireService(posts, repo, escrow, outbox, flags, undefined, telemetry);
  const intake = new AnalyticsService(db.prisma, new AnalyticsCounters(metrics));
  return { metrics, telemetry, proposals, dao, posts, claims, pay, hires, intake, cargo };
}

function ownedWorld(): PlanetState {
  const world = createState({ planetId: PLANET, planetType: 'temperate', seed: 'w22-34', radius: 4 });
  const tile = hexIndex(world.grid.radius).indexOf(0, 0);
  if (tile < 0) throw new Error('origin tile missing');
  world.grid.layers.owner[tile] = 0;
  return world;
}

async function poorPropose(h: Story): Promise<void> {
  const daoId = (await h.proposals.council(POOR)).daoAccountId;
  await h.dao.deposit({ opId: 'dep:poor', daoAccountId: daoId, from: A, tokenId: TOKEN, amount: '100' });
}

async function council(h: Story): Promise<void> {
  const daoId = (await h.proposals.council(PLANET)).daoAccountId;
  await h.dao.deposit({ opId: 'dep:tel', daoAccountId: daoId, from: A, tokenId: TOKEN, amount: '2000' });
  for (const member of [A, B, C]) await h.dao.addMember({ opId: `add:${member}`, daoAccountId: daoId, member });
  const poorId = (await h.proposals.council(POOR)).daoAccountId;
  await h.dao.addMember({ opId: 'add:poor', daoAccountId: poorId, member: A });
  await expect(h.proposals.propose(POOR, { kind: 'meteor_shield', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'TREASURY_INSUFFICIENT' });
  const opened = await h.proposals.propose(PLANET, { kind: 'meteor_shield', colonyAccountId: A, description: 'Shield' }, req());
  expect(opened.state).toBe('InProgress');
  await expect(h.proposals.propose(PLANET, { kind: 'nuke', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'invalid_args' });
  await expect(h.proposals.vote(PLANET, String(opened.proposalId), { vote: 'approve', colonyAccountId: 'outsider.pilot.terraagent.mock' }, req())).rejects.toMatchObject({ errorCode: 'NOT_A_MEMBER' });
  const voted = await h.proposals.vote(PLANET, String(opened.proposalId), { vote: 'approve', colonyAccountId: A }, req());
  expect(voted.state).toBe('InProgress');
  await expect(h.proposals.vote(PLANET, String(opened.proposalId), { vote: 'approve', colonyAccountId: A }, req())).rejects.toMatchObject({ errorCode: 'ALREADY_VOTED' });
}

async function bounty(h: Story): Promise<void> {
  await h.cargo.mint({ opId: 'fund:poster', to: POSTER, tokenId: TOKEN, amount: toCargoBaseUnits(100), caller: CARGO_MINTER_ACCOUNT });
  await expect(h.posts.post(bountyInput('bt_bad', POSTER, { kind: 'clear_nest', nestId: '404' }))).rejects.toMatchObject({ errorCode: 'invalid_target' });
  const posted = await h.posts.post(bountyInput('bt_ok', POSTER));
  expect(posted.state).toBe('open');
  await h.claims.claim({ planetId: PLANET, bountyId: posted.id, accountId: CLAIMER });
  await expect(h.claims.claim({ planetId: PLANET, bountyId: posted.id, accountId: 'w2234-other.terraagent.mock' })).rejects.toMatchObject({ code: 'queue_full' });
  await db.prisma.chainBounty.update({ where: { id: posted.id }, data: { state: 'completed' } });
  expect(await h.pay.pay(posted.id)).toBe(true);
  expect(await h.pay.pay(posted.id)).toBe(true);
}

async function hire(h: Story, bountyId: string, accountId: string): Promise<void> {
  await h.cargo.mint({ opId: `fund:${bountyId}`, to: accountId, tokenId: TOKEN, amount: toCargoBaseUnits(500), caller: CARGO_MINTER_ACCOUNT });
  const hired = await h.hires.hire({
    planetId: PLANET, colonyId: `col_${bountyId}`, colonyIndex: 0, accountId, rosterId: 'light', hours: 2,
    q: 0, r: 0, bountyId, nowMs: NOW,
  });
  expect(hired.hours).toBe(2);
}

function bountyInput(bountyId: string, accountId: string, target?: { kind: 'clear_nest'; nestId: string }): BountyPostInput {
  return {
    planetId: PLANET, colonyId: 'col_post', colonyIndex: 0, accountId, bountyId, nowMs: NOW,
    args: {
      target: target ?? { kind: 'deliver_units', resource: 'bio.water', amount: 1 },
      reward: { resource: TOKEN, amount: 10 },
      expiresAt: NOW + 4 * HOUR_MS,
    },
  };
}

function req(): IncomingMessage {
  return { headers: {} } as IncomingMessage;
}
