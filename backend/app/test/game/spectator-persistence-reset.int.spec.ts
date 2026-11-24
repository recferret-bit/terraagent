import 'reflect-metadata';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { PlanetSectorsLiveStateV1Schema, Welcome, decodeWire } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { devPlanetIds } from '../../src/game/dev-planets';
import { SimHistoryService } from '../../src/game/persistence/sim-history.service';

async function allocateFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

class WsClient {
  readonly frames: Array<{ t: string; tick?: number; d: Record<string, unknown> }> = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: Array<() => void> = [];

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      this.frames.push(decodeWire(isBinary ? buf : buf.toString('utf8')) as never);
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async open(url: string): Promise<WsClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new WsClient(ws);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }

  async next(t: string, timeoutMs = 8_000): Promise<{ t: string; tick?: number; d: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.frames.findIndex((f) => f.t === t);
      if (idx >= 0) return this.frames.splice(idx, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for WS "${t}"`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, Math.min(left, 200));
        this.waiters.push(() => {
          clearTimeout(timer);
          r();
        });
      });
    }
  }
}

let db: TestDatabase | undefined;
const apps: INestApplication[] = [];
const sockets: WebSocket[] = [];

async function ensureDb(): Promise<TestDatabase> {
  if (!db) db = await createTestDatabase();
  return db;
}

async function bootServer(databaseUrl: string, workerId: string): Promise<{ app: INestApplication; url: string }> {
  const created = await createApp({
    source: {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: databaseUrl,
      SIM_THREADS: '1',
      GAME_DEV_PLANETS: '1',
      TA_SEED_RIVAL_AI: '1',
      TA_WORKER_ID: workerId,
      SNAPSHOTS: 'on',
    },
  });
  apps.push(created.app);
  await created.app.listen(0, '127.0.0.1');
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

afterAll(async () => {
  await db?.drop();
  db = undefined;
});

async function postSpectatorJson(url: string, body: Record<string, unknown>) {
  const res = await fetch(`${url}/v1/dev/spectator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('Server spectator Postgres persistence across stack restarts & reset=true', () => {
  it('persists server spectator bots across full stack restarts and wipes cleanly on reset=true', async () => {
    const testDb = await ensureDb();
    const run1 = await bootServer(testDb.url, 'spec-worker-run1');
    const init = await postSpectatorJson(run1.url, { planetType: 'oceanForest', botCount: 3, seed: 'pg-persist' });
    expect(init.status).toBe(200);
    expect(init.json).toMatchObject({ botCount: 3, created: true });
    const planetId = String(init.json.planetId);

    await expect
      .poll(
        async () => {
          await run1.app.get(SimHistoryService).flush();
          return testDb.prisma.simInputHistory.count({ where: { planetId, isBot: true } });
        },
        { timeout: 20_000, interval: 250 },
      )
      .toBeGreaterThanOrEqual(1);

    const liveBeforeRestart = PlanetSectorsLiveStateV1Schema.parse(
      await (await fetch(`${run1.url}/v1/planets/${planetId}/live`)).json(),
    );
    expect(liveBeforeRestart.participants.filter((p) => p.isBot)).toHaveLength(3);
    expect(liveBeforeRestart.participants.filter((p) => !p.isBot)).toHaveLength(0);
    const tickBeforeRestart = liveBeforeRestart.tick;
    expect(tickBeforeRestart).toBeGreaterThan(0);

    // Record an un-flushed external decision right before shutdown to verify BeforeApplicationShutdown flushes before Prisma disconnects
    run1.app.get(SimHistoryService).recordExternalDecision({
      planetId, sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'ai:shutdown-flush-probe',
      isBot: true, actorSource: 'colony_agent', decisionKind: 'expand', summary: 'Shutdown persistence flush check',
      rationale: 'Must survive app.close() before Prisma disconnects', commandId: null, commandKind: null,
      payload: {}, outcome: 'applied', atTick: tickBeforeRestart, createdAtMs: Date.now(),
    });

    await run1.app.close();
    apps.length = 0;

    expect(await testDb.prisma.agentDecisionHistory.count({ where: { planetId, actorId: 'ai:shutdown-flush-probe' } })).toBe(1);
    expect(await testDb.prisma.sectorParticipantState.count({ where: { planetId, isBot: true } })).toBe(3);

    const run2 = await bootServer(testDb.url, 'spec-worker-run2');
    const resume = await postSpectatorJson(run2.url, { planetType: 'oceanForest', botCount: 3, seed: 'pg-persist' });
    expect(resume.status).toBe(200);
    expect(resume.json).toMatchObject({ planetId, botCount: 3, created: false, reset: false });
    expect(Number(resume.json.tick)).toBeGreaterThanOrEqual(tickBeforeRestart);

    const ws2 = await WsClient.open(`${run2.url.replace('http://', 'ws://')}/ws`);
    sockets.push(ws2.ws);
    ws2.send({ t: 'hello', d: { accessToken: 'dev:return-viewer', proto: [2], client: { app: 'game', version: 'int' } } });
    await ws2.next('ready');
    ws2.send({ t: 'join', d: { planetId, mode: 'spectator' } });
    const w2 = Welcome.parse(await ws2.next('welcome'));
    expect(w2.d.mode).toBe('spectator');
    expect(w2.d.tick).toBeGreaterThanOrEqual(tickBeforeRestart);
    expect((w2.d.recentInputs?.length ?? 0)).toBeGreaterThanOrEqual(1);
    ws2.ws.close();

    const resetOut = await postSpectatorJson(run2.url, { planetType: 'oceanForest', botCount: 3, seed: 'pg-persist', reset: true });
    expect(resetOut.status).toBe(200);
    expect(resetOut.json).toMatchObject({ planetId, tick: 0, botCount: 3, created: true, reset: true });

    await run2.app.close();
    apps.length = 0;

    const run3 = await bootServer(testDb.url, 'spec-worker-run3');
    const afterResetRestart = await postSpectatorJson(run3.url, { planetType: 'oceanForest', botCount: 3, seed: 'pg-persist' });
    expect(afterResetRestart.status).toBe(200);
    expect(afterResetRestart.json).toMatchObject({ planetId, botCount: 3, created: false });
  }, 90_000);
});

describe('Split sim-worker + api cluster spectator provisioning & reset', () => {
  it('provisions and resets server spectator across split sim-worker and api processes', async () => {
    const testDb = await ensureDb();
    const sharedEnv = {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDb.url,
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      TA_INTERNAL_SECRET: 'spec-cluster-secret',
    };
    const worker = await createApp({
      source: { ...sharedEnv, TA_SIM_ROLE: 'sim-worker', TA_WORKER_ID: 'spec-sim-1', GAME_DEV_PLANETS: '0' },
    });
    apps.push(worker.app);
    await worker.app.listen(0, '127.0.0.1');

    const api = await createApp({
      source: { ...sharedEnv, TA_SIM_ROLE: 'api', TA_WORKER_ID: 'spec-api-1', GAME_DEV_PLANETS: '0' },
    });
    apps.push(api.app);
    await api.app.listen(0, '127.0.0.1');
    const apiUrl = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');

    const initRes = await fetch(`${apiUrl}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'dune', botCount: 2, seed: 'cluster-spec' }),
    });
    expect(initRes.status).toBe(200);
    const initJson = (await initRes.json()) as { planetId: string; created: boolean; botCount: number };
    expect(initJson).toMatchObject({ created: true, botCount: 2 });

    const wsTabA = await WsClient.open(`${apiUrl.replace('http://', 'ws://')}/ws`);
    sockets.push(wsTabA.ws);
    wsTabA.send({ t: 'hello', d: { accessToken: 'dev:cluster-tab-a', proto: [2], client: { app: 'game', version: 'int' } } });
    await wsTabA.next('ready');
    wsTabA.send({ t: 'join', d: { planetId: initJson.planetId, mode: 'spectator' } });
    const w = Welcome.parse(await wsTabA.next('welcome'));
    expect(w.d.mode).toBe('spectator');
    const delta = await wsTabA.next('delta', 10_000);
    expect(Number(delta.tick ?? 0)).toBeGreaterThan(w.d.tick);

    // Tab A stays OPEN while Tab B fires reset=true concurrently; Tab A must get 4012 and cleanly rejoin via /v1/dev/spectator
    const resetPromise = fetch(`${apiUrl}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'dune', botCount: 2, seed: 'cluster-spec', reset: true }),
    });
    const closedA = await wsTabA.closed;
    expect(closedA.code).toBe(4012);

    // Tab A immediately re-ensures (without reset) while/right after Tab B's reset runs
    const tabAReensure = await fetch(`${apiUrl}/v1/dev/spectator`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planetType: 'dune', botCount: 2, seed: 'cluster-spec' }),
    });
    const resetRes = await resetPromise;
    expect(resetRes.status).toBe(200);
    expect(tabAReensure.status).toBe(200);
    expect(await resetRes.json()).toMatchObject({
      planetId: initJson.planetId,
      tick: 0,
      botCount: 2,
      created: true,
      reset: true,
    });

    const wsTabARejoined = await WsClient.open(`${apiUrl.replace('http://', 'ws://')}/ws`);
    sockets.push(wsTabARejoined.ws);
    wsTabARejoined.send({ t: 'hello', d: { accessToken: 'dev:cluster-tab-a', proto: [2], client: { app: 'game', version: 'int' } } });
    await wsTabARejoined.next('ready');
    wsTabARejoined.send({ t: 'join', d: { planetId: initJson.planetId, mode: 'spectator' } });
    const wAfterReset = Welcome.parse(await wsTabARejoined.next('welcome'));
    expect(wAfterReset.d.mode).toBe('spectator');
    const deltaAfterReset = await wsTabARejoined.next('delta', 10_000);
    expect(Number(deltaAfterReset.tick ?? 0)).toBeGreaterThan(0);
    wsTabARejoined.ws.close();
  }, 90_000);
});

