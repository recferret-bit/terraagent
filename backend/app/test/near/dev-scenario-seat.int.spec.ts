import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextFreeSeat, seatDevScenarioPlayer } from '../../src/near/identity/dev-scenario-seat.js';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

const indexOf = async (playerId: string, planetId: string): Promise<number | null> =>
  (await db.prisma.colony.findFirst({ where: { playerId, planetId }, select: { colonyIndex: true } }))?.colonyIndex ?? null;

describe('dev scenario seating (W13-30)', () => {
  it('picks the lowest scenario colony index that is free', () => {
    expect(nextFreeSeat([0, 1], new Set())).toBe(0);
    expect(nextFreeSeat([1, 0], new Set([0]))).toBe(1);
    expect(nextFreeSeat([0, 1], new Set([0, 1]))).toBeUndefined();
  });

  it('two dev sessions on a two-colony scenario get colony 0 and colony 1; a third stays unseated', async () => {
    const seat = (playerId: string) => seatDevScenarioPlayer(db.prisma, { playerId, handle: playerId, planetId: 'pl_two', colonyIndices: [0, 1] });
    await seat('dev-a');
    await seat('dev-b');
    await seat('dev-b'); // rejoin: unchanged
    await seat('dev-c');
    expect([await indexOf('dev-a', 'pl_two'), await indexOf('dev-b', 'pl_two'), await indexOf('dev-c', 'pl_two')]).toEqual([0, 1, null]);
  });

  it('a one-colony scenario keeps the old behaviour: the first session is colony 0, a second shares the synthetic colony 0', async () => {
    const seat = (playerId: string) => seatDevScenarioPlayer(db.prisma, { playerId, handle: playerId, planetId: 'pl_one' });
    await seat('dev-x');
    await seat('dev-y');
    expect([await indexOf('dev-x', 'pl_one'), await indexOf('dev-y', 'pl_one')]).toEqual([0, null]);
  });

  it('concurrent joins never take the same index', async () => {
    const seat = (playerId: string) => seatDevScenarioPlayer(db.prisma, { playerId, handle: playerId, planetId: 'pl_race', colonyIndices: [0, 1] });
    await Promise.all([seat('r1'), seat('r2')]);
    expect([await indexOf('r1', 'pl_race'), await indexOf('r2', 'pl_race')].sort()).toEqual([0, 1]);
  });
});
