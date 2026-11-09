// @vitest-environment jsdom
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BootOverlay } from './BootOverlay';
import { DEVICE_SECRET_KEY, type FetchLike, type StorageLike } from './bootOnline';
import {
  JoinQueueCoordinator,
  PENDING_JOIN_TICKET_KEY,
  bootOrPollQueuedHome,
  getOrCreatePendingJoinIntent,
  readPendingJoinIntent,
} from './joinQueueFlow';
import { OnlineSession } from './OnlineSession';

const TEST_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function setupDom(): { body: HTMLElement; app: HTMLElement } {
  const app = document.createElement('div');
  document.body.replaceChildren(app);
  return { body: document.body, app };
}

function createMemoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { store: Map<string, string>; removeItem(key: string): void } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
}

function stubMeshFactory(id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = id;
  g.userData = {
    archetypeId: id,
    uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } },
  };
  return g;
}

const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return body; },
});

function createReloadQueueMockFetch(
  postCalls: Array<{ url: string; body: Record<string, unknown>; idempotencyKey?: string }>,
  homeCalls: string[],
): FetchLike {
  let homePollCount = 0;
  return vi.fn(async (url, init) => {
    if (url === '/v1/auth/guest' || url === '/v1/auth/refresh') {
      return jsonRes(200, {
        accessToken: 'jwt_w11_guest',
        expiresIn: 900,
        player: { id: TEST_PLAYER_ID, handle: 'Colonist-W11', isGuest: true },
      });
    }
    if (url === '/v1/match/tickets' && init?.method === 'POST') {
      const parsed = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      const headers = (init.headers ?? {}) as Record<string, string>;
      postCalls.push({
        url,
        body: parsed,
        idempotencyKey: headers['Idempotency-Key'] ?? headers['idempotency-key'],
      });
      return jsonRes(200, {
        id: 'tkt_1',
        state: 'QUEUED',
        planetId: 'pl_desert',
        planetType: 'desert',
        sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
        position: 1,
        etaS: 10,
      });
    }
    if (url.startsWith('/v1/me/home')) {
      homeCalls.push(url);
      homePollCount++;
      if (homePollCount === 1) return jsonRes(200, { state: 'NEW', planets: [], newPlanetTypes: [] });
      if (homePollCount <= 4) {
        return jsonRes(200, {
          state: 'QUEUED',
          ticket: {
            id: 'tkt_1',
            planetType: 'desert',
            targetPlanetId: 'pl_desert',
            sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
            position: 1,
            estimatedWaitS: 5,
            status: 'WAITING',
            alternativeSectors: ['sec_1_0'],
          },
        });
      }
      return jsonRes(200, {
        state: 'ACTIVE',
        planet: { id: 'pl_desert', name: 'Kharon Dunes', type: 'desert', state: 'ACTIVE', seats: { taken: 4, capacity: 28 } },
        colony: {
          id: 'col_42',
          planetId: 'pl_desert',
          colonyIndex: 3,
          name: "Colonist-W11's Colony",
          color: 3,
          state: 'ACTIVE',
          foundingSectorId: 'sec_0_0',
          spawnQ: 12,
          spawnR: -5,
        },
      });
    }
    return jsonRes(404, {});
  });
}

