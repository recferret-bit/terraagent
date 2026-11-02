// @vitest-environment jsdom
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeWire, encodeWire, flagsFromList } from '@terra/contracts';
import { compileData, createPlanet, ENTITY_KIND, SIM_VERSION, SimHost, spawnColonyLanding } from '@terra/sim';
import type { SocketLike, WsTransportDeps } from '../../net/WsTransport';
import { DEVICE_SECRET_KEY, bootAuthAndHome, type FetchLike, type StorageLike } from './bootOnline';
import { activeHome, TEST_COLONY_ID } from './homeFixture';
import { extractPodDescentStatus } from './podStatus';
import { onlineMode } from './onlineMode';
import { OnlineSession } from './OnlineSession';

const TEST_PLAYER_ID = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** A fresh jsdom page: the session's root `app` inside `body` (the overlays mount on `body`). */
function setupDom(): { body: HTMLElement; app: HTMLElement } {
  const app = document.createElement('div');
  document.body.replaceChildren(app);
  return { body: document.body, app };
}

beforeAll(() => {
  // jsdom has no canvas backend: the viewport and the touchdown dust ask for contexts; null keeps them off without noise
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // no frame loop: these specs drive the sim, not the seconds-long touchdown animation (PodTouchdownFx then shows the
  // HQ as soon as the sim lands it)
  vi.stubGlobal('requestAnimationFrame', undefined);
});
afterAll(() => { vi.unstubAllGlobals(); });

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

const flush = async (rounds = 4): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

function stubMeshFactory(id: string): THREE.Object3D {
  const g = new THREE.Group();
  g.name = id;
  g.userData = {
    archetypeId: id,
    uniforms: { uTime: { value: 0 }, uWalkWeight: { value: 0 }, uWorkWeight: { value: 0 } },
  };
  return g;
}

