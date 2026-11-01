import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { CoreException } from '../../src/core/errors';
import { HomeRepository, HomeService, type ColonySeatAssignment } from '../../src/core/home';
import { seatColonyOnPlanet } from '../../src/game/seat-colony';

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
      if (reject) await seatColonyOnPlanet(fakePlanets({ ok: false, commandId: 'cm', code: 'landing_site_taken' }), a);
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
