import { describe, expect, it } from 'vitest';
import { flagsFromList, parseWaves } from '@terra/contracts';
import type { SimCommand } from '../../src';
import {
  COMBAT_TEST_BIOMES,
  DEV_PLANET_RADIUS,
  ENTITY_KIND,
  ENTITY_STATE,
  TERRAIN,
  createCombatTestHost,
  getColonyPower,
  hexDistance,
  hexIndex,
  isColonyRaidProtected,
  normalizeCombatTestBiome,
  planBackendBotActions,
  getColonyRaidProtectedUntil,
  initColonyNewcomerShield,
  rowOf,
  type PlanetState,
  type SimEvent,
} from '../../src';
import { isHostileTargetForAttacker } from '../../src/systems/combat/targeting';
import { hasActiveTruce, peekDiplomacyBlob } from '../../src/systems/diplomacy/store';

const FLAG_LIST = parseWaves(null).list;
const ALL_FLAGS = flagsFromList(FLAG_LIST);

function cmd(kind: string, args: Record<string, unknown>, colonyIndex = 0, id = `cmd_${Math.random()}`): SimCommand {
  return { commandId: id, colonyIndex, kind, args, source: 'player' };
}

function findDryOffsetNear(state: PlanetState, q: number, r: number, dq: number, dr: number): { q: number; r: number } {
  const cols = state.entities.cols;
  const blocked = new Set<string>();
  for (let i = 0; i < state.entities.count; i++) {
    if (cols.hp[i]! > 0) blocked.add(`${Math.round(cols.q[i]!)}:${Math.round(cols.r[i]!)}`);
  }
  const terrain = state.grid.layers.terrain;
  const hx = hexIndex(state.grid.radius);
  for (let d = 0; d <= 16; d++) {
    const cq = q + dq + d;
    const cr = r + dr;
    const idx = hx.indexOf(cq, cr);
    if (idx < 0) continue;
    const t = terrain[idx] ?? TERRAIN.flat;
    if (t !== TERRAIN.shallow && t !== TERRAIN.deep && !blocked.has(`${cq}:${cr}`)) {
      return { q: cq, r: cr };
    }
  }
  return { q: q + dq, r: r + dr };
}

describe('Combat test biome helpers', () => {
  it('normalizes frontend biome aliases and planet keys accurately', () => {
    expect(normalizeCombatTestBiome('dune')).toBe('desert');
    expect(normalizeCombatTestBiome('oceanForest')).toBe('ocean');
    expect(normalizeCombatTestBiome('forestRock')).toBe('temperate');
    expect(normalizeCombatTestBiome('desert')).toBe('desert');
    expect(normalizeCombatTestBiome('ocean')).toBe('ocean');
    expect(normalizeCombatTestBiome('temperate')).toBe('temperate');
    expect(normalizeCombatTestBiome(undefined)).toBe('temperate');
    expect(normalizeCombatTestBiome('unknown-biome')).toBe('temperate');
  });
});