function createMockAuthFetch(accessToken: string, expectedSecret?: string): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = vi.fn(async (url, init) => {
    calls.push({ url, init });
    if (url === '/v1/auth/guest') {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { deviceSecret?: string };
      expect(parsed.deviceSecret?.length).toBeGreaterThanOrEqual(16);
      if (expectedSecret) expect(parsed.deviceSecret).toBe(expectedSecret);
      expect(init?.credentials).toBe('include');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accessToken,
            expiresIn: 900,
            player: { id: TEST_PLAYER_ID, handle: 'Colonist-0001', isGuest: true },
          };
        },
      };
    }
    if (url.split('?')[0] === '/v1/me/home') { // `?type=` from the orbit pick
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${accessToken}`);
      return {
        ok: true,
        status: 200,
        async json() {
          return activeHome({ type: 'temperate', radius: 16 });
        },
      };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  });
  return { fetch, calls };
}

function createServerSimWithColony(initialSteps = 0): { serverSim: SimHost; podEntityId: number } {
  const serverSim = new SimHost({ flags: flagsFromList(['W00', 'W01']) });
  const planetState = createPlanet({ id: 'pl_dev', type: 'temperate', seed: 'golden-1', radius: 16 });
  const landed = spawnColonyLanding(planetState, {
    colonyId: 0,
    colonyIdStr: TEST_COLONY_ID,
    name: "Colonist-0001's Colony",
    q: 4,
    r: -2,
  });
  if (!landed.ok) throw new Error(`landing rejected: ${landed.code}`);
  const { podEntityId } = landed;
  serverSim.load(planetState);
  if (initialSteps > 0) serverSim.step(initialSteps);
  return { serverSim, podEntityId };
}

function createMockWsHarness(serverSim: SimHost): {
  wsDeps: WsTransportDeps;
  wsFramesSent: Array<{ v: number; t: string; d: Record<string, unknown> }>;
  stepServer(ticks: number): void;
} {
  const wsFramesSent: Array<{ v: number; t: string; d: Record<string, unknown> }> = [];
  let activeSocket: SocketLike | null = null;
  const wsDeps: WsTransportDeps = {
    socket() {
      const sock: SocketLike = {
        binaryType: 'arraybuffer',
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(raw) {
          const msg = decodeWire(raw as string | ArrayBuffer) as { v: number; t: string; d: Record<string, unknown> };
          wsFramesSent.push(msg);
          if (msg.t === 'hello') {
            queueMicrotask(() => {
              sock.onmessage?.({
                data: encodeWire({
                  v: 1,
                  t: 'ready',
                  d: { playerId: TEST_PLAYER_ID, flags: ['W00', 'W01'] },
                }),
              });
            });
          } else if (msg.t === 'cmd') {
            const d = msg.d as { kind: string; args: unknown };
            serverSim.submit({ colonyIndex: 0, source: 'player', commandId: (msg as unknown as { id: string }).id, kind: d.kind, args: d.args });
          } else if (msg.t === 'join') {
            queueMicrotask(() => {
              sock.onmessage?.({
                data: encodeWire({
                  v: 1,
                  t: 'welcome',
                  d: {
                    reason: 'join',
                    colonyId: TEST_COLONY_ID,
                    planet: { id: 'pl_dev', type: 'temperate', name: 'Dev Planet' },
                    state: serverSim.snapshot(),
                    simVersion: SIM_VERSION,
                    dataHash: compileData(flagsFromList(['W00', 'W01'])).hash,
                    tick: serverSim.tick,
                    serverTimeMs: Date.now(),
                    tickMs: 200,
                    deltaHz: 5,
                    flags: ['W00', 'W01'],
                  },
                }),
              });
            });
          }
        },
        close() {},
      };
      activeSocket = sock;
      queueMicrotask(() => sock.onopen?.());
      return sock;
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: () => 0.5,
    clientVersion: '0.1.0-test',
  };
  const stepServer = (ticks: number): void => {
    const fromTick = serverSim.tick;
    serverSim.step(ticks);
    const toTick = serverSim.tick;
    const diff = serverSim.diffSince(fromTick);
    activeSocket?.onmessage?.({
      data: encodeWire({ v: 1, t: 'delta', d: { fromTick, toTick, diff } }),
    });
  };
  return { wsDeps, wsFramesSent, stepServer };
}

describe('W01-38: /play.html fresh profile boot flow & conditional descent', () => {
  it('1. fresh profile calls POST /v1/auth/guest and GET /v1/me/home, shows "Contacting orbit…" splash, joins pl_dev, shows descent while pod descends, and transitions to colony view when HQ lands with zero clicks', async () => {
    const { body, app } = setupDom();
    const storage = createMemoryStorage();
    expect(storage.getItem(DEVICE_SECRET_KEY)).toBeNull();

    const { fetch: mockFetch, calls } = createMockAuthFetch('jwt_fresh_guest_token');
    const { serverSim, podEntityId } = createServerSimWithColony(0);
    const { wsDeps, wsFramesSent, stepServer } = createMockWsHarness(serverSim);

    const session = new OnlineSession(app, 'boot', {
      uiParent: body,
      fetch: mockFetch,
      storage,
      search: '',
      makeMesh: stubMeshFactory,
      wsDeps,
    });

    const splashEl = body.querySelector<HTMLElement>('[data-testid="orbital-splash"]')!;
    const splashStatusEl = body.querySelector<HTMLElement>('[data-testid="orbital-splash-status"]')!;
    const descentEl = body.querySelector<HTMLElement>('[data-testid="descent-phase"]')!;
    const colonyEl = body.querySelector<HTMLElement>('[data-testid="colony-view"]')!;

    expect(splashEl.hidden).toBe(false);
    expect(splashStatusEl.textContent).toBe('Contacting orbit…');
    expect(descentEl.hidden).toBe(true);
    expect(colonyEl.hidden).toBe(true);

    await session.whenBooted;
    await flush(6);

    expect(storage.getItem(DEVICE_SECRET_KEY)?.length).toBeGreaterThanOrEqual(16);
    expect(calls.map((c) => c.url)).toEqual(['/v1/auth/guest', '/v1/me/home']);
    expect(wsFramesSent.map((m) => m.t)).toEqual(['hello', 'join']);
    expect(wsFramesSent[1].d).toEqual({ planetId: 'pl_dev' });

    expect(session.bootPhase).toBe('descent');
    expect(splashEl.hidden).toBe(true);
    expect(descentEl.hidden).toBe(false);
    expect(colonyEl.hidden).toBe(true);
    expect(session.cameraTargetTile).toEqual({ q: 4, r: -2 });
    expect(session.entities.getRecord(podEntityId)?.targetPos.y).toBeGreaterThan(10);

    stepServer(15);
    await flush(4);
    expect(session.bootPhase).toBe('descent');

    stepServer(15);
    await flush(4);
    expect(session.bootPhase).toBe('colony');
    expect(descentEl.hidden).toBe(true);
    expect(colonyEl.hidden).toBe(false);
    expect(colonyEl.dataset.planetId).toBe('pl_dev');
    expect(session.getSelectedEntityId()).not.toBeNull();

    session.dispose();
  });
});

describe('W01-38: returning profile & local fallback', () => {
  it('2. re-opening when HQ has already landed skips descent and goes straight to the colony view on pl_dev', async () => {
    const { body, app } = setupDom();
    const existingSecret = '0123456789abcdef0123456789abcdef';
    const storage = createMemoryStorage({ [DEVICE_SECRET_KEY]: existingSecret });

    const { fetch: mockFetch } = createMockAuthFetch('jwt_returning_guest_token', existingSecret);
    const { serverSim } = createServerSimWithColony(35);
    const statusBefore = extractPodDescentStatus(serverSim.view(), 0);
    expect(statusBefore.descending).toBe(false);
    expect(statusBefore.hqLanded).toBe(true);

    const { wsDeps } = createMockWsHarness(serverSim);
    const session = new OnlineSession(app, 'boot', {
      uiParent: body,
      fetch: mockFetch,
      storage,
      search: '',
      makeMesh: stubMeshFactory,
      wsDeps,
    });

    await session.whenBooted;
    await flush(6);

    const splashEl = body.querySelector<HTMLElement>('[data-testid="orbital-splash"]')!;
    const descentEl = body.querySelector<HTMLElement>('[data-testid="descent-phase"]')!;
    const colonyEl = body.querySelector<HTMLElement>('[data-testid="colony-view"]')!;

    expect(session.bootOverlay?.descentShownCount).toBe(0);
    expect(session.bootPhase).toBe('colony');
    expect(splashEl.hidden).toBe(true);
    expect(descentEl.hidden).toBe(true);
    expect(colonyEl.hidden).toBe(false);
    expect(colonyEl.dataset.planetId).toBe('pl_dev');
    expect(session.cameraTargetTile).toEqual({ q: 4, r: -2 });
    expect(session.getSelectedEntityId()).toBe(statusBefore.hqEntityId);

    session.dispose();
  });

  it('3. falls back cleanly to local SimHost on pl_dev when backend is unreachable, and preserves W00 / prototype URL routing', async () => {
    expect(onlineMode('')).toBe('boot');
    expect(onlineMode('?skip=1')).toBe('boot');
    expect(onlineMode('?scenario=w01')).toBe('boot');
    expect(onlineMode('?host=local&scenario=w01')).toBe('boot');
    expect(onlineMode('?scenario=w00&as=e2e')).toBe('scenario');
    expect(onlineMode('?scenario=w00&waves=..00&as=e2e')).toBe('scenario');
    expect(onlineMode('?waves=..00')).toBeNull();
    expect(onlineMode('?host=local')).toBeNull();
    expect(onlineMode('?planet=dune&seed=1&skip=1')).toBeNull();

    const storage = createMemoryStorage();
    const statuses: string[] = [];
    const boot = await bootAuthAndHome({
      storage,
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
      onStatus: (s) => statuses.push(s),
    });

    expect(boot.mode).toBe('local');
    expect(boot.planet.id).toBe('pl_dev');
    expect(boot.planet.type).toBe('desert'); // DEV_PLANET_TYPE (D-38)
    expect(boot.planet.radius).toBe(56);
    expect(boot.localHost).toBeDefined();
    expect(statuses).toContain('Contacting orbit…');
    expect(statuses).toContain('Entering orbit: pl_dev…');

    const status = extractPodDescentStatus(boot.localHost!.sim.view(), 0);
    expect(status.descending).toBe(true);
    expect(status.hqLanded).toBe(false);
    expect(status.podEntityId).not.toBeNull();

    boot.localHost!.step(30);
    const afterLanding = extractPodDescentStatus(boot.localHost!.sim.view(), 0);
    expect(afterLanding.descending).toBe(false);
    expect(afterLanding.hqLanded).toBe(true);
    expect(afterLanding.hqEntityId).not.toBeNull();
    expect(boot.localHost!.state.entities.cols.kind[0]).toBe(ENTITY_KIND.pod);
  });
});

describe('W01-38: 3D pod descent handoff & return to orbit', () => {
  it('4. hand-off from 3D pod descent (skipDescent: true, planetKind) starts immediately in colony view and returnToOrbit restores planetKind', async () => {
    const { body, app } = setupDom();
    const storage = createMemoryStorage();
    const { fetch: mockFetch } = createMockAuthFetch('jwt_handoff_token');
    const { serverSim } = createServerSimWithColony(0);
    const { wsDeps, wsFramesSent, stepServer } = createMockWsHarness(serverSim);
    let returnedKind: string | null = null;

    const session = new OnlineSession(app, 'boot', {
      uiParent: body,
      fetch: mockFetch,
      storage,
      search: '',
      planetKind: 'oceanForest',
      skipDescent: true,
      makeMesh: stubMeshFactory,
      wsDeps,
      onReturnToOrbit: (k) => {
        returnedKind = k;
      },
    });

    await session.whenBooted;
    await flush(6);

    expect(session.bootPhase).toBe('colony');
    expect(session.planetKind).toBe('oceanForest');
    // fast start (FA-08): the player command `landPod`, allowed in production, not the admin `dev.land`
    expect(wsFramesSent.filter((m) => m.t === 'cmd').map((m) => m.d)).toEqual([{ kind: 'landPod', args: {} }]);
    stepServer(25); // hq.startingKit.podLandMinS = 5 s: the pod opens then, before its 6 s descent ends
    expect(extractPodDescentStatus(serverSim.view(), 0)).toMatchObject({ descending: false, hqLanded: true });
    session.returnToOrbit();
    expect(returnedKind).toBe('oceanForest');

    session.dispose();
  });
});
