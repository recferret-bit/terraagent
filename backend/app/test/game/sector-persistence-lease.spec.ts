import { pino } from 'pino';
import type { PrismaClient } from '@terra/db';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { PlanetLiveStateController } from '../../src/game/planet-live-state.controller';
import { SectorStateService } from '../../src/game/persistence/sector-state.service';
import { SimHistoryService } from '../../src/game/persistence/sim-history.service';
import { SimLeaseService } from '../../src/game/persistence/sim-lease.service';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import { compileData, createPlanet, seedRivalAiColonies } from '@terra/sim';
import { flagsFromList, parseWaves } from '@terra/contracts';
import type { SectorSyncPayload } from '../../src/game/persistence/sector-extract';
import { buildHostStepFeeds } from '../../src/game/thread/parts/planet-host-feed';
import { resolveInternalSecret } from '../../src/game/cluster/internal-auth';
import { InternalSimController } from '../../src/game/cluster/internal-sim.controller';
import { SimClusterService } from '../../src/game/cluster/sim-cluster.service';

const log = pino({ level: 'silent' });
const testEnv = { NODE_ENV: 'development', SNAPSHOTS: 'on' } as unknown as AppEnv;

function makeSampleSync(planetId: string, tick = 10): SectorSyncPayload {
  return {
    planetId,
    planetType: 'temperate',
    seed: 's1',
    capacity: 8,
    tick,
    alivePlayers: 1,
    aliveBots: 2,
    participants: [
      {
        colonyId: 'col_0', colonyIndex: 0, sectorId: 'sec_0_0', playerId: 'p1',
        actorKind: 'player', isBot: false, handle: 'alice', botPersona: null, status: 'ACTIVE', stage: 2,
        aiEnabled: false, alive: true, hqQ: 1, hqR: 2, unitCount: 3, buildingCount: 4,
        stock: { 'metals.t1': 120 }, caps: { metals: 500 }, power: { netPerS: 10 },
        queue: [], goals: [], entities: [], lastInputAtTick: 9, lastTick: tick,
      },
      {
        colonyId: 'col_6', colonyIndex: 6, sectorId: 'sec_1_0', playerId: 'ai:iron-guild',
        actorKind: 'bot', isBot: true, handle: 'Iron Guild Outpost', botPersona: 'trader', status: 'ACTIVE', stage: 4,
        aiEnabled: true, alive: true, hqQ: 10, hqR: -4, unitCount: 5, buildingCount: 8,
        stock: { 'metals.t1': 450 }, caps: { metals: 2500 }, power: { netPerS: 25 },
        queue: [{ taskId: 'b1', lane: 'construction', state: 'in_progress' }], goals: [], entities: [],
        lastInputAtTick: tick, lastTick: tick,
      },
    ],
    sectors: [
      { sectorId: 'sec_0_0', kind: 'land', macroQ: 0, macroR: 0, centerQ: 0, centerR: 0, radius: 18, foundingCapacity: 4, activeHumans: 1, activeBots: 0, foundedSeats: 1, lastSyncedTick: tick },
      { sectorId: 'sec_1_0', kind: 'land', macroQ: 1, macroR: 0, centerQ: 12, centerR: 0, radius: 18, foundingCapacity: 4, activeHumans: 0, activeBots: 1, foundedSeats: 1, lastSyncedTick: tick },
    ],
  };
}

