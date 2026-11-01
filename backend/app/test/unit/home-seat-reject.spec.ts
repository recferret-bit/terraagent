import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { CoreException } from '../../src/core/errors';
import { HomeRepository, HomeService, type ColonySeatAssignment } from '../../src/core/home';
import { pickSpawnSlot, SEAT_ATTEMPTS, SEAT_PLANETS, siteKey } from '../../src/core/home/home.service';
import { seatAndRegisterColony, seatColonyOnPlanet } from '../../src/game/seat-colony';

const assignment = {
  player: { id: 'p_1', handle: 'A' },
  colony: { id: 'col_1', colonyIndex: 2, planetId: 'pl_dev' },
  planet: { id: 'pl_dev', type: 'desert', seed: 's', radius: 56, capacity: 5 },
  slot: { index: 2, q: 1, r: 1 },
} as unknown as ColonySeatAssignment;

function fakePlanets(outcome: { ok: true; commandId: string; appliedAtTick: number } | { ok: false; commandId: string; code: string }) {
  const submitted: unknown[] = [];
  return {
    submitted,
    ensureLoaded: async () => 0,
    submit: async (_planetId: string, cmd: unknown) => { submitted.push(cmd); return outcome; },
  };
}

describe('seatColonyOnPlanet: a sim reject of system.spawnColony is not a seat', () => {
  it('resolves when the sim acks the landing', async () => {
    const planets = fakePlanets({ ok: true, commandId: 'cm_1', appliedAtTick: 3 });
    await expect(seatColonyOnPlanet(planets, assignment)).resolves.toBeUndefined();
    expect(planets.submitted).toMatchObject([{ kind: 'system.spawnColony', colonyIndex: 2 }]);
  });
  it.each(['already_landed', 'landing_site_taken'])('throws 409 COLONY_SEAT_REJECTED carrying the sim code %s', async (code) => {
    const err = (await seatColonyOnPlanet(fakePlanets({ ok: false, commandId: 'cm_1', code }), assignment).catch((e: unknown) => e)) as CoreException;
    expect(err.errorCode).toBe('COLONY_SEAT_REJECTED');
    expect(err.status).toBe(409);
    expect(err.details).toMatchObject({ code, planetId: 'pl_dev', colonyId: 'col_1', colonyIndex: 2 });
  });
});

describe('HomeService.getOrAssignHome when the landing is rejected', () => {
  it('surfaces the error, rolls the colony back, and seats normally on the next call', async () => {
    const repo = new HomeRepository(); // in-memory
    const home = new HomeService(repo);
    let reject = true;
    home.onColonySeated(async (a) => {
      if (reject) await seatColonyOnPlanet(fakePlanets({ ok: false, commandId: 'cm', code: 'already_landed' }), a);
    });
    const err = (await home.getOrAssignHome({ id: 'p_rej', handle: 'Rej' }).catch((e: unknown) => e)) as CoreException;
    expect(err.errorCode).toBe('COLONY_SEAT_REJECTED');
    expect(await repo.findLatestColonyByPlayerId('p_rej')).toBeNull();
    expect((await repo.findPlanetById('pl_dev'))?.seatsTaken).toBe(0);

    reject = false;
    const ok = await home.getOrAssignHome({ id: 'p_rej', handle: 'Rej' });
    expect(ok.state).toBe('ACTIVE');
    expect((await repo.findPlanetById('pl_dev'))?.seatsTaken).toBe(1);
  });
});

