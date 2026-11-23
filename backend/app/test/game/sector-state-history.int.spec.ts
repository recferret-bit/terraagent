import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  AgentDecisionHistoryResponseV1Schema,
  CANONICAL_PLANETS,
  PlanetSectorsLiveStateV1Schema,
  SimInputHistoryResponseV1Schema,
  decodeWire,
  newId,
  Welcome,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { pino } from 'pino';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import type { AppEnv } from '../../src/core/tokens';
import { devPlanetIds } from '../../src/game/dev-planets';
import { PlanetLiveStateController } from '../../src/game/planet-live-state.controller';
import type { SectorSyncPayload } from '../../src/game/persistence/sector-extract';
import { SectorStateService } from '../../src/game/persistence/sector-state.service';
import { SimHistoryService } from '../../src/game/persistence/sim-history.service';
import { SimLeaseService } from '../../src/game/persistence/sim-lease.service';

const log = pino({ level: 'silent' });

function makeSync(planetId: string, tick: number): SectorSyncPayload {
  return {
    planetId,
    planetType: 'temperate',
    seed: 'int-seed',
    capacity: 8,
    tick,
    alivePlayers: 1,
    aliveBots: 2,
    participants: [
      {
        colonyId: 'col_int_0', colonyIndex: 0, sectorId: 'sec_0_0', playerId: 'pr_human_1',
        actorKind: 'player', isBot: false, handle: 'alice', botPersona: null, status: 'ACTIVE', stage: 2,
        aiEnabled: false, alive: true, hqQ: 0, hqR: 0, unitCount: 3, buildingCount: 2,
        stock: { 'metals.t1': 210, 'minerals.t1': 90 }, caps: { metals: 500 }, power: { netPerS: 12 },
        queue: [{ taskId: 'q_h1', lane: 'construction', state: 'in_progress' }], goals: [], entities: [],
        lastInputAtTick: tick - 1, lastTick: tick,
      },
      {
        colonyId: 'col_int_6', colonyIndex: 6, sectorId: 'sec_1_0', playerId: 'ai:iron-guild',
        actorKind: 'bot', isBot: true, handle: 'Iron Guild Outpost', botPersona: 'trader', status: 'ACTIVE', stage: 4,
        aiEnabled: true, alive: true, hqQ: 14, hqR: -4, unitCount: 5, buildingCount: 8,
        stock: { 'metals.t1': 540, 'minerals.t1': 330 }, caps: { metals: 2500 }, power: { netPerS: 30 },
        queue: [{ taskId: 'q_b1', lane: 'units', state: 'in_progress' }], goals: [], entities: [],
        lastInputAtTick: tick, lastTick: tick,
      },
      {
        colonyId: 'col_int_7', colonyIndex: 7, sectorId: 'sec_0_1', playerId: 'ai:crimson',
        actorKind: 'bot', isBot: true, handle: 'Crimson Vanguard', botPersona: 'warlord', status: 'ACTIVE', stage: 4,
        aiEnabled: true, alive: true, hqQ: -10, hqR: 12, unitCount: 6, buildingCount: 9,
        stock: { 'metals.t1': 420, 'minerals.t1': 260 }, caps: { metals: 2500 }, power: { netPerS: 24 },
        queue: [], goals: [], entities: [],
        lastInputAtTick: tick, lastTick: tick,
      },
    ],
    sectors: [
      { sectorId: 'sec_0_0', kind: 'land', macroQ: 0, macroR: 0, centerQ: 0, centerR: 0, radius: 18, foundingCapacity: 4, activeHumans: 1, activeBots: 0, foundedSeats: 1, lastSyncedTick: tick },
      { sectorId: 'sec_1_0', kind: 'land', macroQ: 1, macroR: 0, centerQ: 14, centerR: -4, radius: 18, foundingCapacity: 4, activeHumans: 0, activeBots: 1, foundedSeats: 1, lastSyncedTick: tick },
      { sectorId: 'sec_0_1', kind: 'land', macroQ: 0, macroR: 1, centerQ: -10, centerR: 12, radius: 18, foundingCapacity: 4, activeHumans: 0, activeBots: 1, foundedSeats: 1, lastSyncedTick: tick },
    ],
  };
}

