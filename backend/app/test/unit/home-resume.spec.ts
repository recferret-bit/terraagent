import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HomeService } from '../../src/core/home/home.service';
import { HomeRepository } from '../../src/core/home/home.repository';
import { devPlayerId } from '../../src/ws/session-verifier';
import { freeLandingHost } from './fixtures/landing-host';

async function setup() {
  const repo = new HomeRepository();
  const home = new HomeService(repo);
  home.setLandingHost(freeLandingHost);
  const first = await home.getOrAssignHome({ id: 'pilot', handle: 'Pilot' });
  if (first.state !== 'ACTIVE') throw new Error('No colony');
  const otherPlanet = await repo.upsertDevPlanet('pl_dev_2');
  const second = await repo.createColony({ playerId: 'pilot', planetId: otherPlanet.id, colonyIndex: 0, name: 'Second', status: 'ACTIVE', color: 0, spawnQ: 0, spawnR: 0 });
  return { repo, home, first, second };
}

describe('owned colony resume', () => {
  it('resumes an older selected colony and resolves its WS seat instead of latest home', async () => {
    const { home, first, second } = await setup();
    const load = vi.fn(async () => undefined);
    home.setLandingHost({ ...freeLandingHost, ensureHomeLoaded: load });
    expect(await home.resumeColony('pilot', first.colony.id)).toMatchObject({ colony: { id: first.colony.id } });
    expect(await home.getExistingHome('pilot', first.planet.id)).toMatchObject({ colony: { id: first.colony.id } });
    expect(await home.getExistingHome('pilot', second.planet.id)).toMatchObject({ colony: { id: second.colony.id } });
    expect(load).toHaveBeenCalledOnce();
  });

  it('rejects foreign, missing, eliminated and ended destinations without allocating a replacement', async () => {
    const { repo, home, first } = await setup();
    await expect(home.resumeColony('stranger', first.colony.id)).rejects.toMatchObject({ errorCode: 'COLONY_UNAVAILABLE' });
    await expect(home.resumeColony('pilot', 'missing')).rejects.toMatchObject({ errorCode: 'COLONY_UNAVAILABLE' });
    await repo.setColonyStatus(first.colony.id, 'ELIMINATED');
    await expect(home.resumeColony('pilot', first.colony.id)).rejects.toMatchObject({ errorCode: 'COLONY_UNAVAILABLE' });
    await repo.setColonyStatus(first.colony.id, 'ACTIVE');
    await repo.setPlanetStatus(first.planet.id, 'ENDED');
    await expect(home.resumeColony('pilot', first.colony.id)).rejects.toMatchObject({ errorCode: 'COLONY_UNAVAILABLE' });
  });

  it('rejects mismatched requested sectorId with 409 COLONY_SECTOR_LOCKED for an ACTIVE colony', async () => {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    home.setLandingHost(freeLandingHost);
    const planet = await repo.upsertDevPlanet('pl_dev_sec');
    const created = await repo.createColony({
      playerId: 'pilot_sec',
      planetId: planet.id,
      colonyIndex: 0,
      name: 'SectorZero',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      color: 0,
      spawnQ: 0,
      spawnR: 0,
    });

    await expect(home.getOrAssignHome({ id: 'pilot_sec' }, 'desert', 'sec_0_0')).resolves.toMatchObject({
      state: 'ACTIVE',
      colony: { id: created.colony.id },
    });
    await expect(home.getOrAssignHome({ id: 'pilot_sec' }, 'desert', 'sec_1_0')).rejects.toMatchObject({
      status: 409,
      errorCode: 'COLONY_SECTOR_LOCKED',
    });
    await expect(home.resolveHome('pilot_sec', { sectorId: 'sec_1_0' })).rejects.toMatchObject({
      status: 409,
      errorCode: 'COLONY_SECTOR_LOCKED',
    });
    await expect(home.resumeColony('pilot_sec', created.colony.id, 'sec_1_0')).rejects.toMatchObject({
      status: 409,
      errorCode: 'COLONY_SECTOR_LOCKED',
    });
  });
});

describe('owned colony resume — dev alias & W12 materialization', () => {
  it('materializes and resumes co_w12_live_1 on Sylva Reach (pl_w12_forest) and reassigns dev-seeded ownership in non-production', async () => {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    const seated: string[] = [];
    home.setLandingHost(freeLandingHost);
    home.onColonySeated(({ colony }) => {
      seated.push(colony.id);
    });

    const first = await home.resumeColony('pr_browser_1', 'co_w12_live_1');
    expect(first).toMatchObject({
      state: 'ACTIVE',
      colony: { id: 'co_w12_live_1', name: 'Aegis Basin', playerId: 'pr_browser_1', planetId: 'pl_w12_forest' },
      planet: { id: 'pl_w12_forest', name: 'Sylva Reach', type: 'temperate' },
    });
    expect(seated).toEqual(['co_w12_live_1']);

    const reassigned = await home.resumeColony('pr_browser_2', 'co_w12_live_1');
    expect(reassigned).toMatchObject({
      state: 'ACTIVE',
      colony: { id: 'co_w12_live_1', playerId: 'pr_browser_2', planetId: 'pl_w12_forest' },
    });
  });

  it('reassigns and resumes colonies seeded under any non-production devPlayerId alias', async () => {
    const repo = new HomeRepository();
    const home = new HomeService(repo);
    home.setLandingHost(freeLandingHost);
    const devOwner = devPlayerId('custom_dev_pilot');
    const planet = await repo.upsertDevPlanet('pl_dev_alias_test');
    const created = await repo.createColony({
      playerId: devOwner,
      planetId: planet.id,
      colonyIndex: 0,
      name: 'Alias Basin',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      color: 0,
      spawnQ: 0,
      spawnR: 0,
    });

    const resumed = await home.resumeColony('pr_real_browser_pilot', created.colony.id);
    expect(resumed).toMatchObject({
      state: 'ACTIVE',
      colony: { id: created.colony.id, name: 'Alias Basin', playerId: 'pr_real_browser_pilot', planetId: planet.id },
    });
  });
});
