import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HomeService } from '../../src/core/home/home.service';
import { HomeRepository } from '../../src/core/home/home.repository';
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
});