function seedSampleHistory(writer: SimHistoryService, planetId: string): void {
  for (let i = 0; i < 5; i++) {
    const isBot = i % 2 === 1;
    const baseMs = 1_700_000_000_000 + i * 1000;
    writer.recordExternalInput({
      planetId, sectorId: isBot ? 'sec_1_0' : 'sec_0_0',
      colonyId: isBot ? 'col_int_6' : 'col_int_0', colonyIndex: isBot ? 6 : 0,
      actorId: isBot ? 'bot:col_int_6' : 'pr_human_1', isBot,
      source: isBot ? 'bot' : 'player', commandId: `cm_pg_${i}`,
      kind: isBot ? 'enqueueTask' : 'moveUnit', args: { step: i },
      status: 'applied', rejectCode: null, rejectDetail: null,
      atTick: 10 + i, createdAtMs: baseMs,
    });
    writer.recordExternalDecision({
      planetId, sectorId: isBot ? 'sec_1_0' : 'sec_0_0',
      colonyId: isBot ? 'col_int_6' : 'col_int_0', colonyIndex: isBot ? 6 : 0,
      actorId: isBot ? 'bot:col_int_6' : 'pr_human_1', isBot,
      actorSource: isBot ? 'rival_ai' : 'player_ui',
      decisionKind: isBot ? 'build' : 'command', summary: `decision-${i}`,
      rationale: 'pg-test', commandId: `cm_pg_${i}`,
      commandKind: isBot ? 'enqueueTask' : 'moveUnit', payload: { i },
      outcome: 'applied', atTick: 10 + i, createdAtMs: baseMs,
    });
  }
}