describe('Combat test maps across all 3 biomes', () => {
  for (const biome of COMBAT_TEST_BIOMES) {
    it(`creates ${biome} map at common gameplay radius (${DEV_PLANET_RADIUS}) without HQ/Hub, with bots, insects, and no PvP shield`, () => {
      const { host, meta } = createCombatTestHost({ planetType: biome, botCount: 3 });
      const state = host.state;
      expect(meta.biome).toBe(biome);
      expect(state.meta.planetType).toBe(biome);
      expect(state.grid.radius).toBe(DEV_PLANET_RADIUS);
      expect(state.colonies[0]?.status).toBe('active');

      const cols = state.entities.cols;
      const playerKinds: number[] = [];
      let hiveCount = 0;
      let bugCount = 0;
      const botOwners = new Set<number>();
      for (let r = 0; r < state.entities.count; r++) {
        const owner = cols.owner[r]!;
        const kind = cols.kind[r]!;
        if (owner === 0) playerKinds.push(kind);
        else if (owner > 0) botOwners.add(owner);
        if (kind === ENTITY_KIND.hiveBlackAnt || kind === ENTITY_KIND.hiveBlueBeetle || kind === ENTITY_KIND.hiveGreenSpitter) hiveCount++;
        if (kind === ENTITY_KIND.blackAnt || kind === ENTITY_KIND.blueBeetle || kind === ENTITY_KIND.greenSpitter) bugCount++;
      }
      expect(playerKinds).not.toContain(ENTITY_KIND.hq);
      expect(playerKinds).not.toContain(ENTITY_KIND.commandHub);
      expect(playerKinds).not.toContain(ENTITY_KIND.pod);
      expect(botOwners.size).toBe(3);

      const stIdx = hexIndex(state.grid.radius).indexOf(meta.staging.q, meta.staging.r);
      expect(state.grid.layers.terrain[stIdx]).not.toBe(TERRAIN.shallow);
      expect(state.grid.layers.terrain[stIdx]).not.toBe(TERRAIN.deep);
      const pvp = state.blobs.pvp?.value as { crossSectorEnabled?: boolean } | undefined;
      expect(pvp?.crossSectorEnabled).toBe(true);
      for (const col of state.colonies) {
        if (!col) continue;
        expect(isColonyRaidProtected(state, col.index, state.meta.tick, host.pipeline.config.data)).toBe(false);
        expect(getColonyRaidProtectedUntil(state, col.index, state.meta.tick, host.pipeline.config.data)).toBe(0);
      }
      expect(hiveCount).toBeGreaterThanOrEqual(3);
      expect(bugCount).toBeGreaterThanOrEqual(6);

      const events: SimEvent[] = [];
      host.onEvents((evs) => events.push(...evs));
      host.step(5);
      expect(state.colonies[0]?.status).toBe('active');
      expect(events.some((e) => e.kind === 'colonyEliminated' && e.data?.colonyIndex === 0)).toBe(false);
    });
  }
});

describe('Combat test spawners without HQ', () => {
  it('spawns all battle units and buildings without HQ and lets Robotics Factory produce units', () => {
    const { host, meta } = createCombatTestHost({ planetType: 'temperate', botCount: 2 });
    const { q, r } = meta.staging;
    host.submit(cmd('dev.spawnunit', { unit: 'recon', q, r }));
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: q + 1, r }));
    host.submit(cmd('dev.spawnunit', { unit: 'demoArtillery', q: q - 1, r }));
    host.submit(cmd('dev.spawnbuilding', { building: 'autocannon', q: q + 2, r }));
    host.submit(cmd('dev.spawnbuilding', { building: 'laserTower', q: q + 2, r: r + 1 }));
    host.submit(cmd('dev.spawnbuilding', { building: 'droneControlArray', q: q - 3, r: r + 1 }));
    host.submit(cmd('dev.spawnbuilding', { building: 'sensorArray', q: q - 3, r: r - 2 }));
    host.submit(cmd('dev.spawnbuilding', { building: 'roboticsFactory', q, r: r + 4 }));
    host.submit(cmd('dev.spawnbuilding', { building: 'pylon', q: q - 12, r: r + 6 }));

    const res = host.step(2);
    expect(res.outcomes.filter((o) => o.code && o.code !== 'ok')).toEqual([]);

    const cols = host.state.entities.cols;
    const counts = new Map<number, number>();
    let roboticsId = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] !== 0 || cols.hp[i]! <= 0) continue;
      const k = cols.kind[i]!;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (k === ENTITY_KIND.roboticsFactory) roboticsId = cols.id[i]!;
      if (k === ENTITY_KIND.autocannon || k === ENTITY_KIND.laserTower) {
        expect(cols.state[i]).toBe(ENTITY_STATE.active);
      }
    }
    expect(counts.get(ENTITY_KIND.recon)).toBe(1);
    expect(counts.get(ENTITY_KIND.demoTank)).toBe(1);
    expect(counts.get(ENTITY_KIND.demoArtillery)).toBe(1);
    expect(counts.get(ENTITY_KIND.autocannon)).toBe(1);
    expect(counts.get(ENTITY_KIND.laserTower)).toBe(1);
    expect(counts.get(ENTITY_KIND.droneControlArray)).toBe(1);
    expect(counts.get(ENTITY_KIND.sensorArray)).toBe(1);
    expect(counts.get(ENTITY_KIND.roboticsFactory)).toBe(1);

    host.submit(cmd('enqueueTask', { buildUnit: { unit: 'recon', producerId: roboticsId } }));
    expect(host.step(1).outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 200; t++) host.step(1);
    let reconCount = 0;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.hp[i]! > 0 && cols.kind[i] === ENTITY_KIND.recon) reconCount++;
    }
    expect(reconCount).toBe(2);
  });

  it('rejects invalid building kinds and overlapping sites cleanly, and places nearby when fallbackNear is true', () => {
    const { host, meta } = createCombatTestHost({ planetType: 'desert', botCount: 1 });
    const { q, r } = meta.staging;
    host.submit(cmd('dev.spawnbuilding', { building: 'nonexistentTurret', q, r }));
    host.submit(cmd('dev.spawnbuilding', { building: 'autocannon', q, r }));
    host.submit(cmd('dev.spawnbuilding', { building: 'laserTower', q, r }));
    host.submit(cmd('dev.spawnbuilding', { building: 'laserTower', q, r, fallbackNear: true }));
    const res = host.step(1);
    expect(res.outcomes[0]?.code).toBe('invalid_args');
    expect(res.outcomes[1]?.code).toBeUndefined();
    expect(res.outcomes[2]?.code).toBe('site_blocked');
    expect(res.outcomes[3]?.code).toBeUndefined();
  });
});

