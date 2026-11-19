import 'reflect-metadata';
import { createAtlasPlanetState } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import {
  computeColonyBindingHash,
  fnv1a64Hex,
  inferAuthoritativeBaseSector,
  packAxialCoord,
  resolveTileSectorFast,
  SectorAntiCheatService,
} from '../../src/core/anticheat';
import { HomeRepository } from '../../src/core/home';
import { MetricsRegistry } from '../../src/core/metrics.registry';

function createMultiSectorService() {
  const repo = new HomeRepository();
  const metrics = new MetricsRegistry();
  const antiCheat = new SectorAntiCheatService(repo, metrics);
  const state = createAtlasPlanetState({
    planetType: 'temperate',
    seed: 'anticheat-multi-sector',
    sectorRadius: 24,
    gridRadius: 96,
    skipPerfCaps: true,
  });
  antiCheat.syncFromPlanetState('pl_atlas', state);

  const col0 = antiCheat.index.upsertColonyBase({
    playerId: 'pr_alpha',
    colonyId: 'co_alpha',
    planetId: 'pl_atlas',
    colonyIndex: 0,
    foundingSectorId: 'sec_0_0',
    spawnQ: 0,
    spawnR: 0,
    status: 'ACTIVE',
  });
  const col1 = antiCheat.index.upsertColonyBase({
    playerId: 'pr_bravo',
    colonyId: 'co_bravo',
    planetId: 'pl_atlas',
    colonyIndex: 1,
    foundingSectorId: 'sec_1_0',
    spawnQ: 49,
    spawnR: -24,
    status: 'ACTIVE',
  });

  const spatial = antiCheat.index.getPlanet('pl_atlas')!;
  spatial.entitiesById.set(101, { entityId: 101, ownerColonyIndex: 0, kind: 1, q: 2, r: -1, sectorId: 'sec_0_0', alive: true });
  spatial.entitiesById.set(102, { entityId: 102, ownerColonyIndex: 0, kind: 2, q: 4, r: 0, sectorId: 'sec_0_0', alive: true });
  spatial.entitiesById.set(201, { entityId: 201, ownerColonyIndex: 1, kind: 1, q: 49, r: -24, sectorId: 'sec_1_0', alive: true });
  spatial.entitiesById.set(301, { entityId: 301, ownerColonyIndex: -1, kind: 99, q: 50, r: -24, sectorId: 'sec_1_0', alive: true });
  spatial.nextEntityId = 400;
  spatial.maxEntityId = 301;

  return { antiCheat, repo, metrics, col0, col1 };
}

