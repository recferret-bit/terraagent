import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { ACHIEVEMENT_FAMILY_IDS, type ProgressEventV1 } from '@terra/contracts';
import { createPlanet, snapshot } from '@terra/sim';
import { CheckpointProgression } from '../../src/progression/checkpoint-progression.js';
import { ProgressionEngine } from '../../src/progression/progression-engine.js';
import { SnapshotStore } from '../../src/game/persistence/snapshot-store.js';
import type { FamilyAvailabilityService } from '../../src/progression/family-availability.js';
import { ProgressionEffects } from '../../src/progression/progression-effects.js';
import { ProgressionConsumers } from '../../src/progression/effect-consumers.js';
import { MockBadgeNftAdapter } from '../../src/near/infrastructure/adapters/badge-nft/mock-badge-nft.adapter.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { projectColonies } from '../../src/game/persistence/colony-projection.js';

let db: TestDatabase;
const availability = { availableFamilies: () => new Set(ACHIEVEMENT_FAMILY_IDS) } as FamilyAvailabilityService;
const env = { NODE_ENV: 'test', SNAPSHOTS: 'on' } as never;
const engine = () => new ProgressionEngine(db.prisma, availability);
const ingress = () => new CheckpointProgression(db.prisma, engine(), env);
const input = (id: string, tick = 1): ProgressEventV1 => ({ eventId: id, playerId: id, colonyId: 'c', planetId: id, atTick: tick, family: 'first-landfall', metric: 'counter', value: 1 });
const raw = (id: string) => snapshot(createPlanet({ type: 'flat', planetId: id, seed: id }));
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

describe('checkpoint-coupled progression ingress', () => {
  it('does not award before checkpoint; persists then replays with a fresh worker', async () => {
    const p = ingress();
    p.stage(input('checkpoint'));
    p.stage(input('checkpoint', 5));
    await p.replay();
    expect(await db.prisma.playerFact.count()).toBe(0);
    await new SnapshotStore(db.prisma, p).save('checkpoint', 1, 'PERIODIC', raw('checkpoint'));
    expect(p.batch('checkpoint', 10)).toHaveLength(1);
    expect(await db.prisma.progressionInbox.count()).toBe(1);
    const row = await db.prisma.progressionInbox.findFirstOrThrow();
    await ingress().replay();
    // Crash after reward commit but before inbox acknowledgement: replay is still exactly once.
    await db.prisma.progressionInbox.create({ data: { ...row, payload: row.payload as object } });
    await ingress().replay();
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'checkpoint' } })).toMatchObject({ value: 1 });
    expect(await db.prisma.progressionInbox.count()).toBe(0);
    p.discardUncommitted('checkpoint');
    expect(p.batch('checkpoint', 10)).toEqual([]);
  });

  it('rolls the snapshot back when inbox persistence fails and retains the pending input', async () => {
    const p = ingress();
    p.stage(input('atomic'));
    const fail = vi.spyOn(p, 'persist').mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(new SnapshotStore(db.prisma, p).save('atomic', 1, 'PERIODIC', raw('atomic'))).rejects.toThrow('storage unavailable');
    expect(await db.prisma.planetSnapshot.count({ where: { planetId: 'atomic' } })).toBe(0);
    expect(p.batch('atomic', 1)).toHaveLength(1);
    fail.mockRestore();
    await new SnapshotStore(db.prisma, p).save('atomic', 1, 'PERIODIC', raw('atomic'));
    expect(p.batch('atomic', 1)).toEqual([]);
    await ingress().replay();
  });

  it('changes source identity when a planet is wiped and recreated', async () => {
    const p = ingress();
    const store = new SnapshotStore(db.prisma, p);
    for (let i = 0; i < 2; i++) {
      p.stage(input('incarnation'));
      await store.save('incarnation', 1, 'PERIODIC', raw('incarnation'));
      await p.replay();
      await store.wipePlanet('incarnation');
    }
    expect(await db.prisma.playerFact.findFirst({ where: { playerId: 'incarnation' } })).toMatchObject({ value: 2 });
  });

  it('projects explicit stages and archives lifecycle outcomes idempotently', async () => {
    await db.prisma.planet.create({ data: { id: 'archive', name: 'Archive' } });
    await db.prisma.colony.create({ data: { id: 'archive-colony', playerId: 'archivist', planetId: 'archive', colonyIndex: 0, name: 'A' } });
    const colony = { id: 'archive-colony', status: 'settled', stage: 4 } as never;
    for (let i = 0; i < 2; i++) await db.prisma.$transaction(tx => projectColonies(tx, 'archive', [colony]));
    expect(await db.prisma.colony.findUnique({ where: { id: 'archive-colony' } })).toMatchObject({ stage: 4, status: 'SETTLED' });
    expect(await db.prisma.colonyHistory.findMany({ where: { playerId: 'archivist' } })).toMatchObject([{ stageReached: 4, outcome: 'settled' }]);
  });
});