function createSectorIntentMockFetch(
  postBodies: Array<{ body: Record<string, unknown>; headerKey: string }>,
  ticketId: string,
  planetId: string,
  planetType: 'desert' | 'ocean',
): FetchLike {
  return vi.fn(async (url, init) => {
    if (url === '/v1/auth/guest' || url === '/v1/auth/refresh') {
      return jsonRes(200, {
        accessToken: 'jwt_intent_test',
        expiresIn: 900,
        player: { id: TEST_PLAYER_ID, handle: 'Colonist', isGuest: true },
      });
    }
    if (url === '/v1/match/tickets' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      const headers = (init.headers ?? {}) as Record<string, string>;
      postBodies.push({
        body,
        headerKey: headers['Idempotency-Key'] ?? headers['idempotency-key'] ?? '',
      });
      return jsonRes(200, {
        id: ticketId,
        state: 'QUEUED',
        planetId,
        planetType,
        sectorIntent: body.sectorId ? { kind: 'chosen', sectorId: body.sectorId } : { kind: 'auto' },
        position: 1,
        etaS: 4,
      });
    }
    if (url.startsWith('/v1/me/home')) {
      if (postBodies.length === 0) return jsonRes(200, { state: 'NEW', planets: [], newPlanetTypes: [] });
      return jsonRes(200, {
        state: 'ACTIVE',
        planet: { id: planetId, name: 'World', type: planetType, state: 'ACTIVE' },
        colony: {
          id: 'col_99',
          planetId,
          colonyIndex: 1,
          name: 'Colony',
          color: 1,
          state: 'ACTIVE',
          foundingSectorId: 'sec_1_0',
          spawnQ: -3,
          spawnR: 7,
        },
      });
    }
    return jsonRes(404, {});
  });
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', undefined);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('W11-33 Acceptance: Reload waiting ticket then assign', () => {
  it('reloads waiting ticket then assigns -> one descent into col_42 at (12, -5) with zero duplicate ticket POSTs', async () => {
    const { body } = setupDom();
    const storage = createMemoryStorage();
    const overlay = new BootOverlay(body);
    const postCalls: Array<{ url: string; body: Record<string, unknown>; idempotencyKey?: string }> = [];
    const homeCalls: string[] = [];
    const descents: Array<{ q: number; r: number; colonyId: string; planetId: string }> = [];
    const mockFetch = createReloadQueueMockFetch(postCalls, homeCalls);

    let pollStep1 = 0;
    let releaseReloadGate!: () => void;
    const reloadGate = new Promise<void>((r) => { releaseReloadGate = r; });

    const coord1 = new JoinQueueCoordinator({
      fetch: mockFetch,
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      enqueueOnNew: true,
      bootOverlay: overlay,
      wait: async () => {
        pollStep1++;
        if (pollStep1 >= 2) await reloadGate;
      },
      onDescent: (d) => descents.push(d),
    });

    const run1Promise = coord1.start();
    await new Promise((r) => setTimeout(r, 10));

    const queueStatusEl = body.querySelector<HTMLElement>('[data-testid="queue-status"]')!;
    expect(queueStatusEl.hidden).toBe(false);
    expect(queueStatusEl.dataset.ticketId).toBe('tkt_1');
    expect(queueStatusEl.dataset.planetId).toBe('pl_desert');
    expect(queueStatusEl.dataset.sectorId).toBe('sec_0_0');
    expect(queueStatusEl.dataset.position).toBe('1');
    expect(overlay.descentShownCount).toBe(0);
    expect(postCalls).toHaveLength(1);

    const secretBeforeReload = storage.getItem(DEVICE_SECRET_KEY);
    expect(secretBeforeReload?.length).toBeGreaterThanOrEqual(16);
    expect(readPendingJoinIntent(storage)?.ticketId).toBe('tkt_1');

    coord1.dispose();
    releaseReloadGate();
    expect(await run1Promise).toBeNull();
    expect(overlay.descentShownCount).toBe(0);

    const coord2 = new JoinQueueCoordinator({
      fetch: mockFetch,
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      enqueueOnNew: true,
      bootOverlay: overlay,
      wait: async () => {},
      onDescent: (d) => descents.push(d),
    });

    const assigned = await coord2.start();
    expect(assigned?.planet.id).toBe('pl_desert');
    expect(assigned?.colony.id).toBe('col_42');
    expect(assigned?.colony.colonyIndex).toBe(3);
    expect(assigned?.colony.spawn).toEqual({ q: 12, r: -5 });
    expect(assigned?.colony.foundingSectorId).toBe('sec_0_0');
    expect(assigned?.foundingSectorId).toBe('sec_0_0');
    expect(storage.getItem(DEVICE_SECRET_KEY)).toBe(secretBeforeReload);
    expect(postCalls).toHaveLength(1);
    expect(readPendingJoinIntent(storage)).toBeNull();

    expect(overlay.descentShownCount).toBe(1);
    expect(overlay.phase).toBe('descent');
    expect(overlay.descentCoordsEl.textContent).toBe('(12, -5)');
    expect(queueStatusEl.hidden).toBe(true);
    expect(descents).toEqual([{ progress: 0, q: 12, r: -5, colonyId: 'col_42', planetId: 'pl_desert' }]);

    overlay.dispose();
  });
});

