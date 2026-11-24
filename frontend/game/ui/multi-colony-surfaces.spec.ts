// @vitest-environment jsdom
import {
  CANONICAL_PLANETS,
  MANAGED_AI_MODEL,
  W11_SEVEN_SECTOR_COORDS,
  decodeWire,
  formatSectorId,
  newId,
  type MeProfileResponse,
  type PlanetListV1,
  type PlanetType,
  type SectorSummaryV1,
} from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  probePilotColonyRoster,
  type ActiveHomeColony,
  type PilotColonyRoster,
} from '../../design/pilot/activeHomeColony';
import { parseInitialMenuColonyOptions } from '../app/colonyEntryBridge';
import { GuestBootTarget } from '../app/online/guestBoot';
import { activeHome } from '../app/online/homeFixture';
import { WsTransport, type SocketLike } from '../net/WsTransport';
import { createLocalModeFetch } from '../pages/me/localModeSim';
import { MePage } from '../pages/me/MePage';
import { renderAiSettingsSection } from '../pages/me/sections/AiSettingsSection';
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

const flush = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Planet selection screen — multi-colony staker slots & same-sector lock', () => {
  it('unlocks same-planet open sectors and other planets for Tier 2 stakers (2/3 slots) while routing owned sectors to ENTER COLONY', () => {
    const onDeploy = vi.fn();
    const cb: MenuCallbacks = { onPlanet: vi.fn(), onDeploy, onSettings: vi.fn() };
    const menu = new MainMenu(document.body, cb, 'dune', undefined, { planetList: makePlanetListFixture() });

    const colA: ActiveHomeColony = {
      kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id,
      planetName: 'Kharon', colonyId: 'col_dune_a', colonyName: 'Sand Spire', foundingSectorId: 'sec_0_0',
    };
    const colB: ActiveHomeColony = {
      kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id,
      planetName: 'Kharon', colonyId: 'col_dune_b', colonyName: 'Canyon Hold', foundingSectorId: 'sec_1_0',
    };
    menu.setColonyRoster({
      primary: colA,
      colonies: [colA, colB],
      slots: { used: 2, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
    });

    const oceanCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="oceanForest"]')!;
    expect(oceanCard.disabled).toBe(false);
    expect(oceanCard.classList.contains('is-colony-locked')).toBe(false);

    const baseMarkers = menu.getGlobeMarkers().filter((m) => m.isHomeBase).map((m) => m.id).sort();
    expect(baseMarkers).toEqual(['sec_0_0', 'sec_1_0']);

    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_1_0' });
    expect(menu.resolveDeployAction()).toMatchObject({ mode: 'enter', colony: colB });
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('ENTER COLONY');

    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_0_1' });
    expect(menu.resolveDeployAction()).toMatchObject({ mode: 'new', colony: null });
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('DEPLOY NEW COLONY');
    expect(menu.canDeploy()).toBe(true);

    menu.select('oceanForest', true);
    expect(menu.kind).toBe('oceanForest');
    expect(menu.resolveDeployAction()).toMatchObject({ mode: 'new', colony: null });
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('DEPLOY NEW COLONY');
    menu.dispose();
  });

  it('shows + NEW COLONY toggle with 1 colony on a planet, supports AUTO new-colony deploy, locks same-sector in + NEW COLONY mode, and honors ?new=1', () => {
    const cb: MenuCallbacks = { onPlanet: vi.fn(), onDeploy: vi.fn(), onSettings: vi.fn() };
    const colA: ActiveHomeColony = {
      kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id,
      planetName: 'Kharon', colonyId: 'col_dune_a', colonyName: 'Sand Spire', foundingSectorId: 'sec_0_0',
    };
    const initOpts = parseInitialMenuColonyOptions('?planet=dune&new=1');
    expect(initOpts).toEqual({ initialNewColony: true, initialColonyId: null });

    const menu = new MainMenu(document.body, cb, 'dune', undefined, {
      planetList: makePlanetListFixture(),
      ...initOpts,
    });
    menu.setColonyRoster({
      primary: colA,
      colonies: [colA],
      slots: { used: 1, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
    });

    const newColBtn = menu.el.querySelector<HTMLButtonElement>('[data-testid="orbital-colony-opt-new"]')!;
    const colABtn = menu.el.querySelector<HTMLButtonElement>('[data-testid="orbital-colony-opt-col_dune_a"]')!;
    expect(newColBtn).not.toBeNull();
    expect(colABtn).not.toBeNull();

    // ?new=1 keeps AUTO · BEST OPEN ZONE pointed to DEPLOY NEW COLONY instead of entering colA
    expect(menu.resolveDeployAction()).toMatchObject({ allowed: true, mode: 'new', colony: null });
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('DEPLOY NEW COLONY');

    // Clicking an already-owned sector while + NEW COLONY is active refuses same-sector founding cleanly
    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_0_0' });
    expect(menu.resolveDeployAction()).toMatchObject({ allowed: false, mode: 'locked', buttonLabel: 'SAME SECTOR LOCKED' });
    expect(menu.canDeploy()).toBe(false);
    expect(menu.el.querySelector<HTMLButtonElement>('#deploy')?.disabled).toBe(true);

    // Selecting colA explicitly enters sec_0_0, and clicking + NEW COLONY clears away from owned sec_0_0 back to AUTO DEPLOY NEW COLONY
    colABtn.click();
    expect(menu.resolveDeployAction()).toMatchObject({ allowed: true, mode: 'enter', colony: colA });
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('ENTER COLONY');

    newColBtn.click();
    expect(menu.getSectorIntent()).toEqual({ mode: 'auto' });
    expect(menu.resolveDeployAction()).toMatchObject({ allowed: true, mode: 'new', buttonLabel: 'DEPLOY NEW COLONY' });
    menu.dispose();
  });
});