describe('SectorAntiCheatService — O(1) hash primitives & base coordinate inference', () => {
  it('computes collision-free axial keys, deterministic 64-bit FNV-1a hashes, and O(1) sector lookups', () => {
    const seen = new Set<number>();
    for (let q = -8; q <= 8; q++) {
      for (let r = -8; r <= 8; r++) seen.add(packAxialCoord(q, r));
    }
    expect(seen.size).toBe(17 * 17);

    const h1 = computeColonyBindingHash({
      playerId: 'pr_1', planetId: 'pl_1', colonyId: 'co_1', colonyIndex: 0, baseSectorId: 'sec_0_0', status: 'ACTIVE',
    });
    const h2 = computeColonyBindingHash({
      playerId: 'pr_1', planetId: 'pl_1', colonyId: 'co_1', colonyIndex: 0, baseSectorId: 'sec_1_0', status: 'ACTIVE',
    });
    expect(h1).toHaveLength(16);
    expect(h1).not.toBe(h2);
    expect(fnv1a64Hex(['a', 1, true])).toBe(fnv1a64Hex(['a', 1, true]));
    expect(resolveTileSectorFast(0, 0, 48)).toBe('sec_0_0');
    expect(resolveTileSectorFast(97, -48, 48)).toBe('sec_1_0');
    expect(
      inferAuthoritativeBaseSector({
        foundingSectorId: 'sec_0_0', spawnQ: 97, spawnR: -48, sectorRadius: 48, hasMultiSectorGrid: true,
      }),
    ).toBe('sec_1_0');
  });

  it('validates 10,000 real-time hash checks in well under 100ms', () => {
    const { antiCheat, col0 } = createMultiSectorService();
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const v = antiCheat.validateCommand({
        transport: 'ws',
        playerId: 'pr_alpha',
        planetId: 'pl_atlas',
        sectorId: 'sec_0_0',
        bindingHash: col0.bindingHash,
        colony: { id: 'co_alpha', colonyIndex: 0, planetId: 'pl_atlas', foundingSectorId: 'sec_0_0' },
        kind: 'enqueueTask',
        args: { terraform: { op: 'grade', tiles: [{ q: (i % 7) - 3, r: 0 }] } },
      });
      if (!v.ok) throw new Error('unexpected reject');
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('SectorAntiCheatService — join sector free-space & base-sector enforcement', () => {
  it('blocks joining full, ocean, or invalid sectors and enforces base sector/planet locks', async () => {
    const { antiCheat } = createMultiSectorService();
    antiCheat.syncSectorSpace({ planetId: 'pl_atlas', sectorId: 'sec_0_0', kind: 'land', capacity: 2, reservedSeats: 1, foundedSeats: 1, freeSeats: 0 });
    antiCheat.syncSectorSpace({ planetId: 'pl_atlas', sectorId: 'sec_1_0', kind: 'land', capacity: 4, reservedSeats: 0, foundedSeats: 1, freeSeats: 3 });
    antiCheat.syncSectorSpace({ planetId: 'pl_atlas', sectorId: 'sec_2_0', kind: 'ocean', capacity: 0, freeSeats: 0 });

    expect(
      await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_new', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_0_0', allowNewJoin: true }),
    ).toMatchObject({ ok: false, reason: 'sector_full', httpStatus: 409 });
    expect(
      await antiCheat.verifyJoin({ transport: 'ws', playerId: 'pr_new', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_0_0', allowNewJoin: false }),
    ).toMatchObject({ ok: false, reason: 'sector_full' });
    expect(
      await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_new', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_2_0', allowNewJoin: true }),
    ).toMatchObject({ ok: false, reason: 'sector_not_land', httpStatus: 400 });
    expect(
      await antiCheat.verifyJoin({ transport: 'ws', playerId: 'pr_new', targetPlanetId: 'pl_atlas', requestedSectorId: 'BAD_SECTOR' }),
    ).toMatchObject({ ok: false, reason: 'invalid_sector', httpStatus: 400 });
    expect(
      await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_new', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_1_0', allowNewJoin: true }),
    ).toMatchObject({ ok: true, planetId: 'pl_atlas', sectorId: 'sec_1_0' });

    // Existing base owner in full sec_0_0 rejoins sec_0_0, but cannot join sec_1_0 or pl_other
    expect(
      await antiCheat.verifyJoin({ transport: 'ws', playerId: 'pr_alpha', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_0_0' }),
    ).toMatchObject({ ok: true, colonyId: 'co_alpha', sectorId: 'sec_0_0' });
    expect(
      await antiCheat.verifyJoin({ transport: 'ws', playerId: 'pr_alpha', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_1_0' }),
    ).toMatchObject({ ok: false, reason: 'not_your_sector', expectedSectorId: 'sec_0_0' });
    expect(
      await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_alpha', targetPlanetId: 'pl_other', allowNewJoin: true }),
    ).toMatchObject({ ok: false, reason: 'not_your_planet', expectedPlanetId: 'pl_atlas' });
  });
});

describe('SectorAntiCheatService — base, terraform & unit production checks', () => {
  it.each(['http', 'ws'] as const)('validates base, seam footprints, terraform & units on %s', (transport) => {
    const { antiCheat, col0 } = createMultiSectorService();
    const ctx = {
      transport,
      playerId: 'pr_alpha',
      planetId: 'pl_atlas',
      sectorId: 'sec_0_0',
      bindingHash: col0.bindingHash,
      colony: { id: 'co_alpha', colonyIndex: 0, planetId: 'pl_atlas', foundingSectorId: 'sec_0_0' },
    };

    expect(antiCheat.validateCommand({ ...ctx, kind: 'placeBuilding', args: { building: 'commandHub', q: 0, r: 0 } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'placeBuilding', args: { building: 'commandHub', q: 49, r: -24 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'placeBuilding', args: { building: 'commandHub', q: 24, r: 0 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { build: { building: 'solar', q: 49, r: -24 } } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles: [{ q: 1, r: 0 }, { q: 2, r: -1 }], workerId: 101 } } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles: [{ q: 1, r: 0 }, { q: 49, r: -24 }] } } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { terraform: { op: 'grade', tiles: [{ q: 1, r: 0 }], workerId: 201 } } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });

    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', producerId: 102 } } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', producerId: 201 } } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'setRally', args: { producerId: 102, q: 49, r: -24 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
  });
});

describe('SectorAntiCheatService — combat, raid, goals, economy & live hash invalidation', () => {
  it.each(['http', 'ws'] as const)('validates movement, attack, raid, goals, cargo & bounty on %s', (transport) => {
    const { antiCheat, col0 } = createMultiSectorService();
    const ctx = {
      transport,
      playerId: 'pr_alpha',
      planetId: 'pl_atlas',
      sectorId: 'sec_0_0',
      bindingHash: col0.bindingHash,
      colony: { id: 'co_alpha', colonyIndex: 0, planetId: 'pl_atlas', foundingSectorId: 'sec_0_0' },
    };

    expect(antiCheat.validateCommand({ ...ctx, kind: 'moveUnit', args: { entityId: 101, q: 3, r: -1 } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'moveUnit', args: { entityId: 101, q: 49, r: -24 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'moveGroup', args: { entityIds: [101, 201], q: 3, r: -1 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'attackMove', args: { entityId: 101, q: 49, r: -24 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'attackTarget', args: { entityId: 101, targetId: 201 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'attackTarget', args: { entityId: 101, targetId: 301 } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'attackTarget', args: { entityId: 101, targetId: 102 } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'raid', args: { targetColonyId: 'co_bravo', unitIds: [101] } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'queueGoal', args: { goal: 'expand_territory', params: { sectorId: 1 } } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'cargo.export', args: { colonyId: 'co_bravo', resource: 'metals.t1', amount: 10 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(
      antiCheat.validateCommand({
        ...ctx,
        kind: 'bounty.post',
        args: { target: { kind: 'defend_area', q: 49, r: -24, radius: 4 }, reward: { resource: 'metals.t1', amount: 10 }, expiresAt: Date.now() + 10_000_000 },
      }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    antiCheat.applyPlanetEvents('pl_atlas', [
      { kind: 'colonyEliminated', severity: 'critical', colonyIds: [0], atTick: 12, data: { colonyId: 'co_alpha', colonyIndex: 0 } },
    ]);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'landPod', args: {} })).toMatchObject({ ok: false, rejectCode: 'colony_inactive' });
  });
});

describe('SectorAntiCheatService — footprints, live events & seat lifecycle hardening', () => {
  it('enforces exact 3x3/2x2/1x1 footprints, live building/death events, and blocks setPlanetTime/stallId/bounty.claim/costOverride cheats', () => {
    const { antiCheat, col0 } = createMultiSectorService();
    const ctx = {
      transport: 'ws' as const,
      playerId: 'pr_alpha',
      planetId: 'pl_atlas',
      sectorId: 'sec_0_0',
      bindingHash: col0.bindingHash,
      colony: { id: 'co_alpha', colonyIndex: 0, planetId: 'pl_atlas', foundingSectorId: 'sec_0_0' },
    };

    // Find a border tile in sec_0_0 whose +q/+r 2x2 or +1/+1 3x3 corner crosses into another sector
    let borderTile: { q: number; r: number } | undefined;
    for (let q = 18; q <= 30 && !borderTile; q++) {
      for (let r = -24; r <= 0 && !borderTile; r++) {
        if (resolveTileSectorFast(q, r, 24) === 'sec_0_0' && resolveTileSectorFast(q + 1, r, 24) !== 'sec_0_0') {
          borderTile = { q, r };
        }
      }
    }
    expect(borderTile).toBeDefined();

    // 1x1 pylon on valid sec_0_0 border tile passes, while 2x2 solar & 3x3 roboticsFactory straddling seam fail
    expect(antiCheat.validateCommand({ ...ctx, kind: 'placeBuilding', args: { building: 'pylon', q: borderTile!.q, r: borderTile!.r } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { build: { building: 'solar', q: borderTile!.q, r: borderTile!.r } } })).toMatchObject({
      ok: false,
      rejectCode: 'cross_sector_disabled',
    });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { task: { kind: 'build', building: 'roboticsFactory', q: borderTile!.q, r: borderTile!.r } } })).toMatchObject({
      ok: false,
      rejectCode: 'cross_sector_disabled',
    });

    // Check 3x3 diagonal corner (q+1, r+1) outside HEX_DIRS ring when center + 6 hex neighbors are all in sec_0_0
    let diagOnlyCorner: { q: number; r: number } | undefined;
    const hexNeighbors = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
    for (let q = -30; q <= 30 && !diagOnlyCorner; q++) {
      for (let r = -30; r <= 30 && !diagOnlyCorner; r++) {
        if (resolveTileSectorFast(q, r, 24) !== 'sec_0_0') continue;
        const ringAllHome = hexNeighbors.every(([dq, dr]) => resolveTileSectorFast(q + dq, r + dr, 24) === 'sec_0_0');
        const diagCrosses =
          resolveTileSectorFast(q + 1, r + 1, 24) !== 'sec_0_0' ||
          resolveTileSectorFast(q - 1, r - 1, 24) !== 'sec_0_0';
        if (ringAllHome && diagCrosses) diagOnlyCorner = { q, r };
      }
    }
    if (diagOnlyCorner) {
      expect(
        antiCheat.validateCommand({ ...ctx, kind: 'placeBuilding', args: { building: 'commandHub', q: diagOnlyCorner.q, r: diagOnlyCorner.r } }),
      ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    }

    // Live buildingCompleted indexes new producer immediately; unitDestroyed rejects commands on dead unit
    antiCheat.applyPlanetEvents('pl_atlas', [
      { kind: 'buildingCompleted', severity: 'info', colonyIds: [0], atTick: 5, data: { colonyId: 'co_alpha', entityId: 405, building: 'roboticsFactory', q: 3, r: 0 } },
    ]);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', producerId: 405 } } }).ok).toBe(true);
    antiCheat.applyPlanetEvents('pl_atlas', [
      { kind: 'unitDestroyed', severity: 'warn', colonyIds: [0], atTick: 6, data: { entityId: 101 } },
    ]);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'moveUnit', args: { entityId: 101, q: 1, r: 0 } })).toMatchObject({ ok: false, rejectCode: 'unknown_entity' });

    // Rejects costOverride, system precedence, zero entity IDs, foreign stallId, director flag, cross-sector bounty.claim & setPlanetTime
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { costOverride: {}, task: { kind: 'build', building: 'pylon', q: 0, r: 0 } } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { precedence: 'system', task: { kind: 'build', building: 'pylon', q: 0, r: 0 } } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { task: { kind: 'hqGoal', goal: 'raid_target', target: 'co_bravo' } } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', producerId: 0 } } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'market.placeOrder', args: { side: 'sell', resource: 'metals.t1', amount: 10, price: { token: 'USDC', amount: '100' }, ttlS: 900, stallId: 201 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'market.placeOrder', args: { side: 'sell', resource: 'metals.t1', amount: 10, price: { token: 'USDC', amount: '100' }, ttlS: 900, director: true } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'bounty.claim', args: { bountyId: 'bt:1:10' } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'setPlanetTime', args: { timeOfDay: 0, timeScale: 1000 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'attackTarget', args: { entityId: 102, targetId: 999999 } })).toMatchObject({ ok: false, rejectCode: 'unknown_entity' });
  });
});

describe('SectorAntiCheatService — elimination seat release & anti-resurrection', () => {
  it('releases sector seat on elimination/transfer and blocks stale repo active rows from resurrecting eliminated bindings', async () => {
    const { antiCheat, repo } = createMultiSectorService();
    antiCheat.syncSectorSpace({ planetId: 'pl_atlas', sectorId: 'sec_0_0', kind: 'land', capacity: 2, foundedSeats: 1, freeSeats: 1 });
    expect(antiCheat.index.getSectorSpace('pl_atlas', 'sec_0_0')?.freeSeats).toBe(1);

    // Seating one more active colony consumes the last remaining seat (1 + 1 = 2 -> freeSeats = 0)
    const planetRec = await repo.upsertDevPlanet('pl_atlas', { radius: 96, capacity: 12 });
    const { colony: extraCol } = await repo.createColony({
      id: 'co_charlie', playerId: 'pr_charlie', planetId: 'pl_atlas', colonyIndex: 2, name: 'Charlie', status: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 2, spawnR: 2,
    });
    antiCheat.recordColonyBase(extraCol, planetRec, true);
    expect(antiCheat.index.getSectorSpace('pl_atlas', 'sec_0_0')?.freeSeats).toBe(0);
    expect(await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_delta', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_0_0', allowNewJoin: true })).toMatchObject({
      ok: false,
      reason: 'sector_full',
    });

    // Live elimination frees the seat and refuses resurrection from stale repo ACTIVE row
    antiCheat.recordColonyStatus('co_charlie', 'ELIMINATED');
    expect(antiCheat.index.getSectorSpace('pl_atlas', 'sec_0_0')?.freeSeats).toBe(1);
    expect(await antiCheat.resolveAuthoritativeActiveBase('pr_charlie')).toBeNull();

    // Respawned player can now seat in a different sector (sec_1_0) without being locked to dead sec_0_0 colony
    expect(await antiCheat.verifyJoin({ transport: 'http', playerId: 'pr_charlie', targetPlanetId: 'pl_atlas', requestedSectorId: 'sec_1_0', allowNewJoin: true })).toMatchObject({
      ok: true,
      sectorId: 'sec_1_0',
    });
  });
});