describe('W11-33 Sector intent & Idempotency-Key', () => {
  it('passes chosen sector vs automatic sector intent through POST /v1/match/tickets with idempotent key reuse', async () => {
    const storage = createMemoryStorage();
    const postBodies: Array<{ body: Record<string, unknown>; headerKey: string }> = [];

    const intent1 = getOrCreatePendingJoinIntent(storage, {
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_1_0' },
    });
    const intent1Again = getOrCreatePendingJoinIntent(storage, {
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_1_0' },
    });
    expect(intent1Again.idempotencyKey).toBe(intent1.idempotencyKey);
    expect(intent1.sectorIntent).toEqual({ kind: 'chosen', sectorId: 'sec_1_0' });

    await bootOrPollQueuedHome({
      fetch: createSectorIntentMockFetch(postBodies, 'tkt_chosen', 'pl_desert', 'desert'),
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_1_0' },
      enqueueOnNew: true,
      wait: async () => {},
    });

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]!.headerKey).toBe(intent1.idempotencyKey);
    expect(postBodies[0]!.body).toMatchObject({
      mode: 'JOIN_PLANET',
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorId: 'sec_1_0',
      sectorIntent: { kind: 'chosen', mode: 'chosen', sectorId: 'sec_1_0' },
      idempotencyKey: intent1.idempotencyKey,
    });

    postBodies.length = 0;
    const autoIntent = getOrCreatePendingJoinIntent(storage, {
      planetId: 'pl_ocean',
      planetType: 'ocean',
      sectorIntent: { mode: 'auto' },
    });
    expect(autoIntent.sectorIntent).toEqual({ kind: 'auto' });
    expect(autoIntent.idempotencyKey).not.toBe(intent1.idempotencyKey);

    await bootOrPollQueuedHome({
      fetch: createSectorIntentMockFetch(postBodies, 'tkt_auto', 'pl_ocean', 'ocean'),
      storage,
      planetId: 'pl_ocean',
      planetType: 'ocean',
      sectorIntent: { mode: 'auto' },
      enqueueOnNew: true,
      wait: async () => {},
    });

    expect(postBodies).toHaveLength(1);
    expect(postBodies[0]!.headerKey).toBe(autoIntent.idempotencyKey);
    expect(postBodies[0]!.body).toMatchObject({
      mode: 'JOIN_PLANET',
      planetId: 'pl_ocean',
      planetType: 'ocean',
      autoSector: true,
      sectorIntent: { kind: 'auto', mode: 'auto' },
      idempotencyKey: autoIntent.idempotencyKey,
    });
  });
});