async function bootClusterWorker(
  sharedEnv: Record<string, string>,
  workerId: string,
  devPlanets = '1',
): Promise<INestApplication> {
  const port = await allocateFreePort();
  const worker = await createApp({
    source: {
      ...sharedEnv,
      PORT: String(port),
      TA_SIM_ROLE: 'sim-worker',
      TA_WORKER_ID: workerId,
      TA_INTERNAL_URL: `http://127.0.0.1:${port}`,
      GAME_DEV_PLANETS: devPlanets,
    },
  });
  apps.push(worker.app);
  await worker.app.listen(port, '127.0.0.1');
  return worker.app;
}

async function severHttpServer(app: INestApplication): Promise<void> {
  const srv = app.getHttpServer() as { closeAllConnections?: () => void; close: (cb: () => void) => void };
  srv.closeAllConnections?.();
  await new Promise<void>((r) => srv.close(() => r()));
}

describe('Split sim-worker + api staggered restart persistence & TA_INTERNAL_URL startup race', () => {
  it('waits for sim-worker HTTP readiness when TA_INTERNAL_URL & GAME_DEV_PLANETS=1 are set (both ensure, reset, and /ws join)', async () => {
    const testDb = await ensureDb();
    const devPlanetId = devPlanetIds(1, 1)[0]!;
    const sharedEnv = {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDb.url,
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      TA_SEED_RIVAL_AI: '1',
      TA_INTERNAL_SECRET: 'spec-cluster-secret',
    };
    await bootClusterWorker(sharedEnv, 'spec-sim-a');
    const api1 = await createApp({
      source: { ...sharedEnv, TA_SIM_ROLE: 'api', TA_WORKER_ID: 'spec-api-a', GAME_DEV_PLANETS: '1' },
    });
    apps.push(api1.app);
    await api1.app.listen(0, '127.0.0.1');
    const api1Url = (await api1.app.getUrl()).replace('[::1]', '127.0.0.1');

    const init = await postSpectatorJson(api1Url, { planetType: 'dune', botCount: 2, seed: 'cluster-stagger' });
    const planetId = String(init.json.planetId);

    const ws1 = await WsClient.open(`${api1Url.replace('http://', 'ws://')}/ws`);
    sockets.push(ws1.ws);
    ws1.send({ t: 'hello', d: { accessToken: 'dev:stagger', proto: [2], client: { app: 'game', version: 'int' } } });
    await ws1.next('ready');
    ws1.send({ t: 'join', d: { planetId, mode: 'spectator' } });
    await ws1.next('welcome');
    const d1 = await ws1.next('delta', 10_000);
    const savedClusterTick = Number(d1.tick ?? 0);
    expect(savedClusterTick).toBeGreaterThan(0);
    ws1.ws.close();

    await Promise.all(apps.splice(0).map((a) => a.close()));

    // Boot api2 FIRST while worker2 (with TA_INTERNAL_URL + GAME_DEV_PLANETS=1) is still booting & restoring!
    const api2 = await createApp({
      source: { ...sharedEnv, TA_SIM_ROLE: 'api', TA_WORKER_ID: 'spec-api-b', GAME_DEV_PLANETS: '1' },
    });
    apps.push(api2.app);
    await api2.app.listen(0, '127.0.0.1');
    const api2Url = (await api2.app.getUrl()).replace('[::1]', '127.0.0.1');

    const earlyResumePromise = postSpectatorJson(api2Url, { planetType: 'dune', botCount: 2, seed: 'cluster-stagger' });
    const earlyResetOtherPromise = postSpectatorJson(api2Url, {
      planetType: 'oceanForest',
      botCount: 2,
      seed: 'cluster-early-reset',
      reset: true,
    });

    const wsEarly = await WsClient.open(`${api2Url.replace('http://', 'ws://')}/ws`);
    sockets.push(wsEarly.ws);
    wsEarly.send({ t: 'hello', d: { accessToken: 'dev:early-ws', proto: [2], client: { app: 'game', version: 'int' } } });
    await wsEarly.next('ready');
    wsEarly.send({ t: 'join', d: { planetId: devPlanetId, mode: 'spectator' } });

    await new Promise((r) => setTimeout(r, 150));
    const [earlyResume, earlyReset, earlyWelcome] = await Promise.all([
      earlyResumePromise,
      earlyResetOtherPromise,
      wsEarly.next('welcome', 25_000),
      bootClusterWorker(sharedEnv, 'spec-sim-b'),
    ]);
    expect(earlyResume.status).toBe(200);
    expect(earlyResume.json).toMatchObject({ planetId, created: false, reset: false });
    expect(Number(earlyResume.json.tick)).toBeGreaterThanOrEqual(savedClusterTick);

    expect(earlyReset.status).toBe(200);
    expect(earlyReset.json).toMatchObject({ tick: 0, botCount: 2, created: true, reset: true });

    expect(Welcome.parse(earlyWelcome).d.mode).toBe('spectator');
    wsEarly.ws.close();
  }, 120_000);
});