describe('HomeService.getOrAssignHome retries another slot on landing_site_taken', () => {
  /** A home service whose sim answers each landing with the next code of `codes` (then accepts). */
  function seatWith(codes: string[]) {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    const tried: ColonySeatAssignment[] = [];
    home.onColonySeated(async (a) => {
      tried.push(a);
      const code = codes.shift();
      await seatColonyOnPlanet(fakePlanets(code ? { ok: false, commandId: 'cm', code } : { ok: true, commandId: 'cm', appliedAtTick: 1 }), a);
    });
    return { repo, home, tried };
  }

  it('seats on the next free slot when the sim refuses the first site', async () => {
    const { repo, home, tried } = seatWith(['landing_site_taken']);
    const ok = await home.getOrAssignHome({ id: 'p_retry', handle: 'Re' });
    expect(ok.state).toBe('ACTIVE');
    expect(tried).toHaveLength(2);
    const [first, second] = tried.map((a) => a.slot);
    expect([second!.q, second!.r]).not.toEqual([first!.q, first!.r]);
    expect(ok).toMatchObject({ colony: { spawnQ: second!.q, spawnR: second!.r } });
    expect(tried[0]!.colony.colonyIndex).toBe(tried[1]!.colony.colonyIndex);
    expect(await repo.findColonyById(tried[0]!.colony.id)).toBeNull(); // the refused row was rolled back
    expect((await repo.findPlanetById('pl_dev'))?.seatsTaken).toBe(1);
  });

  it('tries each candidate site once, marks a planet without one left and moves on; 409 once SEAT_PLANETS are exhausted', async () => {
    const { repo, home, tried } = seatWith(Array(100).fill('landing_site_taken'));
    const err = (await home.getOrAssignHome({ id: 'p_full', handle: 'Full' }).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ status: 409, errorCode: 'COLONY_SEAT_REJECTED', details: { code: 'landing_site_taken', planetIds: ['pl_dev', 'pl_dev_2'] } });
    expect(err.message).toMatch(/no landing site left on pl_dev, pl_dev_2/);
    const perPlanet = (id: string) => tried.filter((a) => a.planet.id === id).map((a) => `${a.slot.q},${a.slot.r}`);
    for (const id of ['pl_dev', 'pl_dev_2']) {
      expect(perPlanet(id).length).toBeGreaterThan(1);
      expect(perPlanet(id).length).toBeLessThanOrEqual(SEAT_ATTEMPTS);
      expect(new Set(perPlanet(id)).size).toBe(perPlanet(id).length); // never the same site twice
    }
    expect(tried).toHaveLength(perPlanet('pl_dev').length + perPlanet('pl_dev_2').length);
    expect(await repo.findLatestColonyByPlayerId('p_full')).toBeNull();
    expect((await repo.findPlanetById('pl_dev'))?.seatsTaken).toBe(0);
    expect(SEAT_PLANETS).toBe(2);
  });

  it('remembers refused sites: a later request never offers them again, and skips an exhausted planet', async () => {
    const { home, tried } = seatWith(['landing_site_taken', 'invalid_args']);
    await home.getOrAssignHome({ id: 'p_a', handle: 'A' }).catch(() => undefined);
    const [refused, failed] = tried.map((a) => `${a.slot.q},${a.slot.r}`);
    const ok = await home.getOrAssignHome({ id: 'p_a', handle: 'A' });
    expect(ok.state).toBe('ACTIVE');
    expect(tried).toHaveLength(3);
    expect(`${tried[2]!.slot.q},${tried[2]!.slot.r}`).toBe(failed); // the refused site is skipped; the other is not refused
    expect(refused).not.toBe(failed);

    const full = seatWith(Array(100).fill('landing_site_taken'));
    await full.home.getOrAssignHome({ id: 'p_b', handle: 'B' }).catch(() => undefined);
    const before = full.tried.length;
    await full.home.getOrAssignHome({ id: 'p_b', handle: 'B' }).catch(() => undefined);
    expect(full.tried.slice(before).every((a) => a.planet.id !== 'pl_dev' && a.planet.id !== 'pl_dev_2')).toBe(true);
    expect(full.tried.slice(before)[0]!.planet.id).toBe('pl_dev_3');
  });

  it.each(['already_landed', 'invalid_args'])('does not retry %s', async (code) => {
    const { home, tried } = seatWith([code]);
    const err = (await home.getOrAssignHome({ id: `p_${code}`, handle: 'No' }).catch((e: unknown) => e)) as CoreException;
    expect(err.details).toMatchObject({ code });
    expect(tried).toHaveLength(1);
  });
});