describe('Combat test Rival AI bots & unshielded combat', () => {
  it('lets Rival AI bots build as usual and engages combat cleanly with PvP shield off', () => {
    const { host, meta } = createCombatTestHost({ planetType: 'temperate', botCount: 2 });
    let issuedCount = 0;
    let botBuiltOrProduced = false;
    for (let stepIdx = 0; stepIdx < 160; stepIdx++) {
      const batch = planBackendBotActions(host.state, host.pipeline.config.data, ALL_FLAGS, host.tick + 1, host.tick);
      for (const c of batch.commands) {
        issuedCount++;
        if (c.kind === 'placeBuilding' || c.kind === 'enqueueTask' || c.kind === 'attackMove') botBuiltOrProduced = true;
        host.submit(c);
      }
      host.step(1);
    }
    expect(issuedCount).toBeGreaterThan(0);
    expect(botBuiltOrProduced).toBe(true);

    const cols = host.state.entities.cols;
    let botEntityRow = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if ((cols.owner[i] ?? -1) > 0 && cols.hp[i]! > 0 && cols.kind[i] !== ENTITY_KIND.hq) {
        botEntityRow = i;
        break;
      }
    }
    expect(botEntityRow).toBeGreaterThanOrEqual(0);
    const botQ = Math.round(cols.q[botEntityRow]!);
    const botR = Math.round(cols.r[botEntityRow]!);
    const targetId = cols.id[botEntityRow]!;
    const spawnAt = findDryOffsetNear(host.state, botQ, botR, 2, 0);
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: spawnAt.q, r: spawnAt.r }));
    host.submit(cmd('dev.spawnunit', { unit: 'demoArtillery', q: spawnAt.q + 1, r: spawnAt.r }));
    host.step(1);

    let tankId = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.kind[i] === ENTITY_KIND.demoTank) { tankId = cols.id[i]!; break; }
    }
    expect(tankId).toBeGreaterThan(0);
    const prevHp = cols.hp[botEntityRow]!;
    host.submit(cmd('attackTarget', { entityIds: [tankId], targetId }));
    const combatEvents: SimEvent[] = [];
    host.onEvents((evs) => combatEvents.push(...evs));
    for (let t = 0; t < 25; t++) host.step(1);

    const updatedRow = rowOf(host.state.entities, targetId);
    expect(updatedRow < 0 || cols.hp[updatedRow]! < prevHp).toBe(true);
    expect(combatEvents.some((e) => e.kind === 'projectileFired' && e.data?.attackerId === tankId)).toBe(true);

    host.submit(cmd('dev.spawnbuilding', { building: 'autocannon', q: meta.staging.q, r: meta.staging.r }));
    host.submit(cmd('dev.spawnunit', { unit: 'blackAnt', q: meta.staging.q + 2, r: meta.staging.r }));
    host.step(1);
    const turretShots: SimEvent[] = [];
    host.onEvents((evs) => turretShots.push(...evs));
    for (let t = 0; t < 20; t++) host.step(1);
    expect(turretShots.some((e) => e.kind === 'projectileFired')).toBe(true);
    void hexDistance;
  });
});

