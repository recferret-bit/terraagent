// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_PLANETS,
  W11_SEVEN_SECTOR_COORDS,
  deriveSectorOccupancy,
  deriveWorldAvailability,
  formatSectorId,
  type PlanetListV1,
  type PlanetSummaryV1,
  type PlanetType,
  type SectorSummaryV1,
} from '@terra/contracts';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  LobbyPlanetFeed,
  MainMenu,
  type LobbyWsLike,
  type MenuCallbacks,
  type SectorIntentV1,
} from './menu';
import { toSectorPlacementIntentV1 } from './lobby/orbitalPickerModel';

const NOW_ISO = '2026-11-08T12:00:00.000Z';

function makeSectorFixture(
  macroQ: number,
  macroR: number,
  overrides: Partial<SectorSummaryV1> = {},
): SectorSummaryV1 {
  const sectorId = formatSectorId(macroQ, macroR);
  const kind = overrides.kind ?? 'land';
  const foundingCapacity = overrides.foundingCapacity ?? (kind === 'ocean' ? 0 : 4);
  const validatedCapacity = overrides.validatedCapacity ?? foundingCapacity;
  const reservedSeats = overrides.reservedSeats ?? 0;
  const foundedSeats = overrides.foundedSeats ?? 0;
  const occ = deriveSectorOccupancy({
    kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    livingColonies: overrides.livingColonies ?? null,
    presentColonies: overrides.presentColonies ?? null,
    onlinePlayers: overrides.onlinePlayers ?? null,
  });
  return {
    sectorId,
    continentId: kind === 'land' ? 'cont_0' : null,
    macroQ,
    macroR,
    centerQ: macroQ * 37,
    centerR: macroR * 37,
    kind,
    foundingCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats: overrides.freeSeats ?? occ.freeSeats,
    livingColonies: overrides.livingColonies !== undefined ? overrides.livingColonies : 0,
    presentColonies: overrides.presentColonies !== undefined ? overrides.presentColonies : 0,
    onlinePlayers: overrides.onlinePlayers !== undefined ? overrides.onlinePlayers : 0,
    availability: overrides.availability ?? occ.availability,
    ...(overrides.mainResource ? { mainResource: overrides.mainResource } : {}),
  };
}

function makePlanetFixture(
  type: PlanetType,
  overrides: Partial<PlanetSummaryV1> = {},
): PlanetSummaryV1 {
  const def = CANONICAL_PLANETS[type];
  const defaultSectors: SectorSummaryV1[] = [
    ...W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) =>
      makeSectorFixture(mq, mr, { mainResource: 'metals.t1' }),
    ),
    makeSectorFixture(2, 0, { kind: 'ocean' }),
    makeSectorFixture(2, -1, { kind: 'ocean' }),
  ];
  const sectors = overrides.sectors ?? defaultSectors;
  const land = sectors.filter((s) => s.kind === 'land');
  const ocean = sectors.filter((s) => s.kind === 'ocean');
  const nominalCapacity = land.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity = land.reduce((sum, s) => sum + s.validatedCapacity, 0);
  const reservedSeats = overrides.reservedSeats ?? land.reduce((sum, s) => sum + s.reservedSeats, 0);
  const foundedSeats = overrides.foundedSeats ?? land.reduce((sum, s) => sum + s.foundedSeats, 0);
  const freeSeats =
    overrides.freeSeats ?? Math.max(0, validatedCapacity - reservedSeats - foundedSeats);
  const lifecycle = overrides.lifecycle ?? 'ACTIVE';
  const health = overrides.health ?? 'OK';
  const admission = overrides.admission ?? 'OPEN';
  const availability =
    overrides.availability ?? deriveWorldAvailability({ lifecycle, health, admission, freeSeats });

  return {
    id: def.id,
    name: def.name,
    type: def.type,
    look: def.look,
    lifecycle,
    health,
    admission,
    availability,
    atlasVersion: 1,
    atlasHash: `atlas_${def.type}_v1`,
    configHash: `cfg_${def.type}_v1`,
    totalSectors: sectors.length,
    landSectors: land.length,
    oceanSectors: ocean.length,
    nominalCapacity,
    validatedCapacity,
    reservedSeats,
    foundedSeats,
    freeSeats,
    livingColonies: overrides.livingColonies !== undefined ? overrides.livingColonies : 2,
    presentColonies: overrides.presentColonies !== undefined ? overrides.presentColonies : 2,
    onlinePlayers: overrides.onlinePlayers !== undefined ? overrides.onlinePlayers : 1,
    updatedAt: NOW_ISO,
    sectors,
    ...overrides,
  };
}

