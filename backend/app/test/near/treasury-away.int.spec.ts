import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import type { IncomingMessage } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { MockTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/mock/treasury.adapter';
import { PlanetDaoLifecycleService } from '../../src/near/treasury/lifecycle.service';
import { TreasuryAwayNoticeService } from '../../src/near/treasury/away-notice.service';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';
import { TreasuryController } from '../../src/near/treasury/treasury.controller';
import { MockNotifierAdapter } from '../../src/notify/adapters/mock-notifier.adapter';

const TOKEN = 'metals.t1';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => { await db?.drop(); });

interface Seat {
  readonly colonyId: string;
  readonly accountId: string;
  readonly playerId: string;
  readonly index: number;
  readonly away?: boolean;
}

interface Harness {
  readonly controller: TreasuryController;
  readonly notice: TreasuryAwayNoticeService;
}

function harness(taWaves: string): Harness {
  const env = { NODE_ENV: 'test', DATABASE_URL: db.url, TA_WAVES: taWaves };
  const flags = new FlagsService(env as never);
  const dao = new MockTreasuryDaoAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 16 },
    { sleep: async () => undefined },
  );
  const outbox = new ChainOutboxRepository(db.prisma);
  const lifecycle = new PlanetDaoLifecycleService(flags, dao, outbox, db.prisma, env as never);
  const proposals = new TreasuryProposalsService(flags, lifecycle, dao, db.prisma, env as never, outbox);
  const notifier = new MockNotifierAdapter(db.prisma, { isConnected: () => false });
  const notice = new TreasuryAwayNoticeService(flags, db.prisma, notifier, env as never);
  return { controller: new TreasuryController(proposals, flags), notice };
}

function req(): IncomingMessage {
  return { headers: {} } as IncomingMessage;
}

async function fundAndSeat(h: Harness, planetId: string, members: readonly string[]): Promise<void> {
  const council = await h.controller.council(planetId);
  const dao = new MockTreasuryDaoAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 16 },
    { sleep: async () => undefined },
  );
  await dao.deposit({
    opId: `dep:${planetId}`,
    daoAccountId: council.daoAccountId,
    from: members[0] ?? 'funder.pilot.terraagent.mock',
    tokenId: TOKEN,
    amount: '5000',
  });
  for (const member of members) {
    await dao.addMember({ opId: `add:${planetId}:${member}`, daoAccountId: council.daoAccountId, member });
  }
}

async function linkColony(planetId: string, seat: Seat): Promise<void> {
  await db.prisma.player.create({ data: { id: seat.playerId, handle: seat.playerId } });
  await db.prisma.planet.upsert({
    where: { id: planetId },
    create: { id: planetId, name: planetId },
    update: {},
  });
  await db.prisma.colony.create({
    data: {
      id: seat.colonyId, playerId: seat.playerId, planetId, colonyIndex: seat.index, name: seat.colonyId,
    },
  });
  await db.prisma.nearColonyAccount.create({
    data: {
      accountId: seat.accountId,
      playerId: seat.playerId,
      slot: seat.colonyId,
      colonyId: seat.colonyId,
      ownerAccountId: 'pilot.terraagent.mock',
      publicKey: 'ed25519:test',
      encryptedSecret: 'cipher',
      kekVersion: 1,
    },
  });
  if (!seat.away) return;
  await db.prisma.planetEventDigest.create({
    data: {
      colonyId: seat.colonyId,
      planetId,
      openedAt: new Date('2026-11-10T12:00:00.000Z'),
      body: { colonyId: seat.colonyId },
    },
  });
}

function propose(h: Harness, planetId: string, accountId: string, kind: string): Promise<{ proposalId: number }> {
  return h.controller.propose(planetId, { kind, colonyAccountId: accountId, description: kind }, req());
}

async function voters(h: Harness, planetId: string): Promise<string[]> {
  const council = await h.controller.council(planetId);
  return council.proposals.flatMap((row) => row.votes.map((vote) => vote.voter));
}

function notes(colonyId: string): Promise<{ kind: string; payload: unknown }[]> {
  return db.prisma.mockNotify.findMany({ where: { colonyId }, orderBy: { id: 'asc' } });
}

function noteBody(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'body' in payload && typeof payload.body === 'string'
    ? payload.body
    : '';
}