describe('SectorStateService & SimHistoryService persistence + API controller', () => {
  it('persists planets, sectors, humans, bots, and queries live state via controller', async () => {
    const upserts: string[] = [];
    const sectorRows: Array<Record<string, unknown>> = [];
    const participantRows: Array<Record<string, unknown>> = [];
    const tx = {
      planet: { upsert: vi.fn(async (_arg: { update?: Record<string, unknown>; create?: Record<string, unknown> }) => { upserts.push('planet'); }) },
      planetSector: {
        upsert: vi.fn(async ({ create, update, where }: { create: Record<string, unknown>; update: Record<string, unknown>; where: { planetId_sectorId: { planetId: string; sectorId: string } } }) => {
          upserts.push('planetSector');
          const idx = sectorRows.findIndex((r) => r.planetId === where.planetId_sectorId.planetId && r.sectorId === where.planetId_sectorId.sectorId);
          if (idx >= 0) Object.assign(sectorRows[idx]!, update);
          else sectorRows.push({ ...create, reservedSeats: 0 });
        }),
      },
      sectorParticipantState: {
        upsert: vi.fn(async ({ create, update, where }: { create: Record<string, unknown>; update: Record<string, unknown>; where: { planetId_colonyId: { planetId: string; colonyId: string } } }) => {
          upserts.push('participant');
          const idx = participantRows.findIndex((r) => r.planetId === where.planetId_colonyId.planetId && r.colonyId === where.planetId_colonyId.colonyId);
          if (idx >= 0) Object.assign(participantRows[idx]!, update, { updatedAt: new Date() });
          else participantRows.push({ ...create, updatedAt: new Date() });
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      colony: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
      planetSector: { findMany: vi.fn(async ({ where }: { where: { planetId: string } }) => sectorRows.filter((r) => r.planetId === where.planetId)) },
      sectorParticipantState: { findMany: vi.fn(async ({ where }: { where: { planetId: string } }) => participantRows.filter((r) => r.planetId === where.planetId)) },
    } as unknown as PrismaClient;

    const sectorSvc = new SectorStateService(testEnv, log, undefined, prisma);
    const historySvc = new SimHistoryService({ NODE_ENV: 'test' } as unknown as AppEnv, log);
    const leaseSvc = new SimLeaseService({ NODE_ENV: 'test' } as unknown as AppEnv, log);
    const controller = new PlanetLiveStateController(sectorSvc, historySvc, leaseSvc);

    sectorSvc.onSync('pl_sync', makeSampleSync('pl_sync', 42), true);
    await sectorSvc.flushPlanet('pl_sync');

    expect(upserts).toEqual(['planet', 'planetSector', 'planetSector', 'participant', 'participant']);
    expect((tx.planet.upsert.mock.calls[0]?.[0] as { update?: Record<string, unknown> } | undefined)?.update).not.toHaveProperty('seatsTaken');
    expect(tx.planetSector.upsert).toHaveBeenCalledTimes(2);
    expect(tx.sectorParticipantState.upsert).toHaveBeenCalledTimes(2);

    const live = await controller.getPlanetLiveState('pl_sync');
    expect(live.tick).toBe(42);
    expect(live.participants).toHaveLength(2);
    expect(live.sectors.find((s) => s.sectorId === 'sec_1_0')?.activeBots).toBe(1);
    expect(live.sectors.find((s) => s.sectorId === 'sec_0_0')?.activeHumans).toBe(1);
  });

  it('batches input & decision history for bots and players and supports filtered queries', async () => {
    const inputBatches: unknown[] = [];
    const decisionBatches: unknown[] = [];
    const prisma = {
      simInputHistory: {
        createMany: vi.fn(async (arg: { data: unknown[] }) => { inputBatches.push(...arg.data); return { count: arg.data.length }; }),
        findMany: vi.fn(async () => []),
      },
      agentDecisionHistory: {
        createMany: vi.fn(async (arg: { data: unknown[] }) => { decisionBatches.push(...arg.data); return { count: arg.data.length }; }),
        findMany: vi.fn(async () => []),
      },
    } as unknown as PrismaClient;

    const history = new SimHistoryService(testEnv, log, undefined, prisma);
    history.recordExternalInput({
      planetId: 'pl_h', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'p1',
      isBot: false, source: 'player', commandId: 'cm_1', kind: 'moveUnit', args: { entityId: 1, q: 2, r: 3 },
      status: 'rejected', rejectCode: 'rate_limited', rejectDetail: null, atTick: 5, createdAtMs: 1000,
    });
    history.recordExternalDecision({
      planetId: 'pl_h', sectorId: 'sec_1_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, actorSource: 'colony_agent', decisionKind: 'trade', summary: 'sell metals',
      rationale: 'surplus', commandId: 'cm_2', commandKind: 'market.place', payload: {}, outcome: 'applied',
      atTick: 6, createdAtMs: 2000,
    });
    await history.flush();
    expect(inputBatches).toHaveLength(1);
    expect(decisionBatches).toHaveLength(1);

    const memHistory = new SimHistoryService({ NODE_ENV: 'test' } as unknown as AppEnv, log);
    memHistory.recordExternalInput({
      planetId: 'pl_h', sectorId: 'sec_1_0', colonyId: 'col_6', colonyIndex: 6, actorId: 'bot:col_6',
      isBot: true, source: 'bot', commandId: 'cm_b', kind: 'enqueueTask', args: {},
      status: 'applied', rejectCode: null, rejectDetail: null, atTick: 8, createdAtMs: 3000,
    });
    const botInputs = await memHistory.queryInputs('pl_h', { isBot: true });
    expect(botInputs.items).toHaveLength(1);
    expect(botInputs.items[0]!.source).toBe('bot');
  });
});

describe('SimLeaseService multi-replica lease coordination & fail-over', () => {
  it('prevents split-brain acquire and reclaims expired bot/player leases', async () => {
    const leases = new Map<string, { planetId: string; workerId: string; role: string; mode: string; lastTick: number; alivePlayers: number; aliveBots: number; leasedAt: Date; expiresAt: Date; updatedAt: Date }>();
    const makePrisma = () => ({
      simWorkerLease: {
        updateMany: vi.fn(async ({ where, data }: { where: { planetId: string; OR?: Array<{ workerId?: string; expiresAt?: { lte: Date } }>; workerId?: string }; data: Record<string, unknown> }) => {
          const row = leases.get(where.planetId);
          if (!row) return { count: 0 };
          const now = Date.now();
          const okOwner = where.workerId ? row.workerId === where.workerId : where.OR?.some((c) => (c.workerId && row.workerId === c.workerId) || (c.expiresAt && row.expiresAt.getTime() <= c.expiresAt.lte.getTime()));
          if (!okOwner && now < row.expiresAt.getTime()) return { count: 0 };
          if (!okOwner) return { count: 0 };
          Object.assign(row, data, { updatedAt: new Date(now) });
          return { count: 1 };
        }),
        create: vi.fn(async ({ data }: { data: typeof leases extends Map<string, infer V> ? V : never }) => {
          if (leases.has(data.planetId)) throw Object.assign(new Error('dup'), { code: 'P2002' });
          leases.set(data.planetId, { ...data, updatedAt: new Date() });
          return data;
        }),
        findMany: vi.fn(async ({ where }: { where?: { expiresAt?: { lte: Date } } }) => {
          const cutoff = where?.expiresAt?.lte?.getTime() ?? Infinity;
          return [...leases.values()].filter((r) => r.expiresAt.getTime() <= cutoff && (r.alivePlayers > 0 || r.aliveBots > 0));
        }),
      },
    }) as unknown as PrismaClient;

    const prisma = makePrisma();
    let now = 1_000_000;
    const replicaA = new SimLeaseService({ ...testEnv, TA_WORKER_ID: 'worker-A' } as unknown as AppEnv, log, undefined, undefined, prisma);
    const replicaB = new SimLeaseService({ ...testEnv, TA_WORKER_ID: 'worker-B' } as unknown as AppEnv, log, undefined, undefined, prisma);
    replicaA.setTtlMsForTest(10_000);
    replicaB.setTtlMsForTest(10_000);
    replicaA.nowMs = () => now;
    replicaB.nowMs = () => now;

    expect(await replicaA.tryAcquire('pl_1', { aliveBots: 2, alivePlayers: 0 })).toBe(true);
    expect(await replicaB.tryAcquire('pl_1')).toBe(false);

    now += 15_000;
    const reclaimed: string[] = [];
    replicaB.startLoop({ onReclaim: async (id) => { reclaimed.push(id); } });
    await replicaB.tick();
    replicaB.stopLoop();
    expect(reclaimed).toEqual(['pl_1']);
    expect(leases.get('pl_1')?.workerId).toBe('worker-B');

    const apiReplica = new SimLeaseService({ ...testEnv, TA_SIM_ROLE: 'api', TA_WORKER_ID: 'api-1' } as unknown as AppEnv, log, undefined, undefined, prisma);
    expect(apiReplica.canHostSim()).toBe(false);
    expect(await apiReplica.tryAcquire('pl_api')).toBe(false);
  });

  it('generates globally distinct history IDs across multiple planets at the same tick', () => {
    const flags = flagsFromList(parseWaves(null).list);
    const data = compileData(flags);
    const stateA = createPlanet({ type: 'temperate', seed: 'multi-a', planetId: 'pl_multi_alpha', radius: 24, capacity: 6 });
    const stateB = createPlanet({ type: 'temperate', seed: 'multi-b', planetId: 'pl_multi_beta', radius: 24, capacity: 6 });
    seedRivalAiColonies(stateA, { count: 1, colonyIndices: [0], capacity: 6, tick: 0, data });
    seedRivalAiColonies(stateB, { count: 1, colonyIndices: [0], capacity: 6, tick: 0, data });

    let seqA = 0;
    let seqB = 0;
    const cmdA = { colonyIndex: 0, source: 'player' as const, commandId: 'cm_shared', kind: 'dev.ping', args: {} };
    const feedA = buildHostStepFeeds({
      planetId: 'pl_multi_alpha', state: stateA, queuedCmds: [cmdA], botBatch: { commands: [], decisions: [] },
      outcomes: [{ commandId: 'cm_shared', kind: 'dev.ping', code: 'ok', appliedAtTick: 1 }],
      tick: 1, wallMs: 1000, seenAutopilotTickByColony: new Map(), lastInputTickByColony: new Map(), nextFeedId: () => ++seqA,
    });
    const feedB = buildHostStepFeeds({
      planetId: 'pl_multi_beta', state: stateB, queuedCmds: [cmdA], botBatch: { commands: [], decisions: [] },
      outcomes: [{ commandId: 'cm_shared', kind: 'dev.ping', code: 'ok', appliedAtTick: 1 }],
      tick: 1, wallMs: 1000, seenAutopilotTickByColony: new Map(), lastInputTickByColony: new Map(), nextFeedId: () => ++seqB,
    });

    expect(feedA.inputs[0]!.id).not.toBe(feedB.inputs[0]!.id);
  });
});

describe('Cluster internal auth & SimHistoryService DB backfill', () => {
  it('fails closed on missing internal cluster secret in NODE_ENV=production and backfills SimHistoryService from DB when mem < limit', async () => {
    expect(() => resolveInternalSecret({ NODE_ENV: 'production' } as unknown as AppEnv)).toThrow(/TA_INTERNAL_SECRET/);
    expect(resolveInternalSecret({ NODE_ENV: 'production', TA_INTERNAL_SECRET: 'prod-secret' } as unknown as AppEnv)).toBe('prod-secret');
    expect(resolveInternalSecret({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'jwt-s' } as unknown as AppEnv)).toBe('terra-internal:jwt-s');
    expect(resolveInternalSecret({ NODE_ENV: 'development' } as unknown as AppEnv)).toBe('terra-dev-internal');

    const dbInputs = [
      { id: 'in_1', planetId: 'pl_r', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'bot:0', isBot: true, source: 'bot', commandId: 'c1', kind: 'enqueueTask', argsJson: {}, status: 'applied', rejectCode: null, rejectDetail: null, issuedAtTick: 1, appliedAtTick: 1, createdAt: new Date(1000) },
      { id: 'in_2', planetId: 'pl_r', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'bot:0', isBot: true, source: 'bot', commandId: 'c2', kind: 'enqueueTask', argsJson: {}, status: 'applied', rejectCode: null, rejectDetail: null, issuedAtTick: 2, appliedAtTick: 2, createdAt: new Date(2000) },
    ];
    const dbDecs = [
      { id: 'dec_1', planetId: 'pl_r', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'bot:0', isBot: true, actorSource: 'colony_agent', decisionKind: 'trade', summary: 'old', rationale: null, commandId: 'c1', commandKind: 'market.place', payloadJson: {}, outcome: 'applied', atTick: 1, createdAt: new Date(1000) },
    ];
    const prisma = {
      simInputHistory: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [...dbInputs].reverse()),
      },
      agentDecisionHistory: {
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [...dbDecs].reverse()),
      },
    } as unknown as PrismaClient;

    const history = new SimHistoryService(testEnv, log, undefined, prisma);
    const liveIn = history.recordExternalInput({
      planetId: 'pl_r', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'bot:0',
      isBot: true, source: 'bot', commandId: 'c3', kind: 'enqueueTask', args: {},
      status: 'applied', rejectCode: null, rejectDetail: null, atTick: 5, createdAtMs: 5000,
    });
    const liveDec = history.recordExternalDecision({
      planetId: 'pl_r', sectorId: 'sec_0_0', colonyId: 'col_0', colonyIndex: 0, actorId: 'bot:0',
      isBot: true, actorSource: 'colony_agent', decisionKind: 'raid', summary: 'new',
      rationale: null, commandId: 'c3', commandKind: 'raid', payload: {}, outcome: 'applied',
      atTick: 5, createdAtMs: 5000,
    });

    const mergedInputs = await history.recentInputsAsync('pl_r', 10);
    expect(mergedInputs.map((i) => i.id)).toEqual(['in_1', 'in_2', liveIn.id]);
    const mergedDecs = await history.recentDecisionsAsync('pl_r', 10);
    expect(mergedDecs.map((d) => d.id)).toEqual(['dec_1', liveDec.id]);
  });
});