describe('Planet selection screen — full slot cap & roster probe', () => {
  it('locks uncolonized planets and uncolonized sectors once a staker reaches full slot capacity (3/3)', () => {
    const cb: MenuCallbacks = { onPlanet: vi.fn(), onDeploy: vi.fn(), onSettings: vi.fn() };
    const menu = new MainMenu(document.body, cb, 'dune', undefined, { planetList: makePlanetListFixture() });

    const roster: PilotColonyRoster = {
      primary: {
        kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id,
        planetName: 'Kharon', colonyId: 'col_1', colonyName: 'Alpha', foundingSectorId: 'sec_0_0',
      },
      colonies: [
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_1', colonyName: 'Alpha', foundingSectorId: 'sec_0_0' },
        { kind: 'dune', planetType: 'desert', planetId: CANONICAL_PLANETS.desert.id, planetName: 'Kharon', colonyId: 'col_2', colonyName: 'Beta', foundingSectorId: 'sec_1_0' },
        { kind: 'oceanForest', planetType: 'ocean', planetId: CANONICAL_PLANETS.ocean.id, planetName: 'Thalassa', colonyId: 'col_3', colonyName: 'Gamma', foundingSectorId: 'sec_0_0' },
      ],
      slots: { used: 3, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
    };
    menu.setColonyRoster(roster);

    const oceanCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="oceanForest"]')!;
    const tempCard = menu.el.querySelector<HTMLButtonElement>('.world-card[data-k="forestRock"]')!;
    expect(oceanCard.disabled).toBe(false);
    expect(tempCard.disabled).toBe(true);

    menu.setSectorIntent({ mode: 'chosen', sectorId: 'sec_0_1' });
    expect(menu.canDeploy()).toBe(false);
    expect(menu.el.querySelector<HTMLButtonElement>('#deploy')?.disabled).toBe(true);

    menu.select('oceanForest', true);
    expect(menu.kind).toBe('oceanForest');
    expect(menu.canDeploy()).toBe(true);
    expect(menu.el.querySelector('#deploy')?.textContent).toBe('ENTER COLONY');
    menu.dispose();
  });

  it('parses multi-colony roster and slot allowance in probePilotColonyRoster', async () => {
    const probed = await probePilotColonyRoster({
      dev: false,
      storage: { getItem: () => JSON.stringify({ accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' }) },
      fetch: (async (url: string) => {
        if (url === '/v1/auth/refresh') return new Response('{}', { status: 401 });
        return new Response(JSON.stringify({
          state: 'ACTIVE',
          colony: { id: 'col_1', name: 'Alpha', foundingSectorId: 'sec_0_0' },
          planet: { id: CANONICAL_PLANETS.desert.id, name: 'Kharon', type: 'desert' },
          colonySlots: { used: 2, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
          activeColonies: [
            { colony: { id: 'col_1', name: 'Alpha', foundingSectorId: 'sec_0_0' }, planet: { id: CANONICAL_PLANETS.desert.id, name: 'Kharon', type: 'desert' } },
            { colony: { id: 'col_2', name: 'Beta', foundingSectorId: 'sec_1_0' }, planet: { id: CANONICAL_PLANETS.ocean.id, name: 'Thalassa', type: 'ocean' } },
          ],
        }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(probed?.colonies).toHaveLength(2);
    expect(probed?.slots).toMatchObject({ used: 2, max: 3, isStaker: true });
  });
});

describe('/me.html — locked AI model dropdown, z-ai/glm-5.3-flash staker default & colony slots bar', () => {
  it('locks #me-ai-model-select until a valid API key is entered, unlocks on valid key, and re-locks on disconnect', async () => {
    const savedCalls: unknown[] = [];
    const card = renderAiSettingsSection(
      {
        aiSettings: {
          hasApiKey: false,
          apiKeyPreview: null,
          model: 'deepseek/deepseek-v3.2',
          availableModels: [MANAGED_AI_MODEL, 'deepseek/deepseek-v3.2', 'anthropic/claude-sonnet-4-6'],
          stakerAutopilotActive: true,
          stakedNear: '50',
        },
      } as unknown as MeProfileResponse,
      {
        search: '?as=w12',
        fetch: (async (url: string, init?: RequestInit) => {
          if (!String(url).includes('/ai-settings')) return new Response('{}', { status: 404 });
          const body = JSON.parse(String(init?.body ?? '{}')) as { apiKey?: string | null; model: string };
          savedCalls.push(body);
          const hasApiKey = typeof body.apiKey === 'string' && body.apiKey.length >= 8;
          return new Response(JSON.stringify({
            hasApiKey, apiKeyPreview: hasApiKey ? 'sk-n••••9999' : null,
            model: hasApiKey ? body.model : MANAGED_AI_MODEL,
            availableModels: [MANAGED_AI_MODEL, 'deepseek/deepseek-v3.2', 'anthropic/claude-sonnet-4-6'],
            stakerAutopilotActive: true, stakedNear: '50',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch,
      },
    );

    const select = card.querySelector<HTMLSelectElement>('#me-ai-model-select')!;
    const keyInput = card.querySelector<HTMLInputElement>('#me-ai-key-input')!;
    const saveBtn = card.querySelector<HTMLButtonElement>('[data-testid="me-ai-save-btn"]')!;
    const clearBtn = card.querySelector<HTMLButtonElement>('[data-testid="me-ai-clear-btn"]')!;

    expect(select.disabled).toBe(true);
    expect(select.getAttribute('aria-disabled')).toBe('true');
    expect(select.value).toBe(MANAGED_AI_MODEL);

    keyInput.value = 'short';
    keyInput.dispatchEvent(new Event('input'));
    expect(select.disabled).toBe(true);
    saveBtn.click();
    await flush();
    expect(keyInput.getAttribute('aria-invalid')).toBe('true');
    expect(savedCalls).toHaveLength(0);

    keyInput.value = 'sk-nearai-valid-key-9999';
    keyInput.dispatchEvent(new Event('input'));
    expect(select.disabled).toBe(false);
    expect(select.getAttribute('aria-disabled')).toBeNull();

    select.value = 'anthropic/claude-sonnet-4-6';
    select.dispatchEvent(new Event('change'));
    saveBtn.click();
    await flush();
    expect(savedCalls).toEqual([{ model: 'anthropic/claude-sonnet-4-6', apiKey: 'sk-nearai-valid-key-9999' }]);

    clearBtn.click();
    await flush();
    expect(select.disabled).toBe(true);
    expect(select.value).toBe(MANAGED_AI_MODEL);
  });
});

describe('/me.html — live colony slots bar & WS multi-colony join', () => {
  it('updates /me #planets colony slots bar live when staking 50 NEAR and forwards colonyId + sectorId on WS join', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, { search: '?host=local', fetch: createLocalModeFetch(() => 1_700_000_000_000) });
    await page.load();
    await flush();

    expect(root.querySelector('[data-testid="me-colony-slots-count"]')?.textContent).toBe('ACTIVE COLONIES · 1 / 1');
    (root.querySelector<HTMLInputElement>('[data-testid="staking-console-amount"]')!).value = '50';
    root.querySelector<HTMLButtonElement>('[data-testid="staking-console-stake"]')!.click();
    await flush();
    expect(root.querySelector('[data-testid="me-colony-slots-count"]')?.textContent).toBe('ACTIVE COLONIES · 1 / 3');
    const deployNewLink = root.querySelector<HTMLAnchorElement>('[data-testid="me-deploy-new-colony"]')!;
    expect(deployNewLink.textContent).toContain('Deploy Colony (1/3)');
    expect(deployNewLink.getAttribute('href')).toBe('/play.html?host=local&new=1');

    const colMultiB = newId('co');
    const playerWs = newId('pr');
    const baseHome = activeHome({ planetId: CANONICAL_PLANETS.desert.id, colonyId: colMultiB, colonyIndex: 1 });
    const homeWithSector = baseHome.state === 'ACTIVE'
      ? { ...baseHome, colony: { ...baseHome.colony, foundingSectorId: 'sec_1_0' } }
      : baseHome;
    const target = new GuestBootTarget('ws://127.0.0.1:9999/ws', {
      search: '',
      tryRefresh: false,
      allowLocalFallback: false,
      storage: { getItem: () => '1234567890abcdef1234567890abcdef', setItem: () => {} },
      onBooted: () => {},
      fetch: async (url) => {
        const body = String(url).includes('/auth/guest')
          ? { accessToken: 'jwt-guest-valid-token', expiresIn: 900, player: { id: playerWs, handle: 'H', isGuest: true } }
          : homeWithSector;
        return { ok: true, status: 200, json: async () => body };
      },
    });
    await target.boot();
    expect(target.colonyId).toBe(colMultiB);
    expect(target.sectorId).toBe('sec_1_0');

    const sock: SocketLike & { sent: Array<{ t: string; d: unknown }> } = {
      binaryType: 'blob', onopen: null, onmessage: null, onclose: null, onerror: null, sent: [],
      send(data) { this.sent.push(decodeWire(data) as { t: string; d: unknown }); },
      close() {},
    };
    const transport = new WsTransport(target, {
      socket: () => sock, now: () => 0, setTimer: () => 1, clearTimer: () => {}, random: () => 0.5, clientVersion: 'test',
    });
    transport.start();
    await flush();
    sock.onopen?.();
    sock.onmessage?.({ data: JSON.stringify({ v: 1, t: 'ready', d: { playerId: playerWs, flags: ['W00'] } }) });
    expect(sock.sent.find((f) => f.t === 'join')?.d).toMatchObject({
      planetId: CANONICAL_PLANETS.desert.id,
      colonyId: colMultiB,
      sectorId: 'sec_1_0',
    });
    transport.dispose();
  });
});