class WsClient {
  readonly frames: Array<{ t: string; d?: Record<string, unknown> }> = [];
  private waiters: Array<() => void> = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      this.frames.push(decodeWire(isBinary ? buf : buf.toString('utf8')) as { t: string; d?: Record<string, unknown> });
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  static async open(url: string): Promise<WsClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new WsClient(ws);
  }
  send(msg: object): void { this.ws.send(JSON.stringify({ v: 1, ...msg })); }
  async next(t: string, timeoutMs = 15_000): Promise<{ t: string; d?: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const idx = this.frames.findIndex((f) => f.t === t);
      if (idx >= 0) return this.frames.splice(idx, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for "${t}"`);
      await new Promise<void>((r) => {
        const timer = setTimeout(r, Math.min(left, 250));
        this.waiters.push(() => { clearTimeout(timer); r(); });
      });
    }
  }
}

let sharedDb: TestDatabase | undefined;
async function ensureDb(): Promise<TestDatabase> {
  if (!sharedDb) sharedDb = await createTestDatabase();
  return sharedDb;
}
afterAll(async () => { await sharedDb?.drop(); });

describe('Postgres sector persistence & actor history', () => {
  it('persists planets, sectors, humans+bots, and paginates full input/decision history in Postgres', async () => {
    const db = await ensureDb();
    const env = { NODE_ENV: 'development', DATABASE_URL: db.url, SNAPSHOTS: 'on' } as unknown as AppEnv;

    const writer = new SectorStateService(env, log, undefined, db.prisma);
    const reader = new SectorStateService(env, log, undefined, db.prisma);
    writer.onSync('pl_pg_int', makeSync('pl_pg_int', 50), true);
    await writer.flushPlanet('pl_pg_int');

    const dbPlanet = await db.prisma.planet.findUniqueOrThrow({ where: { id: 'pl_pg_int' } });
    expect(dbPlanet.type).toBe('temperate');
    expect(await db.prisma.planetSector.count({ where: { planetId: 'pl_pg_int' } })).toBe(3);
    expect(await db.prisma.sectorParticipantState.count({ where: { planetId: 'pl_pg_int' } })).toBe(3);

    const liveFromDb = await reader.getLivePlanetState('pl_pg_int');
    expect(liveFromDb).not.toBeNull();
    expect(liveFromDb!.tick).toBe(50);
    expect(liveFromDb!.participants).toHaveLength(3);
    expect(liveFromDb!.participants.filter((p) => p.isBot)).toHaveLength(2);
    expect(liveFromDb!.participants.filter((p) => !p.isBot)).toHaveLength(1);

    const historyWriter = new SimHistoryService(env, log, undefined, db.prisma);
    const historyReader = new SimHistoryService(env, log, undefined, db.prisma);
    seedSampleHistory(historyWriter, 'pl_pg_int');
    await historyWriter.flush();

    const p1 = await historyReader.queryInputs('pl_pg_int', { limit: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await historyReader.queryInputs('pl_pg_int', { limit: 3, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();

    const botOnly = await historyReader.queryInputs('pl_pg_int', { isBot: true });
    expect(botOnly.items.every((x) => x.isBot && x.source === 'bot')).toBe(true);
    expect(botOnly.items).toHaveLength(2);

    const decBot = await historyReader.queryDecisions('pl_pg_int', { isBot: true, actorSource: 'rival_ai' });
    expect(decBot.items).toHaveLength(2);
  });
});

describe('Postgres multi-replica leases, REST live state & WS spectator E2E', () => {
  let app: INestApplication | undefined;
  const apps: INestApplication[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await Promise.all([app?.close(), ...apps.splice(0).map((a) => a.close())]);
    app = undefined;
  });

  it('coordinates multi-replica sim worker leases in Postgres and reclaims expired bot worlds', async () => {
    const db = await ensureDb();
    const env = { NODE_ENV: 'development', DATABASE_URL: db.url, SNAPSHOTS: 'on' } as unknown as AppEnv;
    const stateSvc = new SectorStateService(env, log, undefined, db.prisma);
    const historySvc = new SimHistoryService(env, log, undefined, db.prisma);

    let now = 2_000_000_000;
    const workerA = new SimLeaseService({ ...env, TA_WORKER_ID: 'replica-A', TA_SIM_ROLE: 'all' } as unknown as AppEnv, log, undefined, stateSvc, db.prisma);
    const workerB = new SimLeaseService({ ...env, TA_WORKER_ID: 'replica-B', TA_SIM_ROLE: 'sim-worker' } as unknown as AppEnv, log, undefined, stateSvc, db.prisma);
    const apiNode = new SimLeaseService({ ...env, TA_WORKER_ID: 'api-node-1', TA_SIM_ROLE: 'api' } as unknown as AppEnv, log, undefined, stateSvc, db.prisma);
    workerA.setTtlMsForTest(5_000);
    workerB.setTtlMsForTest(5_000);
    workerA.nowMs = () => now;
    workerB.nowMs = () => now;

    expect(apiNode.canHostSim()).toBe(false);
    expect(await apiNode.tryAcquire('pl_pg_lease')).toBe(false);
    expect(await workerA.tryAcquire('pl_pg_lease', { lastTick: 50, aliveBots: 2, alivePlayers: 1 })).toBe(true);
    expect(await workerB.tryAcquire('pl_pg_lease')).toBe(false);

    await workerA.tryAcquire('pl_pg_dead', { lastTick: 99, aliveBots: 0, alivePlayers: 0 });
    now += 10_000;
    const reclaimed: string[] = [];
    workerB.startLoop({ onReclaim: async (planetId) => { reclaimed.push(planetId); }, intervalMs: 60_000 });
    await workerB.tick();
    workerB.stopLoop();
    expect(reclaimed).toEqual(['pl_pg_lease']);
    const leasesAfter = await apiNode.listLeases();
    expect(leasesAfter.find((l) => l.planetId === 'pl_pg_lease')?.workerId).toBe('replica-B');

    const ctrl = new PlanetLiveStateController(stateSvc, historySvc, apiNode);
    expect((await ctrl.getWorkerLeases()).leases.some((l) => l.planetId === 'pl_pg_lease')).toBe(true);
  });
});

describe('Full NestJS HTTP + WS spectator against Postgres', () => {
  let app: INestApplication | undefined;
  const apps: INestApplication[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await Promise.all([app?.close(), ...apps.splice(0).map((a) => a.close())]);
    app = undefined;
  });

  it('boots full NestJS + sim worker against Postgres, persists authoritative bot feeds, serves HTTP & WS spectator', async () => {
    const db = await ensureDb();
    const planetId = devPlanetIds(1, 1)[0]!;
    const created = await createApp({
      source: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
        DATABASE_URL: db.url,
        SIM_THREADS: '1',
        GAME_DEV_PLANETS: '1',
        TA_SEED_RIVAL_AI: '1',
        TA_WORKER_ID: 'int-worker-1',
        SNAPSHOTS: 'on',
      },
    });
    app = created.app;
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    await expect.poll(async () => db!.prisma.sectorParticipantState.count({ where: { planetId, isBot: true } }), { timeout: 20_000, interval: 250 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => {
      await app!.get(SimHistoryService).flush();
      return db!.prisma.simInputHistory.count({ where: { planetId, isBot: true, source: 'bot' } });
    }, { timeout: 25_000, interval: 300 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => db!.prisma.agentDecisionHistory.count({ where: { planetId, isBot: true } }), { timeout: 25_000, interval: 300 }).toBeGreaterThanOrEqual(1);

    const liveRes = await fetch(`${url}/v1/planets/${planetId}/live`);
    expect(liveRes.status).toBe(200);
    expect(PlanetSectorsLiveStateV1Schema.parse(await liveRes.json()).participants.some((p) => p.isBot)).toBe(true);

    const inRes = await fetch(`${url}/v1/planets/${planetId}/inputs?isBot=true&limit=20`);
    expect(inRes.status).toBe(200);
    const inJson = SimInputHistoryResponseV1Schema.parse(await inRes.json());
    expect(inJson.items.length).toBeGreaterThanOrEqual(1);
    expect(inJson.items.every((x) => x.isBot && x.source === 'bot')).toBe(true);

    const decRes = await fetch(`${url}/v1/planets/${planetId}/decisions?isBot=true&limit=20`);
    expect(decRes.status).toBe(200);
    expect(AgentDecisionHistoryResponseV1Schema.parse(await decRes.json()).items.length).toBeGreaterThanOrEqual(1);

    const leaseRes = await fetch(`${url}/v1/planets/workers/leases`);
    expect(leaseRes.status).toBe(200);
    const leaseJson = (await leaseRes.json()) as { workerId: string; leases: Array<{ planetId: string }> };
    expect(leaseJson.workerId).toBe('int-worker-1');
    expect(leaseJson.leases.some((l) => l.planetId === planetId)).toBe(true);

    const wsClient = await WsClient.open(`${url.replace('http://', 'ws://')}/ws`);
    sockets.push(wsClient.ws);
    wsClient.send({ t: 'hello', d: { accessToken: 'dev:pg-spec', proto: [2], client: { app: 'game', version: 'int' } } });
    await wsClient.next('ready');
    wsClient.send({ t: 'join', d: { planetId, mode: 'spectator' } });
    const welcome = Welcome.parse(await wsClient.next('welcome'));
    expect(welcome.d.mode).toBe('spectator');
    expect(welcome.d.colonyId).toBeNull();
    expect((welcome.d.recentInputs?.length ?? 0)).toBeGreaterThanOrEqual(1);

    const badCmdId = newId('cm');
    wsClient.send({ t: 'cmd', id: badCmdId, d: { kind: 'dev.ping', args: {} } });
    expect((await wsClient.next('cmd.reject')).d).toMatchObject({ id: badCmdId, code: 'spectator_read_only' });
    expect(CANONICAL_PLANETS.temperate.id).toBeTruthy();
  }, 60_000);
});

describe('Split sim-worker + api cluster routing against Postgres', () => {
  const apps: INestApplication[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  it('routes WS spectator, relayed feeds, and HTTP/WS commands across separate sim-worker and api processes', async () => {
    const db = await ensureDb();
    const planetId = devPlanetIds(1, 1)[0]!;
    const sharedEnv = {
      NODE_ENV: 'development',
      LOG_LEVEL: 'silent',
      DATABASE_URL: db.url,
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      TA_INTERNAL_SECRET: 'int-cluster-secret',
    };
    const worker = await createApp({
      source: {
        ...sharedEnv,
        TA_SIM_ROLE: 'sim-worker',
        TA_WORKER_ID: 'int-sim-worker-1',
        GAME_DEV_PLANETS: '1',
        TA_SEED_RIVAL_AI: '1',
      },
    });
    apps.push(worker.app);
    await worker.app.listen(0, '127.0.0.1');

    const api = await createApp({
      source: {
        ...sharedEnv,
        TA_SIM_ROLE: 'api',
        TA_WORKER_ID: 'int-api-node-1',
        GAME_DEV_PLANETS: '0',
      },
    });
    apps.push(api.app);
    await api.app.listen(0, '127.0.0.1');
    const apiUrl = (await api.app.getUrl()).replace('[::1]', '127.0.0.1');

    // API pod discovers worker-owned planets via cluster lease directory
    await expect.poll(async () => {
      const r = await fetch(`${apiUrl}/v1/dev/planets`);
      if (!r.ok) return [];
      const j = (await r.json()) as { planets: Array<{ id: string }> };
      return j.planets.map((p) => p.id);
    }, { timeout: 20_000, interval: 250 }).toContain(planetId);

    // Spectator connects to API pod ONLY and receives Postgres history backfill + live worker relay feeds/deltas
    const specWs = await WsClient.open(`${apiUrl.replace('http://', 'ws://')}/ws`);
    sockets.push(specWs.ws);
    specWs.send({ t: 'hello', d: { accessToken: 'dev:api-spec', proto: [2], client: { app: 'game', version: 'int' } } });
    await specWs.next('ready');
    specWs.send({ t: 'join', d: { planetId, mode: 'spectator' } });
    const welcome = Welcome.parse(await specWs.next('welcome'));
    expect(welcome.d.mode).toBe('spectator');
    const delta = (await specWs.next('delta')) as { t: string; tick?: number };
    expect(Number(delta.tick ?? 0)).toBeGreaterThan(welcome.d.tick);

    // Player HTTP command sent to API pod routes to worker, acks, and persists to Postgres sim_input_history
    const httpCmdId = newId('cm');
    const cmdRes = await fetch(`${apiUrl}/v1/planets/${planetId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer dev:api-player' },
      body: JSON.stringify({ id: httpCmdId, kind: 'dev.ping', args: { note: 'cluster-http' } }),
    });
    expect(cmdRes.status).toBe(200);

    // Player WS command sent to API pod routes to worker, acks, and persists to Postgres sim_input_history
    const playerWs = await WsClient.open(`${apiUrl.replace('http://', 'ws://')}/ws`);
    sockets.push(playerWs.ws);
    playerWs.send({ t: 'hello', d: { accessToken: 'dev:api-ws-player', proto: [2], client: { app: 'game', version: 'int' } } });
    await playerWs.next('ready');
    playerWs.send({ t: 'join', d: { planetId } });
    await playerWs.next('welcome');
    const wsCmdId = newId('cm');
    playerWs.send({ t: 'cmd', id: wsCmdId, d: { kind: 'dev.ping', args: { note: 'cluster-ws' } } });
    const ack = await playerWs.next('cmd.ack');
    expect(ack.d).toMatchObject({ id: wsCmdId });

    await expect.poll(async () => {
      await worker.app.get(SimHistoryService).flush();
      const count = await db!.prisma.simInputHistory.count({
        where: { planetId, commandId: { in: [httpCmdId, wsCmdId] }, source: 'dev' },
      });
      return count;
    }, { timeout: 10_000, interval: 150 }).toBe(2);
  }, 60_000);
});

