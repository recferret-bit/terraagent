import { AWAY_AFTER_S, type SimCommandV1 } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ManualPresenceClock } from '../../src/game/presence/clock';
import { PrismaLastSeen } from '../../src/game/presence/last-seen';
import { PresenceTracker } from '../../src/game/presence/tracker';

const AWAY_MS = AWAY_AFTER_S * 1000;

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.prisma.player.create({ data: { id: 'pr_presence', handle: 'presence-pilot' } });
  await db.prisma.planet.create({ data: { id: 'pl_presence', name: 'Presence' } });
  await db.prisma.colony.create({
    data: { id: 'col_presence', playerId: 'pr_presence', planetId: 'pl_presence', colonyIndex: 4, name: 'Home' },
  });
});

afterAll(async () => {
  await db?.drop();
});

function trackerFor(codes: string[]) {
  const clock = new ManualPresenceClock();
  const posted: SimCommandV1[] = [];
  const tracker = new PresenceTracker({
    clock,
    lastSeen: new PrismaLastSeen(db.prisma),
    commands: {
      async submit(_planetId, cmd) {
        posted.push(cmd);
        const code = codes.shift();
        return code ? { ok: false, code } : { ok: true };
      },
    },
  });
  return { clock, posted, tracker };
}

describe('presence last_seen_at', () => {
  it('leaves last_seen_at null on a 30s blip', async () => {
    const { clock, posted, tracker } = trackerFor([]);
    tracker.join({ socketId: 'a', planetId: 'pl_presence', colonyId: 'col_presence', playerId: 'pr_presence' });
    tracker.close('a');
    clock.advance(30_000);
    tracker.join({ socketId: 'b', planetId: 'pl_presence', colonyId: 'col_presence', playerId: 'pr_presence' });
    await tracker.settled();
    const colony = await db.prisma.colony.findUniqueOrThrow({ where: { id: 'col_presence' } });
    const player = await db.prisma.player.findUniqueOrThrow({ where: { id: 'pr_presence' } });
    expect(posted).toEqual([]);
    expect(colony.lastSeenAt).toBeNull();
    expect(player.lastSeenAt).toBeNull();
  });

  it('stamps colony and player last_seen_at at the 60s boundary, including when the sim is wave_disabled', async () => {
    const { clock, posted, tracker } = trackerFor(['wave_disabled']);
    tracker.join({ socketId: 'c', planetId: 'pl_presence', colonyId: 'col_presence', playerId: 'pr_presence' });
    tracker.close('c');
    clock.advance(AWAY_MS);
    await tracker.settled();
    const colony = await db.prisma.colony.findUniqueOrThrow({ where: { id: 'col_presence' } });
    const player = await db.prisma.player.findUniqueOrThrow({ where: { id: 'pr_presence' } });
    const at = new Date(AWAY_MS).toISOString();
    expect(colony.lastSeenAt?.toISOString()).toBe(at);
    expect(player.lastSeenAt?.toISOString()).toBe(at);
    expect(posted[0]).toMatchObject({
      source: 'system',
      kind: 'system.presence',
      colonyIndex: 4,
      args: { colonyId: 'col_presence', away: true },
    });
  });

  it('does not throw when the colony row is missing', async () => {
    const { clock, tracker } = trackerFor([]);
    tracker.join({ socketId: 'z', planetId: 'pl_presence', colonyId: 'col_missing', playerId: 'pr_missing' });
    tracker.close('z');
    clock.advance(70_000);
    await expect(tracker.settled()).resolves.toBeUndefined();
  });
});