describe('seatAndRegisterColony (the game module\'s seat listener)', () => {
  const forwarder = () => {
    const map = new Map<string, string>();
    return { map, registerColony: (c: string, p: string) => { map.set(c, p); }, unregisterColony: (c: string) => { map.delete(c); } };
  };
  const seated = { ...assignment, colony: { ...assignment.colony, playerId: 'p_1' } } as ColonySeatAssignment;

  it('keeps the colony registered with the progression forwarder when the landing is acked', async () => {
    const f = forwarder();
    await seatAndRegisterColony(f, fakePlanets({ ok: true, commandId: 'cm', appliedAtTick: 1 }), seated);
    expect([...f.map]).toEqual([['col_1', 'p_1']]);
  });

  it('unregisters it again when the sim rejects the landing (the seat is rolled back)', async () => {
    const f = forwarder();
    const err = (await seatAndRegisterColony(f, fakePlanets({ ok: false, commandId: 'cm', code: 'landing_site_taken' }), seated).catch((e: unknown) => e)) as CoreException;
    expect(err.errorCode).toBe('COLONY_SEAT_REJECTED');
    expect(f.map.size).toBe(0);
  });
});

describe('pickSpawnSlot with refused sites', () => {
  const slots = [{ index: 0, q: 10, r: 0 }, { index: 1, q: -10, r: 0 }, { index: 2, q: 0, r: 10 }];
  it('skips a refused site even when it is the preferred one, and its fallback never offers one', () => {
    const refused = new Set([siteKey(slots[1]!)]);
    expect(pickSpawnSlot(slots, 1, [], false, refused)).toBe(slots[0]);
    const all = new Set(slots.map(siteKey));
    expect(pickSpawnSlot(slots, 1, [], true, all)).toBeUndefined();
    // every slot too close to a landing: the fallback still offers the first site the sim has not refused
    const landed = slots.map((s) => ({ q: s.q, r: s.r }));
    expect(pickSpawnSlot(slots, 0, landed, true, new Set([siteKey(slots[0]!)]))).toBe(slots[1]);
  });
});

describe('seatColonyOnPlanet: a host that cannot land the colony (M4)', () => {
  const hanging = () => {
    let answer!: (out: { ok: true; commandId: string; appliedAtTick: number }) => void;
    const late: Array<[string, number]> = [];
    const host = {
      ensureLoaded: async () => 0,
      submit: () => new Promise<{ ok: true; commandId: string; appliedAtTick: number }>((r) => { answer = r; }),
      onLateLanding: (a: ColonySeatAssignment, tick: number) => { late.push([a.colony.id, tick]); },
    };
    return { host, late, answer: (tick: number) => answer({ ok: true, commandId: 'cm', appliedAtTick: tick }) };
  };

  it('a landing not answered in time is host_unavailable; a late ack is reported, not silently kept', async () => {
    const h = hanging();
    const err = (await seatColonyOnPlanet(h.host, assignment, 20).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ errorCode: 'COLONY_SEAT_REJECTED', status: 409, details: { code: 'host_unavailable', colonyId: 'col_1' } });
    expect(err.message).toMatch(/not answered within 20 ms/);
    h.answer(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.late).toEqual([['col_1', 7]]);
  });

  it('a planet that does not load in time, or cannot be loaded, is host_unavailable', async () => {
    const slow = { ensureLoaded: () => new Promise(() => {}), submit: async () => ({ ok: true as const, commandId: 'c', appliedAtTick: 1 }) };
    expect(await seatColonyOnPlanet(slow, assignment, 20).catch((e: unknown) => e)).toMatchObject({ details: { code: 'host_unavailable' } });
    const held = { ensureLoaded: async () => { throw new Error('has snapshots'); }, submit: slow.submit };
    const err = (await seatColonyOnPlanet(held, assignment).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ details: { code: 'host_unavailable' } });
    expect(err.message).toMatch(/has snapshots/);
  });

  it.each(['thread_down', 'planet_not_loaded'])('maps the host-side reject %s to host_unavailable (the original in details.cause)', async (code) => {
    const err = (await seatColonyOnPlanet(fakePlanets({ ok: false, commandId: 'cm', code }), assignment).catch((e: unknown) => e)) as CoreException;
    expect(err.details).toMatchObject({ code: 'host_unavailable', cause: code });
  });

  it('HomeService rolls a timed-out seat back and does not retry it', async () => {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    let tries = 0;
    home.onColonySeated(async (a) => { tries++; await seatColonyOnPlanet(hanging().host, a, 20); });
    const err = (await home.getOrAssignHome({ id: 'p_slow', handle: 'Slow' }).catch((e: unknown) => e)) as CoreException;
    expect(err.details).toMatchObject({ code: 'host_unavailable' });
    expect(tries).toBe(1);
    expect(await repo.findLatestColonyByPlayerId('p_slow')).toBeNull();
  });
});