describe('SnapshotService & SimLeaseService ghost-lease cleanup', () => {
  it('releases worker leases when SnapshotService.restoreAll holds a planet or when a planet unloads/goes down', async () => {
    const leases = new Map<string, { planetId: string; workerId: string; expiresAt: Date }>();
    const prisma = {
      simWorkerLease: {
        updateMany: vi.fn(async ({ where, data }: { where: { planetId: string; workerId?: string }; data: Record<string, unknown> }) => {
          const row = leases.get(where.planetId);
          if (!row) return { count: 0 };
          if (where.workerId && row.workerId !== where.workerId) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        create: vi.fn(async ({ data }: { data: { planetId: string; workerId: string; expiresAt: Date } }) => {
          leases.set(data.planetId, { planetId: data.planetId, workerId: data.workerId, expiresAt: data.expiresAt });
          return data;
        }),
      },
    } as unknown as PrismaClient;

    let unloadCb: ((id: string) => void) | undefined;
    let downCb: ((id: string) => void) | undefined;
    const fakePlanets = {
      isLoaded: () => false,
      loadedIds: () => [],
      modeOf: () => 'active' as const,
      onPlanetLoaded: () => () => undefined,
      onPlanetUnloaded: (fn: (id: string) => void) => { unloadCb = fn; return () => undefined; },
      onPlanetDown: (fn: (id: string) => void) => { downCb = fn; return () => undefined; },
      onPlanetSnapshot: () => () => undefined,
    };

    const leaseSvc = new SimLeaseService({ ...testEnv, TA_WORKER_ID: 'worker-Z' } as unknown as AppEnv, log, fakePlanets as never, undefined, prisma);
    leaseSvc.startLoop();
    await leaseSvc.tryAcquire('pl_unloaded');
    expect(leases.get('pl_unloaded')!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    unloadCb?.('pl_unloaded');
    await vi.waitFor(() => expect(leases.get('pl_unloaded')!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 50));

    await leaseSvc.tryAcquire('pl_down');
    downCb?.('pl_down');
    await vi.waitFor(() => expect(leases.get('pl_down')!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 50));
    leaseSvc.stopLoop();

    const snapStore = {
      livePlanetIds: vi.fn(async () => ['pl_v1_held']),
      latest: vi.fn(async () => null),
      listLatest: vi.fn(async () => []),
      loadChain: vi.fn(async () => []),
    };
    const snapSvc = new SnapshotService(
      fakePlanets as never, snapStore as never, new MetricsRegistry(), testEnv, log,
      undefined, undefined, undefined, undefined, undefined, undefined, leaseSvc,
    );
    vi.spyOn(snapSvc, 'restore').mockResolvedValueOnce('held');
    const report = await snapSvc.restoreAll();
    expect(report.held).toEqual(['pl_v1_held']);
    expect(leases.get('pl_v1_held')!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 50);
  });
});

describe('InternalSimController & SimClusterService phantom/lease behavior', () => {
  it('acquires lease on remote loadNew/loadHome and prevents ensureHosted from generating phantom planets', async () => {
    const acquired: string[] = [];
    const loaded = new Set<string>();
    const fakePlanets = {
      isLoaded: (id: string) => loaded.has(id),
      loadedIds: () => [...loaded],
      load: vi.fn(async (id: string) => { loaded.add(id); return 0; }),
      markScenarioColonyPlanet: vi.fn(),
    };
    const fakeLease = {
      workerId: 'worker-1',
      internalUrl: 'http://127.0.0.1:4101',
      canHostSim: () => true,
      tryAcquire: vi.fn(async (id: string) => { acquired.push(id); return true; }),
      releasePlanet: vi.fn(async () => undefined),
      getOwnerLease: vi.fn(async () => null),
      pickHealthyWorker: vi.fn(async () => null),
    };
    const fakeSnapshots = {
      loadNew: vi.fn(async () => undefined),
      loadHome: vi.fn(async () => 'generated' as const),
      restoreIfPersisted: vi.fn(async () => 'absent' as const),
    };
    const ctrl = new InternalSimController(
      { NODE_ENV: 'test', TA_INTERNAL_SECRET: 'sec' } as unknown as AppEnv,
      fakePlanets as never,
      fakeSnapshots as never,
      fakeLease as never,
    );
    const hdrs = { headers: { 'x-terra-internal-token': 'sec' } } as never;
    const newRes = await ctrl.loadNew('pl_remote_scen', { snapshotBase64: Buffer.from('abc').toString('base64') }, hdrs);
    expect(newRes.hosted).toBe(true);
    expect(acquired).toContain('pl_remote_scen');

    const homeRes = await ctrl.loadHome('pl_unknown', { restoreOnly: true }, hdrs);
    expect(homeRes).toEqual({ outcome: 'absent', hosted: false });
    expect(fakeSnapshots.loadHome).not.toHaveBeenCalled();

    const cluster = new SimClusterService(
      { NODE_ENV: 'test', TA_INTERNAL_SECRET: 'sec' } as unknown as AppEnv,
      log,
      fakePlanets as never,
      fakeLease as never,
      fakeSnapshots as never,
    );
    const loc = await cluster.ensureHosted('pl_unknown');
    expect(loc).toBeNull();
    expect(fakeSnapshots.loadNew).not.toHaveBeenCalled();
  });

  it('acquires lease in InternalSimController.landingSite and returns non-loaded landing rejections from SimClusterService.forwardLandingSite without throwing', async () => {
    const acquired: string[] = [];
    const loaded = new Set<string>();
    const fakePlanets = {
      isLoaded: (id: string) => loaded.has(id),
      landingSite: vi.fn(async () => ({ ok: true, q: 2, r: -1, slotIndex: 0 })),
    };
    const fakeLease = {
      workerId: 'worker-api',
      internalUrl: 'http://127.0.0.1:4100',
      canHostSim: () => false,
      tryAcquire: vi.fn(async (id: string) => { acquired.push(id); return true; }),
      releasePlanet: vi.fn(async () => undefined),
      getOwnerLease: vi.fn(async (id: string) =>
        id === 'pl_dev_2' ? { planetId: 'pl_dev_2', workerId: 'worker-1', internalUrl: 'http://127.0.0.1:4101' } : null,
      ),
      pickHealthyWorker: vi.fn(async () => ({ workerId: 'worker-1', internalUrl: 'http://127.0.0.1:4101' })),
      evictPlanetLease: vi.fn(async () => undefined),
      evictWorker: vi.fn(async () => undefined),
    };
    const fakeSnapshots = {
      loadNew: vi.fn(async (id: string) => { loaded.add(id); }),
    };
    const ctrl = new InternalSimController(
      { NODE_ENV: 'test', TA_INTERNAL_SECRET: 'sec' } as unknown as AppEnv,
      fakePlanets as never,
      fakeSnapshots as never,
      fakeLease as never,
    );
    const hdrs = { headers: { 'x-terra-internal-token': 'sec' } } as never;
    const site = await ctrl.landingSite('pl_dev_lease', { colonyIndex: 0 }, hdrs);
    expect(site).toEqual({ ok: true, q: 2, r: -1, slotIndex: 0 });
    expect(acquired).toContain('pl_dev_lease');

    const cluster = new SimClusterService(
      { NODE_ENV: 'test', TA_INTERNAL_SECRET: 'sec' } as unknown as AppEnv,
      log,
      fakePlanets as never,
      fakeLease as never,
      fakeSnapshots as never,
    );
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, code: 'landing_site_taken' }),
    })));
    try {
      const ans = await cluster.forwardLandingSite('pl_dev_2', {}, 0, 5_000);
      expect(ans).toEqual({ ok: false, code: 'landing_site_taken' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
