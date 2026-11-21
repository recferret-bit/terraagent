import { describe, expect, it } from 'vitest';
import { PatronNominateRequest, PatronNominateService } from '../../src/near/staking/services/patron-nominate.service';

/** A DB double: planets by id, one nomination per wallet, no seats. */
function db(planets: Record<string, string>) {
  const noms = new Map<string, string>();
  return {
    noms,
    prisma: {
      planet: { findUnique: async ({ where }: { where: { id: string } }) => (planets[where.id] ? { id: where.id, admission: planets[where.id] } : null) },
      stakingPatronSeat: { findUnique: async () => null, deleteMany: async () => ({ count: 0 }), upsert: async () => undefined },
      stakingPatronNomination: {
        findUnique: async ({ where }: { where: { accountId: string } }) => (noms.has(where.accountId) ? { planetId: noms.get(where.accountId) } : null),
        findMany: async () => [],
        upsert: async ({ create, update }: { create: { accountId: string; planetId: string }; update: { planetId: string } }) => {
          noms.set(create.accountId, noms.has(create.accountId) ? update.planetId : create.planetId);
        },
      },
    },
  };
}

describe('W28-04 PatronNominateService', () => {
  it('validates the body strictly', () => {
    expect(PatronNominateRequest.safeParse({ accountId: 'a.near', planetId: 'p' }).success).toBe(true);
    expect(PatronNominateRequest.safeParse({ accountId: 'a.near' }).success).toBe(false);
    expect(PatronNominateRequest.safeParse({ accountId: 'a.near', planetId: 'p', extra: 1 }).success).toBe(false);
    expect(PatronNominateRequest.safeParse({ accountId: 'a', planetId: 'p' }).success).toBe(false);
  });

  it('nominates a public planet, re-nominating moves the wallet, and an empty seat is reported as no lead patron', async () => {
    const { prisma, noms } = db({ open: 'OPEN', paused: 'PAUSED' });
    const svc = new PatronNominateService(() => prisma as never, () => 1);
    expect(await svc.nominate('a.near', 'open')).toEqual({ accountId: 'a.near', planetId: 'open', isLeadPatron: false, leadPatron: null });
    await svc.nominate('a.near', 'paused');
    expect(noms.get('a.near')).toBe('paused');
  });

  it('refuses an archived or unknown planet (404) and a missing database (503)', async () => {
    const { prisma, noms } = db({ gone: 'ARCHIVED' });
    const svc = new PatronNominateService(() => prisma as never, () => 1);
    await expect(svc.nominate('a.near', 'gone')).rejects.toMatchObject({ status: 404 });
    await expect(svc.nominate('a.near', 'missing')).rejects.toMatchObject({ status: 404 });
    expect(noms.size).toBe(0);
    await expect(new PatronNominateService(() => null, () => 1).nominate('a.near', 'x')).rejects.toMatchObject({ errorCode: 'NEAR_UNAVAILABLE' });
  });
});
