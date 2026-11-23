// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_PLANETS, W11_SEVEN_SECTOR_COORDS, formatSectorId, type PlanetListV1, type PlanetType, type SectorSummaryV1 } from '@terra/contracts';
import { probeActiveHomeColony, type ActiveHomeColony } from '../../design/pilot/activeHomeColony';
import { MainMenu, type MenuCallbacks } from './menu';

function makePlanetListFixture(): PlanetListV1 {
  const sectors = (type: PlanetType): SectorSummaryV1[] =>
    W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => ({
      sectorId: formatSectorId(mq, mr),
      continentId: 'cont_0',
      macroQ: mq,
      macroR: mr,
      centerQ: mq * 37,
      centerR: mr * 37,
      kind: 'land' as const,
      foundingCapacity: 4,
      validatedCapacity: 4,
      reservedSeats: 0,
      foundedSeats: 0,
      freeSeats: 4,
      livingColonies: 0,
      presentColonies: 0,
      onlinePlayers: 0,
      availability: 'open' as const,
      mainResource: type === 'desert' ? 'metals.t1' : 'minerals.t1',
    }));

  const summary = (type: PlanetType) => {
    const def = CANONICAL_PLANETS[type];
    return {
      id: def.id,
      name: def.name,
      type,
      look: def.look,
      lifecycle: 'ACTIVE' as const,
      health: 'OK' as const,
      admission: 'OPEN' as const,
      availability: 'open' as const,
      atlasVersion: 1,
      atlasHash: `atlas_${type}`,
      configHash: `cfg_${type}`,
      totalSectors: 7,
      landSectors: 7,
      oceanSectors: 0,
      nominalCapacity: 28,
      validatedCapacity: 28,
      reservedSeats: 0,
      foundedSeats: 0,
      freeSeats: 28,
      livingColonies: 0,
      presentColonies: 0,
      onlinePlayers: 0,
      updatedAt: '2026-11-18T12:00:00.000Z',
      sectors: sectors(type),
    };
  };

  return {
    planets: [summary('desert'), summary('ocean'), summary('temperate')],
    queuePaused: false,
    updatedAt: '2026-11-18T12:00:00.000Z',
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('probeActiveHomeColony', () => {
  it('makes no guest auth call for a brand-new visitor without cookie or stored deviceSecret', async () => {
    const fetchMock = vi.fn(async () => json(401, { errorCode: 'UNAUTHORIZED' }));
    const storage = { getItem: () => null };
    const result = await probeActiveHomeColony({ fetch: fetchMock as unknown as typeof fetch, storage, dev: false });
    expect(result).toBeNull();
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/v1/auth/refresh']);
  });

  it('uses an existing stored deviceSecret to check GET /v1/me/home?resolve=1 and maps ACTIVE colonies only', async () => {
    const calls: string[] = [];
    let homeState = 'ACTIVE';
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/v1/auth/refresh') return json(401, {});
      if (url === '/v1/auth/guest') return json(200, { accessToken: 'tok_guest', player: { id: 'p1', isGuest: true, handle: 'G' } });
      if (url === '/v1/me/home?resolve=1') {
        return json(200, {
          state: homeState,
          colony: { id: 'col_desert_1', name: 'Sand Citadel' },
          planet: { id: 'pl_dev_2', name: 'Dev Planet 2', type: 'desert' },
        });
      }
      return json(404, {});
    });
    const storage = { getItem: (k: string) => (k === 'ta_device_secret' ? 'secret_at_least_16_chars' : null) };

    const active = await probeActiveHomeColony({ fetch: fetchMock as unknown as typeof fetch, storage, dev: false });
    expect(calls).toEqual(['/v1/auth/refresh', '/v1/auth/guest', '/v1/me/home?resolve=1']);
    expect(active).toEqual({
      kind: 'dune',
      planetType: 'desert',
      planetId: 'pl_dev_2',
      planetName: 'Dev Planet 2',
      colonyId: 'col_desert_1',
      colonyName: 'Sand Citadel',
    });

    homeState = 'ELIMINATED';
    expect(await probeActiveHomeColony({ fetch: fetchMock as unknown as typeof fetch, storage, dev: false })).toBeNull();
  });

  it('captures colony.foundingSectorId when returned by GET /v1/me/home?resolve=1', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/v1/auth/refresh') return json(401, {});
      if (url === '/v1/auth/guest') return json(200, { accessToken: 'tok_guest', player: { id: 'p2', isGuest: true } });
      if (url === '/v1/me/home?resolve=1') {
        return json(200, {
          state: 'ACTIVE',
          colony: { id: 'col_ocean_2', name: 'Tidal Keep', foundingSectorId: 'sec_1_0' },
          planet: { id: 'cn_ocean', name: 'Thalassa', type: 'ocean' },
        });
      }
      return json(404, {});
    });
    const storage = { getItem: (k: string) => (k === 'ta_device_secret' ? 'secret_at_least_16_chars' : null) };
    const active = await probeActiveHomeColony({ fetch: fetchMock as unknown as typeof fetch, storage, dev: false });
    expect(active).toEqual({
      kind: 'oceanForest',
      planetType: 'ocean',
      planetId: 'cn_ocean',
      planetName: 'Thalassa',
      colonyId: 'col_ocean_2',
      colonyName: 'Tidal Keep',
      foundingSectorId: 'sec_1_0',
    });
  });
});