function makePlanetListFixture(
  overrides: {
    desert?: Partial<PlanetSummaryV1>;
    ocean?: Partial<PlanetSummaryV1>;
    temperate?: Partial<PlanetSummaryV1>;
    queuePaused?: boolean;
  } = {},
): PlanetListV1 {
  return {
    planets: [
      makePlanetFixture('desert', overrides.desert),
      makePlanetFixture('ocean', overrides.ocean),
      makePlanetFixture('temperate', overrides.temperate),
    ],
    queuePaused: overrides.queuePaused ?? false,
    updatedAt: NOW_ISO,
  };
}

function makeNoopCallbacks(overrides: Partial<MenuCallbacks> = {}): MenuCallbacks {
  return {
    onPlanet: () => {},
    onDeploy: () => {},
    onSettings: () => {},
    ...overrides,
  };
}

function makePollingSnapshots(): PlanetListV1[] {
  const snap1 = makePlanetListFixture({
    desert: {
      reservedSeats: 0,
      foundedSeats: 0,
      freeSeats: 28,
      livingColonies: 0,
      onlinePlayers: 1,
      availability: 'open',
    },
  });
  const fullSectors = [
    ...W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) =>
      makeSectorFixture(mq, mr, {
        reservedSeats: 1,
        foundedSeats: 3,
        freeSeats: 0,
        availability: 'full',
      }),
    ),
    makeSectorFixture(2, 0, { kind: 'ocean' }),
    makeSectorFixture(2, -1, { kind: 'ocean' }),
  ];
  const snap2 = makePlanetListFixture({
    desert: {
      sectors: fullSectors,
      reservedSeats: 7,
      foundedSeats: 21,
      freeSeats: 0,
      livingColonies: 21,
      onlinePlayers: 14,
      availability: 'full',
    },
  });
  const pausedSectors = [
    ...W11_SEVEN_SECTOR_COORDS.map(([mq, mr], idx) =>
      makeSectorFixture(mq, mr, {
        reservedSeats: 0,
        foundedSeats: idx === 0 ? 4 : 2,
        freeSeats: idx === 0 ? 0 : 2,
        availability: 'paused',
      }),
    ),
    makeSectorFixture(2, 0, { kind: 'ocean' }),
    makeSectorFixture(2, -1, { kind: 'ocean' }),
  ];
  const snap3 = makePlanetListFixture({
    desert: {
      admission: 'PAUSED',
      sectors: pausedSectors,
      reservedSeats: 0,
      foundedSeats: 16,
      freeSeats: 12,
      livingColonies: 16,
      onlinePlayers: 11,
      availability: 'paused',
    },
    queuePaused: true,
  });
  return [snap1, snap2, snap3];
}

describe('W11-22 · Three persistent world cards', () => {
  it('renders all 3 canonical cards, omits newPlanet CTAs, and maps availability & occupancy', () => {
    const root = document.createElement('div');
    const list = makePlanetListFixture({
      desert: {
        reservedSeats: 3,
        foundedSeats: 5,
        freeSeats: 20,
        livingColonies: 4,
        onlinePlayers: 3,
        availability: 'open',
      },
      ocean: {
        reservedSeats: 4,
        foundedSeats: 24,
        freeSeats: 0,
        livingColonies: 18,
        onlinePlayers: 9,
        availability: 'full',
      },
      temperate: {
        admission: 'PAUSED',
        reservedSeats: 1,
        foundedSeats: 6,
        freeSeats: 21,
        livingColonies: null,
        onlinePlayers: null,
        availability: 'paused',
      },
    });

    const menu = new MainMenu(root, makeNoopCallbacks(), 'dune', undefined, { planetList: list });
    const cards = [...menu.el.querySelectorAll<HTMLElement>('.world-card')];
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.dataset.k)).toEqual(['dune', 'oceanForest', 'forestRock']);
    expect(cards.map((c) => c.dataset.planetType)).toEqual(['desert', 'ocean', 'temperate']);
    expect(menu.el.textContent?.toLowerCase()).not.toContain('create new planet');
    expect(menu.el.textContent?.toLowerCase()).not.toContain('new planet');

    const duneCard = menu.el.querySelector<HTMLElement>('.world-card[data-k="dune"]')!;
    expect(duneCard.dataset.availability).toBe('open');
    expect(duneCard.dataset.freeSeats).toBe('20');
    expect(duneCard.dataset.validatedCapacity).toBe('28');
    expect(duneCard.dataset.reservedSeats).toBe('3');
    expect(duneCard.dataset.foundedSeats).toBe('5');
    expect(duneCard.dataset.livingColonies).toBe('4');
    expect(duneCard.dataset.onlinePlayers).toBe('3');
    expect(duneCard.textContent).toContain('20/28 SEATS FREE');
    expect(duneCard.textContent).toContain('5 FOUNDED · 3 RESERVED');
    expect(duneCard.textContent).toContain('4 LIVING · 3 ONLINE');

    const oceanCard = menu.el.querySelector<HTMLElement>('.world-card[data-k="oceanForest"]')!;
    expect(oceanCard.dataset.availability).toBe('full');
    expect(oceanCard.textContent).toContain('0/28 SEATS FREE');

    const tempCard = menu.el.querySelector<HTMLElement>('.world-card[data-k="forestRock"]')!;
    expect(tempCard.dataset.availability).toBe('paused');
    expect(tempCard.querySelector('[data-testid="world-live-meta-forestRock"]')?.textContent).toBe('');

    menu.setPlanetList(
      makePlanetListFixture({ temperate: { health: 'FAULTED', availability: 'faulted' } }),
    );
    expect(tempCard.dataset.availability).toBe('faulted');
    expect(menu.el.querySelectorAll('.world-card')).toHaveLength(3);
    menu.dispose();
  });
});