describe('W22-16 away colonies abstain positive', () => {
  it('leaves the away colony unvoted after the notice job and still lets a present colony vote', async () => {
    const h = harness('..22');
    const planetId = 'pl-away-pos';
    const present = { colonyId: 'col_pos_a', accountId: 'pos-a.pilot.terraagent.mock', playerId: 'player_pos_a', index: 0 };
    const away = {
      colonyId: 'col_pos_b', accountId: 'pos-b.pilot.terraagent.mock', playerId: 'player_pos_b', index: 1, away: true,
    };
    await linkColony(planetId, present);
    await linkColony(planetId, away);
    await fundAndSeat(h, planetId, [present.accountId, away.accountId]);
    const opened = await propose(h, planetId, present.accountId, 'meteor_shield');

    const first = await h.notice.notifyDue(planetId);
    expect(first).toEqual({ notified: 1 });
    expect(await voters(h, planetId)).not.toContain(away.accountId);

    const queued = await notes(away.colonyId);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.kind).toBe('council_proposal');
    expect(noteBody(queued[0]?.payload)).toBe('Planet council: 1 open proposal');
    expect(await notes(present.colonyId)).toHaveLength(0);

    const id = String(opened.proposalId);
    const cast = await h.controller.vote(planetId, id, { vote: 'approve', colonyAccountId: present.accountId }, req());
    expect(cast).toMatchObject({ yes: 1, state: 'InProgress' });
    expect(await voters(h, planetId)).toEqual([present.accountId]);
    await expect(h.controller.vote(planetId, id, { vote: 'approve', colonyAccountId: away.accountId }, req()))
      .rejects.toMatchObject({ errorCode: 'away_policy', status: 409 });
    expect(await voters(h, planetId)).toEqual([present.accountId]);
  });
});

describe('W22-16 away colonies abstain negative', () => {
  it('queues no notification when W09 is off and still does not vote for the away colony', async () => {
    const h = harness('W22');
    const planetId = 'pl-away-off';
    const present = { colonyId: 'col_off_a', accountId: 'off-a.pilot.terraagent.mock', playerId: 'player_off_a', index: 0 };
    const away = {
      colonyId: 'col_off_b', accountId: 'off-b.pilot.terraagent.mock', playerId: 'player_off_b', index: 1, away: true,
    };
    await linkColony(planetId, present);
    await linkColony(planetId, away);
    await fundAndSeat(h, planetId, [present.accountId, away.accountId]);
    const opened = await propose(h, planetId, present.accountId, 'terraform_boost');

    expect(await h.notice.notifyDue(planetId)).toEqual({ notified: 0 });
    expect(await notes(away.colonyId)).toHaveLength(0);
    expect(await voters(h, planetId)).not.toContain(away.accountId);
    const id = String(opened.proposalId);
    await expect(h.controller.vote(planetId, id, { vote: 'reject', colonyAccountId: away.accountId }, req()))
      .rejects.toMatchObject({ errorCode: 'away_policy', status: 409 });
    const cast = await h.controller.vote(planetId, id, { vote: 'approve', colonyAccountId: present.accountId }, req());
    expect(cast.yes).toBe(1);
    expect(await voters(h, planetId)).toEqual([present.accountId]);
  });
});

describe('W22-16 away colonies abstain corner', () => {
  it('queues one note for two open proposals and does not insert a second row', async () => {
    const h = harness('..22');
    const planetId = 'pl-away-two';
    const present = { colonyId: 'col_two_a', accountId: 'two-a.pilot.terraagent.mock', playerId: 'player_two_a', index: 0 };
    const away = {
      colonyId: 'col_two_b', accountId: 'two-b.pilot.terraagent.mock', playerId: 'player_two_b', index: 1, away: true,
    };
    const other = { colonyId: 'col_two_c', accountId: 'two-c.pilot.terraagent.mock', playerId: 'player_two_c', index: 2 };
    await linkColony(planetId, present);
    await linkColony(planetId, away);
    await linkColony(planetId, other);
    await fundAndSeat(h, planetId, [present.accountId, away.accountId, other.accountId]);
    await propose(h, planetId, present.accountId, 'meteor_shield');
    await propose(h, planetId, other.accountId, 'guild_subsidy');

    expect(await h.notice.notifyDue(planetId)).toEqual({ notified: 1 });
    const again = await h.notice.notifyDue(planetId);
    expect(again.notified).toBe(1);
    const queued = await notes(away.colonyId);
    expect(queued).toHaveLength(1);
    expect(noteBody(queued[0]?.payload)).toBe('Planet council: 2 open proposals');
    expect(await voters(h, planetId)).not.toContain(away.accountId);
    expect((await h.controller.council(planetId)).proposals).toHaveLength(2);
  });
});
