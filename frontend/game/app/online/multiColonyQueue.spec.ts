// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { resolveEnteringDeployTarget, stripColonyIdFromSearch } from '../colonyEntryBridge';
import { bootAuthAndHome, DEVICE_SECRET_KEY, type FetchLike, type StorageLike } from './bootOnline';
import { JoinQueueCoordinator } from './joinQueueFlow';

const TEST_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
  };
}

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('Multi-colony deploy target & queue polling regressions', () => {
  it('clears sticky colonyId when deploying a new colony and waits for the new colony instead of resolving the old one', async () => {
    const newTarget = resolveEnteringDeployTarget({
      kind: 'oceanForest',
      seed: 42,
      sessionSearch: '?colonyId=col_old_1&seed=42',
      mode: 'new',
      actionColony: null,
      roster: {
        primary: { kind: 'dune', planetType: 'desert', planetId: 'pl_desert', planetName: 'Kharon', colonyId: 'col_old_1', colonyName: 'Old', foundingSectorId: 'sec_0_0' },
        colonies: [{ kind: 'dune', planetType: 'desert', planetId: 'pl_desert', planetName: 'Kharon', colonyId: 'col_old_1', colonyName: 'Old', foundingSectorId: 'sec_0_0' }],
        slots: { used: 1, max: 3, aiColonySlots: 3, isStaker: true, tier: 2, stakedNear: '50' },
      },
    });
    expect(newTarget.enteringColonyId).toBeUndefined();
    expect(newTarget.kind).toBe('oceanForest');
    expect(stripColonyIdFromSearch('?seed=42&colonyId=col_old_1')).toBe('?seed=42');

    const storage = createMemoryStorage({ [DEVICE_SECRET_KEY]: 'abcdef0123456789abcdef0123456789' });
    let pollTick = 0;
    const oldEntry = {
      planet: { id: 'pl_desert', name: 'Kharon', type: 'desert', state: 'ACTIVE', seats: { taken: 1, capacity: 28 } },
      colony: { id: 'col_old_1', planetId: 'pl_desert', colonyIndex: 0, name: 'Old', color: 0, state: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0 },
    };
    const newEntry = {
      planet: { id: 'pl_desert', name: 'Kharon', type: 'desert', state: 'ACTIVE', seats: { taken: 2, capacity: 28 } },
      colony: { id: 'col_new_2', planetId: 'pl_desert', colonyIndex: 1, name: 'New', color: 1, state: 'ACTIVE', foundingSectorId: 'sec_1_0', spawnQ: 6, spawnR: -6 },
    };

    const mockFetch: FetchLike = vi.fn(async (url, init) => {
      if (url === '/v1/auth/guest') {
        return jsonRes(200, { accessToken: 'jwt_mc', expiresIn: 900, player: { id: TEST_PLAYER_ID, handle: 'Staker', isGuest: false } });
      }
      if (url === '/v1/match/tickets' && init?.method === 'POST') {
        return jsonRes(200, { id: 'tkt_mc_2', status: 'WAITING', planetId: 'pl_desert', planetType: 'desert', sectorIntent: { kind: 'auto' }, position: 1 });
      }
      if (url === '/v1/match/tickets/tkt_mc_2') {
        return jsonRes(200, { id: 'tkt_mc_2', status: 'RESERVED', reservedSectorId: 'sec_1_0', colonyId: 'col_new_2', planetId: 'pl_desert', planetType: 'desert', sectorIntent: { kind: 'auto' }, position: 1 });
      }
      if (url.startsWith('/v1/me/home')) {
        if (url.includes('new=1')) {
          return jsonRes(200, { state: 'NEW', planets: [], newPlanetTypes: [], activeColonies: [oldEntry] });
        }
        pollTick++;
        if (pollTick === 1) {
          return jsonRes(200, { state: 'ACTIVE', ...oldEntry, activeColonies: [oldEntry] });
        }
        return jsonRes(200, { state: 'ACTIVE', ...newEntry, activeColonies: [newEntry, oldEntry] });
      }
      return jsonRes(404, {});
    });

    const coord = new JoinQueueCoordinator({
      fetch: mockFetch,
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      newColony: true,
      sectorIntent: { mode: 'auto' },
      wait: async () => undefined,
    });
    const result = await coord.start();
    expect(result?.colony.id).toBe('col_new_2');
    expect(result?.foundingSectorId).toBe('sec_1_0');
  });
});

describe('Multi-colony failed ticket & multi-planet boot resolution', () => {
  it('throws TICKET_FAILED when new-colony ticket fails and selects matching planet from activeColonies on bootAuthAndHome', async () => {
    const storage = createMemoryStorage({ [DEVICE_SECRET_KEY]: 'abcdef0123456789abcdef0123456789' });
    const oldDesert = {
      planet: { id: 'pl_desert', name: 'Kharon', type: 'desert', state: 'ACTIVE', seats: { taken: 1, capacity: 28 } },
      colony: { id: 'col_old_1', planetId: 'pl_desert', colonyIndex: 0, name: 'Old', color: 0, state: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0 },
    };
    const oceanCol = {
      planet: { id: 'pl_ocean', name: 'Thalassa', type: 'ocean', state: 'ACTIVE', seats: { taken: 1, capacity: 28 } },
      colony: { id: 'col_ocean_2', planetId: 'pl_ocean', colonyIndex: 0, name: 'Reef', color: 0, state: 'ACTIVE', foundingSectorId: 'sec_1_0', spawnQ: 4, spawnR: -4 },
    };
    const mockFetch: FetchLike = vi.fn(async (url, init) => {
      if (url === '/v1/auth/guest') {
        return jsonRes(200, { accessToken: 'jwt_mc_fail', expiresIn: 900, player: { id: TEST_PLAYER_ID, handle: 'Staker', isGuest: false } });
      }
      if (url === '/v1/match/tickets' && init?.method === 'POST') {
        return jsonRes(200, { id: 'tkt_mc_fail', status: 'WAITING', planetId: 'pl_desert', planetType: 'desert', sectorIntent: { kind: 'auto' }, position: 1 });
      }
      if (url === '/v1/match/tickets/tkt_mc_fail') {
        return jsonRes(200, { id: 'tkt_mc_fail', status: 'FAILED', planetId: 'pl_desert', planetType: 'desert', sectorIntent: { kind: 'auto' } });
      }
      if (url.startsWith('/v1/me/home')) {
        if (url.includes('new=1')) return jsonRes(200, { state: 'NEW', planets: [], newPlanetTypes: [], activeColonies: [oldDesert, oceanCol] });
        return jsonRes(200, { state: 'ACTIVE', ...oldDesert, activeColonies: [oldDesert, oceanCol] });
      }
      return jsonRes(404, {});
    });

    const coord = new JoinQueueCoordinator({
      fetch: mockFetch,
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      newColony: true,
      sectorIntent: { mode: 'auto' },
      wait: async () => undefined,
    });
    await expect(coord.start()).rejects.toMatchObject({ code: 'TICKET_FAILED' });

    const bootedOcean = await bootAuthAndHome({
      fetch: mockFetch,
      storage,
      planetType: 'ocean',
      planetId: 'pl_ocean',
      search: '',
    });
    expect(bootedOcean.colony.id).toBe('col_ocean_2');
    expect(bootedOcean.planet.id).toBe('pl_ocean');
  });
});