describe('W11-22 · Sector chooser & explicit Automatic Sector option', () => {
  it('lists 7 land sectors + AUTO option and updates getSectorIntent() and onDeploy()', () => {
    const root = document.createElement('div');
    const selectedIntents: SectorIntentV1[] = [];
    const deployedArgs: Array<{ kind: PlanetKind; seed: number; intent: SectorIntentV1 }> = [];
    const menu = new MainMenu(
      root,
      makeNoopCallbacks({
        onSector: (intent) => selectedIntents.push(intent),
        onDeploy: (kind, seed, _settings, intent) => deployedArgs.push({ kind, seed, intent }),
      }),
      'dune',
      12345,
      { planetList: makePlanetListFixture() },
    );

    const picker = menu.el.querySelector<HTMLElement>('[data-testid="sector-picker"]')!;
    expect(picker.dataset.landSectors).toBe('7');
    expect(picker.dataset.oceanSectors).toBe('2');

    const landBtns = [...picker.querySelectorAll<HTMLElement>('.sector-opt-land')];
    expect(landBtns).toHaveLength(7);
    expect(landBtns.map((b) => b.dataset.sectorId)).toEqual(
      W11_SEVEN_SECTOR_COORDS.map(([q, r]) => formatSectorId(q, r)),
    );
    for (const btn of landBtns) {
      expect(btn.dataset.availability).toBe('open');
      expect(btn.dataset.freeSeats).toBe('4');
      expect(btn.dataset.validatedCapacity).toBe('4');
      expect(btn.textContent).toContain('4/4');
      expect(btn.textContent).toContain('metals.t1');
    }

    expect(menu.getSectorIntent()).toEqual({ mode: 'auto' });
    expect(toSectorPlacementIntentV1(menu.getSectorIntent())).toEqual({ kind: 'auto' });

    picker.querySelector<HTMLElement>('[data-testid="sector-opt-sec_1_-1"]')!.click();
    expect(menu.getSectorIntent()).toEqual({ mode: 'chosen', sectorId: 'sec_1_-1' });
    expect(toSectorPlacementIntentV1(menu.getSectorIntent())).toEqual({
      kind: 'chosen',
      sectorId: 'sec_1_-1',
    });
    expect(selectedIntents).toEqual([{ mode: 'chosen', sectorId: 'sec_1_-1' }]);

    menu.el.querySelector<HTMLElement>('[data-testid="sector-opt-auto"]')!.click();
    expect(menu.getSectorIntent()).toEqual({ mode: 'auto' });

    menu.el.querySelector<HTMLElement>('[data-testid="sector-opt-sec_0_0"]')!.click();
    menu.el.querySelector<HTMLButtonElement>('#deploy')!.click();
    expect(deployedArgs).toEqual([
      { kind: 'dune', seed: 12345, intent: { mode: 'chosen', sectorId: 'sec_0_0' } },
    ]);
    menu.dispose();
  });
});

