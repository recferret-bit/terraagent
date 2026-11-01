import 'reflect-metadata';
import { DEV_PLANET_CAPACITY, MAX_COLONIES_PER_PLANET } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import type { CoreException } from '../../src/core/errors';
import { HomeRepository, HomeService, type ColonySeatAssignment } from '../../src/core/home';
import { type HomeLandingHost, type HomeLandingSite, SEAT_PLANETS } from '../../src/core/home/home.service';
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

/** A landing host whose sim answers `site(planetId, colonyIndex)` (default: a site per index), recording the questions. */
function landingHost(site: (planetId: string, colonyIndex: number) => HomeLandingSite = (_p, i) => ({ ok: true, q: 10 + i, r: -i, slotIndex: i })) {
  const asked: string[] = [];
  const loaded: string[] = [];
  const host: HomeLandingHost = {
    landingSite: async (planet, colonyIndex) => { asked.push(`${planet.id}#${colonyIndex}`); return site(planet.id, colonyIndex); },
    ensureHomeLoaded: async (planet) => { loaded.push(planet.id); },
  };
  return { host, asked, loaded };
}

function homeService(site?: Parameters<typeof landingHost>[0]) {
  const repo = new HomeRepository(); // in-memory
  const home = new HomeService(repo);
  const lh = landingHost(site);
  home.setLandingHost(lh.host);
  const landed: ColonySeatAssignment[] = [];
  home.onColonySeated((a) => { landed.push(a); });
  return { repo, home, landed, ...lh };
}