describe('Multi-worker dead-worker (SIGKILL) unexpired lease failover & concurrent reset=true', () => {
  it('evicts unreachable worker with unexpired SimWorkerLease/SimWorkerNode and fails over seamlessly on both ensure and reset=true', async () => {
    const testDb = await ensureDb();
    const sharedEnv = {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDb.url,
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      TA_INTERNAL_SECRET: 'spec-cluster-secret',
    };
    const worker1 = await bootClusterWorker(sharedEnv, 'spec-crash-w1', '0');
    const api = await createApp({
      source: { ...sharedEnv, TA_SIM_ROLE: 'api', TA_WORKER_ID: 'spec-crash-api', GAME_DEV_PLANETS: '0' },
    });
    apps.push(api.app);
    await api.app.listen(0, '127.0.0.1');
    const apiUrl = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');

    const init = await postSpectatorJson(apiUrl, { planetType: 'temperate', botCount: 2, seed: 'crash-failover' });
    expect(init.status).toBe(200);
    const planetId = String(init.json.planetId);

    const worker2 = await bootClusterWorker(sharedEnv, 'spec-crash-w2', '0');
    await severHttpServer(worker1);

    const activeLeaseBefore = await testDb.prisma.simWorkerLease.findUnique({ where: { planetId } });
    expect(activeLeaseBefore?.workerId).toBe('spec-crash-w1');
    expect(activeLeaseBefore!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // 1. Non-mutating ensure + WS join must evict dead worker1 and restore persisted world onto worker2 with zero 500/4003
    const failoverEnsure = await postSpectatorJson(apiUrl, { planetType: 'temperate', botCount: 2, seed: 'crash-failover' });
    expect(failoverEnsure.status).toBe(200);
    expect(failoverEnsure.json).toMatchObject({ planetId, botCount: 2, created: false, reset: false });

    const wsFailover = await WsClient.open(`${apiUrl.replace('http://', 'ws://')}/ws`);
    sockets.push(wsFailover.ws);
    wsFailover.send({ t: 'hello', d: { accessToken: 'dev:failover', proto: [2], client: { app: 'game', version: 'int' } } });
    await wsFailover.next('ready');
    wsFailover.send({ t: 'join', d: { planetId, mode: 'spectator' } });
    expect(Welcome.parse(await wsFailover.next('welcome')).d.mode).toBe('spectator');
    wsFailover.ws.close();

    // 2. Sever worker2's HTTP listener (leaving worker2's lease unexpired!) while worker3 is healthy, and run reset=true
    await bootClusterWorker(sharedEnv, 'spec-crash-w3', '0');
    await severHttpServer(worker2);

    const failoverReset = await postSpectatorJson(apiUrl, {
      planetType: 'temperate',
      botCount: 2,
      seed: 'crash-failover',
      reset: true,
    });
    expect(failoverReset.status).toBe(200);
    expect(failoverReset.json).toMatchObject({ planetId, tick: 0, botCount: 2, created: true, reset: true });
    const leaseAfterReset = await testDb.prisma.simWorkerLease.findUnique({ where: { planetId } });
    expect(leaseAfterReset?.workerId).toBe('spec-crash-w3');
  }, 120_000);
});