describe('delivered rewards', () => {
  it('catches up when a family becomes available without new facts or duplicate XP', async () => {
    const off = new ProgressionEngine(db.prisma, { availableFamilies: () => new Set() } as unknown as FamilyAvailabilityService);
    await off.apply(input('catchup'));
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'catchup' } })).toBe(0);
    await Promise.all([engine().catchUp('catchup'), engine().catchUp('catchup')]);
    expect(await db.prisma.achievementUnlock.count({ where: { playerId: 'catchup' } })).toBe(1);
    expect(await db.prisma.xpLedger.count({ where: { playerId: 'catchup' } })).toBe(1);
  });

  it('delivers notifications immediately, delays badges one hour, and retries after identity linking', async () => {
    await engine().apply(input('recipient'));
    const badges = new MockBadgeNftAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 });
    const mint = vi.spyOn(badges, 'mint');
    const consumer = () => new ProgressionConsumers(db.prisma, new ProgressionEffects(db.prisma), env, new FlagsService({ TA_WAVES: 'all' } as never), badges);
    await consumer().drain();
    expect(mint).not.toHaveBeenCalled();
    expect(await db.prisma.playerNotification.count({ where: { playerId: 'recipient' } })).toBe(1);
    await consumer().drain(new Date(Date.now() + 3601_000));
    expect(mint).not.toHaveBeenCalled();
    await db.prisma.socialIdentity.create({ data: { id: 'identity', playerId: 'recipient', provider: 'google', subject: 'recipient', accountId: 'recipient.testnet' } });
    await consumer().drain(new Date(Date.now() + 7200_000));
    const unlock = await db.prisma.achievementUnlock.findFirstOrThrow({ where: { playerId: 'recipient' } });
    expect(unlock.nftStatus).toBe('minted');
    expect(await badges.ownerOf({ collection: 'badge', tokenId: unlock.nftTokenId! })).toBe('recipient.testnet');
    await consumer().drain(new Date(Date.now() + 10800_000));
    expect(mint).toHaveBeenCalledTimes(1);
    // Simulate a crash after the external mint, before recording completion locally.
    await db.prisma.achievementUnlock.update({ where: { id: unlock.id }, data: { nftStatus: 'pending', nftTokenId: null } });
    await db.prisma.progressionEffect.updateMany({ where: { playerId: 'recipient', kind: 'achievement.badge' }, data: { completedAt: null, availableAt: new Date(0) } });
    await consumer().drain();
    expect(mint).toHaveBeenCalledTimes(2);
    expect(await db.prisma.mockChainNft.count({ where: { ownerAccountId: 'recipient.testnet' } })).toBe(1);
    expect(await db.prisma.achievementUnlock.findUnique({ where: { id: unlock.id } })).toMatchObject({ nftStatus: 'minted', nftTokenId: unlock.nftTokenId });
    expect(await db.prisma.playerNotification.count({ where: { playerId: 'recipient' } })).toBe(1);
  });
});