describe('SimHistoryService Postgres restart backfill', () => {
  it('backfills persisted Postgres history across a simulated restart even when mem has newer events', async () => {
    const db = await ensureDb();
    const restartPlanet = `pl_restart_${Date.now()}`;
    const hist1 = new SimHistoryService({ NODE_ENV: 'development', SNAPSHOTS: 'on' } as unknown as AppEnv, log, undefined, db.prisma);
    const oldIn = hist1.recordExternalInput({
      planetId: restartPlanet, sectorId: 'sec_0_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, source: 'bot', commandId: 'cm_old', kind: 'enqueueTask', args: { building: 'solar' },
      status: 'applied', rejectCode: null, rejectDetail: null, atTick: 10, createdAtMs: 1_700_000_010_000,
    });
    const oldDec = hist1.recordExternalDecision({
      planetId: restartPlanet, sectorId: 'sec_0_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, actorSource: 'colony_agent', decisionKind: 'build', summary: 'pre-restart solar',
      rationale: 'low power', commandId: 'cm_old', commandKind: 'enqueueTask', payload: {}, outcome: 'applied',
      atTick: 10, createdAtMs: 1_700_000_010_000,
    });
    await hist1.flush();

    const hist2 = new SimHistoryService({ NODE_ENV: 'development', SNAPSHOTS: 'on' } as unknown as AppEnv, log, undefined, db.prisma);
    const newIn = hist2.recordExternalInput({
      planetId: restartPlanet, sectorId: 'sec_0_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, source: 'bot', commandId: 'cm_new', kind: 'enqueueTask', args: { unit: 'worker' },
      status: 'applied', rejectCode: null, rejectDetail: null, atTick: 25, createdAtMs: 1_700_000_025_000,
    });
    const newDec = hist2.recordExternalDecision({
      planetId: restartPlanet, sectorId: 'sec_0_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, actorSource: 'colony_agent', decisionKind: 'economy', summary: 'post-restart worker',
      rationale: 'need harvesters', commandId: 'cm_new', commandKind: 'enqueueTask', payload: {}, outcome: 'applied',
      atTick: 25, createdAtMs: 1_700_000_025_000,
    });

    const inputsAfterRestart = await hist2.recentInputsAsync(restartPlanet, 10);
    const decsAfterRestart = await hist2.recentDecisionsAsync(restartPlanet, 10);
    expect(inputsAfterRestart.map((i) => i.id)).toEqual([oldIn.id, newIn.id]);
    expect(decsAfterRestart.map((d) => d.id)).toEqual([oldDec.id, newDec.id]);
    await hist2.flush();
  }, 60_000);
});