describe('HomeService.getOrAssignHome when the landing is rejected', () => {
  it('surfaces the error, rolls the colony back, and seats normally on the next call', async () => {
    const { repo, home } = homeService();
    let reject = true;
    home.onColonySeated(async (a) => {
      if (reject) await seatColonyOnPlanet(fakePlanets({ ok: false, commandId: 'cm', code: 'invalid_args' }), a);
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

describe('HomeService seats where the planet\'s sim says (LED-14)', () => {
  it('writes the colony row at the site the sim answered and lands it there', async () => {
    const { home, asked, landed } = homeService();
    const ok = await home.getOrAssignHome({ id: 'p_site', handle: 'Site' });
    expect(asked).toEqual(['pl_dev#0']);
    expect(ok).toMatchObject({ state: 'ACTIVE', colony: { colonyIndex: 0, spawnQ: 10, spawnR: -0 } });
    expect(landed.map((a) => a.slot)).toEqual([{ index: 0, q: 10, r: -0 }]);
  });

  it('a planet whose sim has no site left is marked and never asked again; 409 once SEAT_PLANETS are exhausted', async () => {
    const { home, asked } = homeService(() => ({ ok: false, code: 'landing_site_taken' }));
    const err = (await home.getOrAssignHome({ id: 'p_full', handle: 'Full' }).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ status: 409, errorCode: 'COLONY_SEAT_REJECTED', details: { code: 'landing_site_taken', planetIds: ['pl_dev', 'pl_dev_2'] } });
    expect(err.message).toMatch(/no landing site left on pl_dev, pl_dev_2/);
    expect(asked).toEqual(['pl_dev#0', 'pl_dev_2#0']);
    expect(SEAT_PLANETS).toBe(2);
    await home.getOrAssignHome({ id: 'p_full', handle: 'Full' }).catch(() => undefined);
    expect(asked.slice(2)).toEqual(['pl_dev_3#0', 'pl_dev_4#0']);
  });

  it('skips a colony index the sim already landed (a late landing, LED-15) and seats the next one', async () => {
    const { home, asked } = homeService((_p, i) => (i === 0 ? { ok: false, code: 'already_landed' } : { ok: true, q: 3, r: 4 }));
    const ok = await home.getOrAssignHome({ id: 'p_idx', handle: 'Idx' });
    expect(ok).toMatchObject({ state: 'ACTIVE', colony: { colonyIndex: 1, spawnQ: 3, spawnR: 4 } });
    expect(asked).toEqual(['pl_dev#0', 'pl_dev#1']);
    await home.getOrAssignHome({ id: 'p_idx2', handle: 'Idx2' });
    expect(asked.slice(2)).toEqual(['pl_dev#2']); // index 0 is remembered as landed
  });

  it('a sim refusal of the landing itself retries with a new question; other rejects propagate unretried', async () => {
    const codes = ['landing_site_taken'];
    const { home, asked } = homeService();
    home.onColonySeated(async (a) => {
      const code = codes.shift();
      await seatColonyOnPlanet(fakePlanets(code ? { ok: false, commandId: 'cm', code } : { ok: true, commandId: 'cm', appliedAtTick: 1 }), a);
    });
    expect((await home.getOrAssignHome({ id: 'p_race', handle: 'Race' })).state).toBe('ACTIVE');
    expect(asked).toEqual(['pl_dev#0', 'pl_dev#0']);
    codes.push('invalid_args');
    const err = (await home.getOrAssignHome({ id: 'p_bad', handle: 'Bad' }).catch((e: unknown) => e)) as CoreException;
    expect(err.details).toMatchObject({ code: 'invalid_args' });
  });

  it('a planet the sim calls planet_full (8 colonies) is marked like one without a site, and the next one is seated', async () => {
    const { repo, home, asked } = homeService((p, i) => (p === 'pl_dev' ? { ok: false, code: 'planet_full' } : { ok: true, q: 1, r: i }));
    const ok = await home.getOrAssignHome({ id: 'p_pf', handle: 'Pf' });
    expect(ok).toMatchObject({ state: 'ACTIVE', planet: { id: 'pl_dev_2' }, colony: { colonyIndex: 0, spawnQ: 1, spawnR: 0 } });
    expect(asked).toEqual(['pl_dev#0', 'pl_dev_2#0']);
    expect(await repo.listColoniesByPlanetId('pl_dev')).toEqual([]);
    await home.getOrAssignHome({ id: 'p_pf2', handle: 'Pf2' });
    expect(asked.slice(2)).toEqual(['pl_dev_2#1']); // pl_dev is never offered again
  });

  it('a landing the sim refuses planet_full rolls the row back and seats on the next planet', async () => {
    const { repo, home, asked } = homeService();
    home.onColonySeated(async (a) => {
      const out = a.planet.id === 'pl_dev' ? { ok: false as const, commandId: 'cm', code: 'planet_full' } : { ok: true as const, commandId: 'cm', appliedAtTick: 1 };
      await seatColonyOnPlanet(fakePlanets(out), a);
    });
    const ok = await home.getOrAssignHome({ id: 'p_pl', handle: 'Pl' });
    expect(ok).toMatchObject({ state: 'ACTIVE', planet: { id: 'pl_dev_2' }, colony: { colonyIndex: 0 } });
    expect(asked).toEqual(['pl_dev#0', 'pl_dev_2#0']);
    expect((await repo.findPlanetById('pl_dev'))?.seatsTaken).toBe(0);
  });

  it('without a game host no colony is seated (host_unavailable), and nothing is written', async () => {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    const err = (await home.getOrAssignHome({ id: 'p_nohost', handle: 'No' }).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ status: 409, details: { code: 'host_unavailable' } });
    expect(await repo.findLatestColonyByPlayerId('p_nohost')).toBeNull();
  });
});

describe('HomeRepository.findOrCreateOpenDevPlanet (BE-05)', () => {
  it('reads the family\'s seat counts and creates the first missing index (a wiped pl_dev comes back)', async () => {
    const repo = new HomeRepository();
    await repo.upsertDevPlanet('pl_dev_2', { capacity: 1 });
    await repo.createColony({ playerId: 'p_x', planetId: 'pl_dev_2', colonyIndex: 0, name: 'X', spawnQ: 0, spawnR: 0 });
    expect(await repo.findOrCreateOpenDevPlanet('desert')).toMatchObject({ planet: { id: 'pl_dev' }, colonyIndex: 0 });
    expect(await repo.findOrCreateOpenDevPlanet('desert', new Set(['pl_dev']))).toMatchObject({ planet: { id: 'pl_dev_3' }, colonyIndex: 0 });
    expect(await repo.findOrCreateOpenDevPlanet('ocean')).toMatchObject({ planet: { id: 'pl_dev_ocean', type: 'ocean' } });
  });

  it('never offers more colony indices than the sim lands (MAX_COLONIES_PER_PLANET), whatever the planet capacity', async () => {
    const repo = new HomeRepository();
    await repo.upsertDevPlanet('pl_dev', { capacity: 12 });
    for (let i = 0; i < MAX_COLONIES_PER_PLANET; i++) {
      expect(await repo.findOrCreateOpenDevPlanet('desert')).toMatchObject({ planet: { id: 'pl_dev' }, colonyIndex: i });
      await repo.createColony({ playerId: `p_${i}`, planetId: 'pl_dev', colonyIndex: i, name: `C${i}`, spawnQ: 0, spawnR: i });
    }
    expect(await repo.findOrCreateOpenDevPlanet('desert')).toMatchObject({ planet: { id: 'pl_dev_2', capacity: DEV_PLANET_CAPACITY }, colonyIndex: 0 });
  });
});

describe('HomeService answers an existing home only once its planet is loaded (BE-14)', () => {
  it('loads the ACTIVE home planet first, and answers 503 HOME_UNAVAILABLE when it cannot be loaded', async () => {
    const { home, loaded, host } = homeService();
    await home.getOrAssignHome({ id: 'p_home', handle: 'H' });
    expect(loaded).toEqual([]);
    await home.getOrAssignHome({ id: 'p_home', handle: 'H' });
    expect(loaded).toEqual(['pl_dev']);
    home.setLandingHost({ ...host, ensureHomeLoaded: async () => { throw new Error('held'); } });
    const err = (await home.getOrAssignHome({ id: 'p_home', handle: 'H' }).catch((e: unknown) => e)) as CoreException;
    expect(err).toMatchObject({ status: 503, errorCode: 'HOME_UNAVAILABLE', details: { planetId: 'pl_dev' } });
    expect(err.message).toMatch(/held/);
  });
});

describe('HomeService.adoptLateLanding (LED-15)', () => {
  it('writes the rolled-back row again when the player has no colony; else marks the index landed', async () => {
    const { repo, home, asked } = homeService();
    const colony = { id: 'col_late', playerId: 'p_late', planetId: 'pl_dev', colonyIndex: 0, name: 'Late', color: 0, status: 'ACTIVE', state: 'ACTIVE', spawnQ: 5, spawnR: 6, spawn: { q: 5, r: 6 }, createdAt: new Date() };
    const planet = await repo.upsertDevPlanet('pl_dev');
    const a = { player: { id: 'p_late', handle: 'Late' }, colony, planet, slot: { index: 0, q: 5, r: 6 } };
    expect(await home.adoptLateLanding(a)).toBe(true);
    expect(await home.getExistingHome('p_late')).toMatchObject({ state: 'ACTIVE', colony: { id: 'col_late', spawnQ: 5, spawnR: 6 } });
    expect(await home.adoptLateLanding({ ...a, colony: { ...colony, id: 'col_late2', colonyIndex: 1 } })).toBe(false);
    await home.getOrAssignHome({ id: 'p_next', handle: 'Next' });
    expect(asked).toEqual(['pl_dev#2']); // 0 has a row again, 1 is marked landed
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
    home.setLandingHost(landingHost().host);
    let tries = 0;
    home.onColonySeated(async (a) => { tries++; await seatColonyOnPlanet(hanging().host, a, 20); });
    const err = (await home.getOrAssignHome({ id: 'p_slow', handle: 'Slow' }).catch((e: unknown) => e)) as CoreException;
    expect(err.details).toMatchObject({ code: 'host_unavailable' });
    expect(tries).toBe(1);
    expect(await repo.findLatestColonyByPlayerId('p_slow')).toBeNull();
  });
});