describe('W11-22 · Lobby WS + HTTP polling fallback', () => {
  it('acceptance: Block lobby WS -> polling updates full/paused sector availability and counts', async () => {
    const root = document.createElement('div');
    let scheduledPollCb: (() => void) | null = null;
    const clearIntervalSpy = vi.fn();
    const fakeTimer = {
      setInterval: vi.fn((cb: () => void) => {
        scheduledPollCb = cb;
        return 77;
      }),
      clearInterval: clearIntervalSpy,
    };

    const snapshots = makePollingSnapshots();
    let pollIdx = 0;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => snapshots[Math.min(pollIdx++, snapshots.length - 1)],
    }));
    const blockedWsFactory = vi.fn((): LobbyWsLike | null => {
      throw new Error('WebSocket blocked by policy');
    });

    const menu = new MainMenu(root, makeNoopCallbacks(), 'dune');
    const feed = menu.connectLobbyFeed({
      createWebSocket: blockedWsFactory,
      fetch: fetchSpy,
      timer: fakeTimer,
      pollIntervalMs: 1000,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(blockedWsFactory).toHaveBeenCalledTimes(1);
    expect(feed.getMode()).toBe('polling');
    expect(feed.isPolling()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const duneCard = menu.el.querySelector<HTMLElement>('.world-card[data-k="dune"]')!;
    expect(duneCard.dataset.availability).toBe('open');
    expect(duneCard.dataset.freeSeats).toBe('28');
    menu.el.querySelector<HTMLElement>('[data-testid="sector-opt-sec_0_0"]')!.click();

    // Poll #2 -> full
    scheduledPollCb!();
    await Promise.resolve();
    await Promise.resolve();
    expect(duneCard.dataset.availability).toBe('full');
    expect(duneCard.dataset.freeSeats).toBe('0');
    expect(duneCard.dataset.reservedSeats).toBe('7');
    expect(duneCard.dataset.foundedSeats).toBe('21');
    expect(duneCard.dataset.onlinePlayers).toBe('14');
    const sec00Full = menu.el.querySelector<HTMLElement>('[data-testid="sector-opt-sec_0_0"]')!;
    expect(sec00Full.dataset.availability).toBe('full');
    expect(sec00Full.dataset.freeSeats).toBe('0');
    expect(sec00Full.textContent).toContain('0/4');
    expect(sec00Full.textContent).toContain('FULL');

    // Poll #3 -> paused + queuePaused=true
    scheduledPollCb!();
    await Promise.resolve();
    await Promise.resolve();
    expect(menu.isQueuePaused()).toBe(true);
    expect(duneCard.dataset.availability).toBe('paused');
    expect(duneCard.dataset.foundedSeats).toBe('16');
    expect(duneCard.dataset.onlinePlayers).toBe('11');
    const sec00Paused = menu.el.querySelector<HTMLElement>('[data-testid="sector-opt-sec_0_0"]')!;
    expect(sec00Paused.dataset.availability).toBe('paused');
    expect(sec00Paused.textContent).toContain('PAUSED');
    expect(menu.el.querySelector('[data-testid="sector-queue-paused"]')).not.toBeNull();

    menu.dispose();
    expect(clearIntervalSpy).toHaveBeenCalledWith(77);
  });
});

describe('W11-22 · Active lobby WS disconnect fallback', () => {
  it('switches from active lobby WS to HTTP polling when the WS disconnects', async () => {
    const root = document.createElement('div');
    let socket: LobbyWsLike | null = null;
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        makePlanetListFixture({
          ocean: { reservedSeats: 4, foundedSeats: 24, freeSeats: 0, availability: 'full' },
        }),
    }));

    const menu = new MainMenu(root, makeNoopCallbacks(), 'oceanForest');
    const feed = new LobbyPlanetFeed({
      createWebSocket: () => {
        socket = { onopen: null, onmessage: null, onerror: null, onclose: null, close: vi.fn() };
        return socket;
      },
      fetch: fetchSpy,
      pollIntervalMs: 5000,
    });
    menu.attachFeed(feed);
    feed.start();
    await Promise.resolve();
    await Promise.resolve();

    socket!.onopen?.({});
    expect(feed.getMode()).toBe('ws');
    expect(feed.isPolling()).toBe(false);

    socket!.onmessage?.({
      data: JSON.stringify({
        type: 'planets.changed',
        data: makePlanetListFixture({ ocean: { admission: 'PAUSED', availability: 'paused' } }),
      }),
    });
    const oceanCard = menu.el.querySelector<HTMLElement>('.world-card[data-k="oceanForest"]')!;
    expect(oceanCard.dataset.availability).toBe('paused');

    const callsBeforeClose = fetchSpy.mock.calls.length;
    socket!.onclose?.({});
    await Promise.resolve();
    await Promise.resolve();

    expect(feed.getMode()).toBe('polling');
    expect(feed.isPolling()).toBe(true);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBeforeClose);
    expect(oceanCard.dataset.availability).toBe('full');

    feed.dispose();
    menu.dispose();
  });
});