describe('Combat test guards, strict refill & power isolation', () => {
  it('seeds contiguous bot colonies (no ghost slot), biomass/T2 stocks, and setupPostings', () => {
    for (const botCount of [1, 4]) {
      const { host, meta, setupPostings } = createCombatTestHost({
        planetType: 'ocean',
        seed: `combat-bots-${botCount}`,
        botCount,
        flags: FLAG_LIST,
      });
      expect(meta.botCount).toBe(botCount);
      const nonZero = host.state.colonies.filter((c): c is NonNullable<typeof c> => Boolean(c));
      expect(nonZero).toHaveLength(botCount + 1);
      expect(nonZero.every((c) => c.status === 'active')).toBe(true);
      const p0 = host.state.colonies[0]!;
      expect(p0.spawnQ).toBe(meta.staging.q);
      expect(p0.spawnR).toBe(meta.staging.r);
      expect(p0.storageCapOverride).toBe(200_000);
      const stock = p0.stock as Record<string, number>;
      expect(stock['bio.biomass']).toBeGreaterThan(0);
      expect(stock['metals.t2']).toBeGreaterThan(0);
      expect(stock['minerals.t2']).toBeGreaterThan(0);
      expect(stock['bio.t2']).toBeGreaterThan(0);
      expect(setupPostings.length).toBeGreaterThan(0);
    }
  });

  it('never spawns HQ on dev.spawnraid when player has 0 entities, and never eliminates player 0 on Hub destruction', () => {
    const { host, meta } = createCombatTestHost({
      planetType: 'temperate',
      seed: 'combat-guards-1',
      botCount: 2,
      flags: FLAG_LIST,
    });
    const rejectCodes: string[] = [];
    host.onOutcomes((outs) => {
      for (const o of outs) if (o.code && o.code !== 'ok') rejectCodes.push(o.code);
    });

    host.submit(cmd('dev.spawnraid', { count: 4, colonyIndex: 0 }));
    host.step(1);
    const cols = host.state.entities.cols;
    let hqCount = 0;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.kind[i] === ENTITY_KIND.hq) hqCount++;
    }
    expect(hqCount).toBe(0);
    expect(rejectCodes.includes('no_target_entities')).toBe(true);

    host.submit(cmd('dev.spawnbuilding', { building: 'commandHub', q: meta.staging.q, r: meta.staging.r, fallbackNear: true }));
    host.step(1);
    let hubId = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.kind[i] === ENTITY_KIND.commandHub) { hubId = cols.id[i]!; break; }
    }
    expect(hubId).toBeGreaterThan(0);

    host.submit(cmd('dev.spawnraid', { count: 3, colonyIndex: 0 }));
    host.step(1);
    expect(rejectCodes.filter((c) => c === 'no_target_entities')).toHaveLength(1);

    const hubRow = rowOf(host.state.entities, hubId);
    expect(hubRow).toBeGreaterThanOrEqual(0);
    host.submit(cmd('dev.damage', { entityId: hubId, amount: cols.hp[hubRow]! + 50 }));
    host.step(2);
    expect(host.state.colonies[0]?.status).toBe('active');
    expect(host.state.colonies[0]?.eliminatedAt).toBeFalsy();
  });
});