describe('W11-33 Queue cancellation & Active colony reload', () => {
  it('cancels queued ticket via DELETE /v1/match/tickets/:id, stops polling, and returns to orbit with zero descents', async () => {
    const { body } = setupDom();
    const storage = createMemoryStorage();
    const overlay = new BootOverlay(body);
    const deleteCalls: string[] = [];
    let homePolls = 0;
    let returnedToOrbit = 0;
    let cancelledTicketId: string | null = null;

    const mockFetch: FetchLike = vi.fn(async (url, init) => {
      if (url === '/v1/auth/guest' || url === '/v1/auth/refresh') {
        return jsonRes(200, {
          accessToken: 'jwt_cancel_test',
          expiresIn: 900,
          player: { id: TEST_PLAYER_ID, handle: 'Colonist', isGuest: true },
        });
      }
      if (url.startsWith('/v1/match/tickets/') && init?.method === 'DELETE') {
        deleteCalls.push(url);
        return jsonRes(200, { id: 'tkt_1', state: 'CANCELLED' });
      }
      if (url.startsWith('/v1/me/home')) {
        homePolls++;
        return jsonRes(200, {
          state: 'QUEUED',
          ticketId: 'tkt_1',
          ticketState: 'QUEUED',
          planetId: 'pl_desert',
          planetType: 'desert',
          sectorIntent: { kind: 'chosen', sectorId: 'sec_0_0' },
          position: 2,
          etaS: 20,
        });
      }
      return jsonRes(404, {});
    });

    let waitResolve!: () => void;
    const coord = new JoinQueueCoordinator({
      fetch: mockFetch,
      storage,
      planetId: 'pl_desert',
      planetType: 'desert',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_0_0' },
      bootOverlay: overlay,
      wait: () => new Promise<void>((r) => { waitResolve = r; }),
      onCancel: (id) => { cancelledTicketId = id; },
      onReturnToOrbit: () => { returnedToOrbit++; },
    });

    const startPromise = coord.start();
    await new Promise((r) => setTimeout(r, 10));

    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-testid="queue-cancel-btn"]')!;
    const queueStatus = body.querySelector<HTMLElement>('[data-testid="queue-status"]')!;
    expect(queueStatus.hidden).toBe(false);
    expect(readPendingJoinIntent(storage)?.ticketId).toBe('tkt_1');

    cancelBtn.click();
    waitResolve?.();

    expect(await startPromise).toBeNull();
    expect(deleteCalls).toEqual(['/v1/match/tickets/tkt_1']);
    expect(cancelledTicketId).toBe('tkt_1');
    expect(returnedToOrbit).toBe(1);
    expect(queueStatus.hidden).toBe(true);
    expect(overlay.descentShownCount).toBe(0);
    expect(storage.getItem(PENDING_JOIN_TICKET_KEY)).toBe('');
    expect(readPendingJoinIntent(storage)).toBeNull();

    const pollsAfterCancel = homePolls;
    await new Promise((r) => setTimeout(r, 10));
    expect(homePolls).toBe(pollsAfterCancel);
    overlay.dispose();
  });
});

describe('W11-33 Active colony reload resume', () => {
  it('resumes an already ACTIVE colony on reload without ticket enqueue and hands off once', async () => {
    const { body, app } = setupDom();
    const storage = createMemoryStorage({
      [DEVICE_SECRET_KEY]: 'abcdef0123456789abcdef0123456789',
      [PENDING_JOIN_TICKET_KEY]: JSON.stringify({
        idempotencyKey: 'idem_stale_1',
        ticketId: 'tkt_stale',
        planetId: 'pl_temperate',
        planetType: 'temperate',
        sectorIntent: { kind: 'auto' },
        createdAtMs: 1000,
      }),
    });

    const urlsCalled: string[] = [];
    const mockFetch: FetchLike = vi.fn(async (url) => {
      urlsCalled.push(url);
      if (url === '/v1/auth/refresh' || url === '/v1/auth/guest') {
        return jsonRes(200, {
          accessToken: 'jwt_active_resume',
          expiresIn: 900,
          player: { id: TEST_PLAYER_ID, handle: 'Colonist', isGuest: true },
        });
      }
      if (url.startsWith('/v1/me/home')) {
        return jsonRes(200, {
          state: 'ACTIVE',
          planet: { id: 'pl_temperate', name: 'Granite Hollow', type: 'temperate', state: 'ACTIVE', seats: { taken: 2, capacity: 28 } },
          colony: {
            id: 'col_77',
            planetId: 'pl_temperate',
            colonyIndex: 1,
            name: 'Hollow Base',
            color: 1,
            state: 'ACTIVE',
            foundingSectorId: 'sec_-1_1',
            spawnQ: -8,
            spawnR: 11,
          },
        });
      }
      return jsonRes(404, {});
    });

    const session = new OnlineSession(app, 'boot', {
      uiParent: body,
      fetch: mockFetch,
      storage,
      search: '',
      sectorIntent: { mode: 'chosen', sectorId: 'sec_-1_1' },
      makeMesh: stubMeshFactory,
    });

    const boot = await session.whenBooted;
    expect(boot?.planet.id).toBe('pl_temperate');
    expect(boot?.colony.id).toBe('col_77');
    expect(boot?.colony.spawn).toEqual({ q: -8, r: 11 });
    expect(session.foundingSectorId).toBe('sec_-1_1');
    expect(urlsCalled.some((u) => u.includes('/v1/match/tickets'))).toBe(false);
    expect(readPendingJoinIntent(storage)).toBeNull();

    session.dispose();
  });
});