describe('MainMenu active colony planet lock', () => {
  it('forces active planet selection, removes YOUR COLONY/OPEN chips, gray-locks others, and blocks switching across planet updates', () => {
    const onPlanet = vi.fn();
    const cb: MenuCallbacks = { onPlanet, onDeploy: vi.fn(), onSettings: vi.fn() };
    const menu = new MainMenu(document.body, cb, 'oceanForest', undefined, { planetList: makePlanetListFixture() });

    const active: ActiveHomeColony = {
      kind: 'dune',
      planetType: 'desert',
      planetId: 'pl_dev',
      planetName: 'Dev Planet',
      colonyId: 'col_0',
      colonyName: 'Outpost Alpha',
    };
    menu.setActiveColony(active);

    expect(menu.kind).toBe('dune');
    expect(onPlanet).toHaveBeenCalledWith('dune');

    const duneCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="dune"]')!;
    const oceanCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="oceanForest"]')!;
    const tempCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="forestRock"]')!;
    expect(duneCard.disabled).toBe(false);
    expect(duneCard.classList.contains('is-active-colony')).toBe(true);
    expect(duneCard.querySelector('.world-colony-badge')).toBeNull();
    expect(duneCard.querySelector('.world-card-status')).toBeNull();

    expect(oceanCard.disabled).toBe(true);
    expect(oceanCard.classList.contains('is-colony-locked')).toBe(true);
    expect(oceanCard.querySelector('.world-card-status')).toBeNull();
    expect(tempCard.disabled).toBe(true);
    expect(tempCard.classList.contains('is-colony-locked')).toBe(true);

    expect(menu.el.querySelector('#deploy')?.textContent).toBe('ENTER COLONY');
    expect(menu.el.querySelector<HTMLElement>('#sector-picker-host')?.hidden).toBe(false);
    expect(menu.el.querySelector('[data-testid="ar-card-presence"]')?.textContent).toContain('Outpost Alpha');

    // Attempting to select or click another planet keeps desert locked
    onPlanet.mockClear();
    oceanCard.click();
    menu.select('oceanForest', true);
    expect(menu.kind).toBe('dune');
    expect(onPlanet).not.toHaveBeenCalled();

    // Live feed updates preserve gray-lock state
    menu.setPlanetList(makePlanetListFixture());
    expect(oceanCard.classList.contains('is-colony-locked')).toBe(true);
    expect(oceanCard.disabled).toBe(true);

    // Clearing active colony unlocks all planets
    menu.setActiveColony(null);
    expect(oceanCard.disabled).toBe(false);
    expect(oceanCard.classList.contains('is-colony-locked')).toBe(false);
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('DEPLOY');
    menu.dispose();
  });
});

describe('MainMenu deployed colony sector lock', () => {
  it('disables ENTER COLONY and blocks deploy when selecting a sector other than the deployed colony sector', () => {
    const onDeploy = vi.fn();
    const cb: MenuCallbacks = { onPlanet: vi.fn(), onDeploy, onSettings: vi.fn() };
    const menu = new MainMenu(document.body, cb, 'dune', undefined, { planetList: makePlanetListFixture() });

    const active: ActiveHomeColony = {
      kind: 'dune',
      planetType: 'desert',
      planetId: CANONICAL_PLANETS.desert.id,
      planetName: 'Kharon',
      colonyId: 'col_sec_1_0',
      colonyName: 'Outpost Sec1',
      foundingSectorId: 'sec_1_0',
    };
    menu.setActiveColony(active);

    const deployBtn = menu.el.querySelector<HTMLButtonElement>('#deploy')!;
    const errEl = menu.el.querySelector<HTMLElement>('#menu-err')!;
    expect(deployBtn.disabled).toBe(false);
    expect(deployBtn.getAttribute('aria-disabled')).toBe('false');
    expect(menu.canDeploy()).toBe(true);

    // Selecting a foreign sector locks ENTER COLONY
    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_0_0' });
    expect(deployBtn.disabled).toBe(true);
    expect(deployBtn.getAttribute('aria-disabled')).toBe('true');
    expect(deployBtn.dataset.sectorLocked).toBe('true');
    expect(menu.canDeploy()).toBe(false);
    expect(errEl.textContent).toContain('SEC_1_0');

    // Even if tampered DOM removes disabled attribute, click refuses to fire onDeploy
    deployBtn.disabled = false;
    deployBtn.click();
    expect(onDeploy).not.toHaveBeenCalled();

    // Selecting the deployed home sector re-enables ENTER COLONY and allows deploy
    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_1_0' });
    expect(deployBtn.disabled).toBe(false);
    expect(deployBtn.getAttribute('aria-disabled')).toBe('false');
    expect(deployBtn.dataset.sectorLocked).toBe('false');
    expect(menu.canDeploy()).toBe(true);
    expect(errEl.textContent).toBe('');

    deployBtn.click();
    expect(onDeploy).toHaveBeenCalledTimes(1);
    menu.dispose();
  });
});