describe('Combat test strict refill, aggressive bugs & power isolation', () => {
  it('supports aggressive insect dev.spawnunit, strict dev.grant + dev.reveal, and noPowerGridLock distant pylons', () => {
    const { host, meta } = createCombatTestHost({
      planetType: 'desert',
      seed: 'combat-power-bugs-1',
      botCount: 2,
      flags: FLAG_LIST,
    });
    const rejectCodes: string[] = [];
    host.onOutcomes((outs) => {
      for (const o of outs) if (o.code && o.code !== 'ok') rejectCodes.push(o.code);
    });

    host.submit(cmd('dev.spawnunit', { unit: 'blackAnt', q: meta.staging.q + 3, r: meta.staging.r, count: 2, mode: 'aggressive' }));
    host.submit(cmd('dev.grant', { resource: 'bio.biomass', amount: 15000 }));
    host.submit(cmd('dev.reveal', {}));
    host.step(1);
    expect(rejectCodes).toHaveLength(0);

    const farSite = findDryOffsetNear(host.state, meta.staging.q, meta.staging.r, 20, 0);
    host.submit(cmd('dev.spawnbuilding', { building: 'autocannon', q: meta.staging.q, r: meta.staging.r, fallbackNear: true }));
    host.submit(cmd('dev.spawnbuilding', { building: 'pylon', q: farSite.q, r: farSite.r, fallbackNear: true }));
    for (let k = 0; k < 5; k++) {
      const fSite = findDryOffsetNear(host.state, farSite.q, farSite.r, (k % 3) + 1, Math.floor(k / 3) + 1);
      host.submit(cmd('dev.spawnbuilding', { building: 'roboticsFactory', q: fSite.q, r: fSite.r, fallbackNear: true }));
    }
    host.step(2);

    const cols = host.state.entities.cols;
    let turretId = -1;
    let turretState = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.kind[i] === ENTITY_KIND.autocannon && cols.hp[i]! > 0) {
        turretId = cols.id[i]!;
        turretState = cols.state[i]!;
        break;
      }
    }
    expect(turretState).toBe(ENTITY_STATE.active);
    const powerEval = getColonyPower(host.state, 0);
    expect(powerEval.entityPower?.[turretId]?.state).toBe('online');
    expect(powerEval.components?.some((c) => c.pylonIds.length === 0)).toBe(true);
  });
});

