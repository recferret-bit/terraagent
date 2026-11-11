import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUILD_VISIT_SLOT_MS, GuildSubsidyService } from '../../src/near/treasury/guild-subsidy.js';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

/** W15 is off. Only W22 enables a row. */
function service(w22: boolean): GuildSubsidyService {
  return new GuildSubsidyService(db.prisma, { has: (wave) => w22 && wave === 'W22' });
}

describe('guild subsidy visit (W22-12)', () => {
  it('apply once writes one subsidy visit that is not organic', async () => {
    const now = new Date('2026-11-10T12:00:00.000Z');
    expect(await service(true).applyGuildSubsidy('pl_subsidy_once', now)).toBe(true);
    const rows = await db.prisma.chainGuildVisit.findMany({ where: { planetId: 'pl_subsidy_once' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subsidy: true,
      organic: false,
      arrivesAt: new Date(now.getTime() + GUILD_VISIT_SLOT_MS),
    });
  });

  it('apply when W22 is off writes no row', async () => {
    expect(await service(false).applyGuildSubsidy('pl_subsidy_off')).toBe(false);
    expect(await db.prisma.chainGuildVisit.count({ where: { planetId: 'pl_subsidy_off' } })).toBe(0);
  });

  it('apply twice writes two visits and does not update the first', async () => {
    const firstAt = new Date('2026-11-10T13:00:00.000Z');
    const secondAt = new Date('2026-11-10T14:00:00.000Z');
    const hook = service(true);
    await hook.applyGuildSubsidy('pl_subsidy_twice', firstAt);
    await hook.applyGuildSubsidy('pl_subsidy_twice', secondAt);
    const rows = await db.prisma.chainGuildVisit.findMany({
      where: { planetId: 'pl_subsidy_twice' },
      orderBy: { arrivesAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).not.toBe(rows[1]?.id);
    expect(rows[0]?.arrivesAt.toISOString()).toBe(new Date(firstAt.getTime() + GUILD_VISIT_SLOT_MS).toISOString());
    expect(rows[1]?.arrivesAt.toISOString()).toBe(new Date(secondAt.getTime() + GUILD_VISIT_SLOT_MS).toISOString());
    expect(rows.every((row) => row.subsidy === true && row.organic === false)).toBe(true);
  });
});