describe('Combat test diplomacy & PvP shield bypass', () => {
  it('disables AI-to-AI peace truces and newcomer shields with >= 3 bots while bots keep building', () => {
    const { host, meta } = createCombatTestHost({
      planetType: 'temperate',
      seed: 'combat-no-truce-4bots',
      botCount: 4,
      flags: FLAG_LIST,
    });
    initColonyNewcomerShield(host.state, 0);
    initColonyNewcomerShield(host.state, 1);
    initColonyNewcomerShield(host.state, 3);
    for (let c = 0; c <= 4; c++) {
      expect(isColonyRaidProtected(host.state, c)).toBe(false);
    }

    let botBuiltOrProduced = false;
    const truceCmds: string[] = [];
    for (let stepIdx = 0; stepIdx < 200; stepIdx++) {
      const batch = planBackendBotActions(host.state, host.pipeline.config.data, ALL_FLAGS, host.tick + 1, host.tick);
      for (const c of batch.commands) {
        if (c.kind === 'proposeTruce' || c.kind === 'respondTruce' || c.kind === 'diplomacy.proposeTruce' || c.kind === 'diplomacy.respondTruce') {
          truceCmds.push(c.kind);
        }
        if (c.kind === 'placeBuilding' || c.kind === 'enqueueTask' || c.kind === 'attackMove') botBuiltOrProduced = true;
        host.submit(c);
      }
      host.step(1);
    }
    expect(botBuiltOrProduced).toBe(true);
    expect(truceCmds).toHaveLength(0);

    const diplomacy = peekDiplomacyBlob(host.state);
    expect(Object.keys(diplomacy.offers)).toHaveLength(0);
    expect(Object.keys(diplomacy.truces)).toHaveLength(0);
    expect(hasActiveTruce(host.state, 1, 3)).toBe(false);

    const tileA = findDryOffsetNear(host.state, meta.staging.q, meta.staging.r, 0, 0);
    const tileB = findDryOffsetNear(host.state, tileA.q, tileA.r, 1, 0);
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: tileA.q, r: tileA.r, count: 1, owner: 1 }, 1));
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: tileB.q, r: tileB.r, count: 1, owner: 3 }, 3));
    host.step(1);

    const cols = host.state.entities.cols;
    let tank1Row = -1;
    let tank3Row = -1;
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.kind[i] === ENTITY_KIND.demoTank && cols.owner[i] === 1 && Math.round(cols.q[i]!) === tileA.q && Math.round(cols.r[i]!) === tileA.r) tank1Row = i;
      if (cols.kind[i] === ENTITY_KIND.demoTank && cols.owner[i] === 3 && Math.round(cols.q[i]!) === tileB.q && Math.round(cols.r[i]!) === tileB.r) tank3Row = i;
    }
    expect(tank1Row).toBeGreaterThanOrEqual(0);
    expect(tank3Row).toBeGreaterThanOrEqual(0);
    expect(isHostileTargetForAttacker(host.state, tank1Row, tank3Row)).toBe(true);

    const tank1Id = cols.id[tank1Row]!;
    const tank3Id = cols.id[tank3Row]!;
    const hpBefore = cols.hp[tank3Row]!;
    host.submit(cmd('attackTarget', { entityIds: [tank1Id], targetId: tank3Id }, 1));
    for (let t = 0; t < 25; t++) host.step(1);
    const updatedRow = rowOf(host.state.entities, tank3Id);
    expect(updatedRow < 0 || cols.hp[updatedRow]! < hpBefore).toBe(true);
  });

  it('rejects dev.spawnunit and dev.spawnhive on water/impassable tiles in combat test mode while dry land succeeds', () => {
    const { host, meta } = createCombatTestHost({ planetType: 'ocean', seed: 'combat-water-guard', botCount: 2 });
    const tiles = host.state.grid.layers;
    const radius = host.state.grid.radius;
    let waterTile: { q: number; r: number } | null = null;
    for (let r = -radius; r <= radius && !waterTile; r++) {
      const q1 = Math.max(-radius, -r - radius);
      const q2 = Math.min(radius, -r + radius);
      for (let q = q1; q <= q2; q++) {
        const idx = host.state.grid.layers.terrain.length > 0 ? (() => {
          let offset = 0;
          for (let rr = -radius; rr < r; rr++) offset += 2 * radius + 1 - Math.abs(rr);
          return offset + (q - q1);
        })() : -1;
        const t = tiles.terrain[idx];
        if (t === 4 || t === 5) waterTile = { q, r };
      }
    }
    expect(waterTile).not.toBeNull();
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: waterTile!.q, r: waterTile!.r, owner: 0 }));
    host.submit(cmd('dev.spawnhive', { species: 'blackAnt', q: waterTile!.q, r: waterTile!.r }));
    host.submit(cmd('dev.spawnunit', { unit: 'demoTank', q: meta.staging.q, r: meta.staging.r, owner: 0 }));
    const res = host.step(1);
    expect(res.outcomes[0]?.code).toBe('site_blocked');
    expect(res.outcomes[1]?.code).toBe('site_blocked');
    expect(res.outcomes[2]?.code).toBeUndefined();
  });
});
