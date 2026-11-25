// @vitest-environment jsdom
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { COMBAT_TEST_FLAGS, ENTITY_KIND, ENTITY_STATE, hexIndex } from '@terra/sim';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { packEntities, type ClientView, type EntityRow } from '../../../store/replica/viewCodec';
import { LocalHost } from '../../../store/local/LocalHost';
import { combatTestSource } from '../../../store/local/planetSource';
import { bindStoreCombatEvents, ingestHostMessageCombatEvents } from '../combatEventBindings';
import { EntityMeshes } from '../EntityMeshes';
import { listSceneEntities } from '../viewportHelper';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function makeView(
  tick: number,
  rows: Array<Partial<EntityRow> & { id: number; kind: number }>,
  planetId = 'pl_death_test',
): ClientView {
  const fullRows: EntityRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    owner: r.owner ?? 0,
    q: r.q ?? 0,
    r: r.r ?? 0,
    x: r.x ?? r.q ?? 0,
    y: r.y ?? r.r ?? 0,
    rot: r.rot ?? 0,
    hp: r.hp ?? 100,
    hpMax: r.hpMax ?? 100,
    state: r.state ?? ENTITY_STATE.active,
    progress: r.progress ?? 1,
    tier: r.tier ?? 1,
  }));
  return {
    tick,
    planet: { id: planetId, type: 'temperate', radius: 16, seed: 'death-seed' },
    count: fullRows.length,
    entities: packEntities(fullRows as unknown as Parameters<typeof packEntities>[0]),
    colonies: [{ index: 0, id: 'col_0', status: 'active' }],
  } as unknown as ClientView;
}

describe('EntityMeshes mechanical deaths — WorldStore event-before-view order & pool reuse', () => {
  it('explodes once, hides live mesh, preserves shattered wreck & recycles pooled bot/building meshes cleanly', () => {
    const scene = new THREE.Scene();
    const factoryCounts = new Map<string, number>();
    const entities = new EntityMeshes(scene, (id, biome) => {
      factoryCounts.set(id, (factoryCounts.get(id) ?? 0) + 1);
      return createArchetypeMesh(id, biome);
    });

    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 2, kind: ENTITY_KIND.recon, q: 3, r: 0 },
        { id: 3, kind: ENTITY_KIND.autocannon, q: -3, r: 1 },
      ]),
      null,
      'forestRock',
    );
    const reconPoolCreated = factoryCounts.get('robot.recon')!;
    const turretPoolCreated = factoryCounts.get('building.turret')!;

    // Server event arrives BEFORE snapshot drops the destroyed entities
    entities.combatSync.ingestCombatEvents([
      { kind: 'unitDestroyed', atTick: 2, data: { entityId: 2 } },
      { kind: 'buildingDestroyed', atTick: 2, data: { entityId: 3 } },
    ]);

    expect(entities.wrecks.count).toBe(2);
    expect(entities.wrecks.has(2)).toBe(true);
    expect(entities.wrecks.has(3)).toBe(true);
    expect(entities.getRecord(2)!.mesh.visible).toBe(false);
    expect(entities.getRecord(3)!.mesh.visible).toBe(false);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.botDeath']).toBeGreaterThan(0);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.buildingDeath']).toBeGreaterThan(0);
    expect(entities.combatSync.projectiles.getActiveCounts().shockwaves).toBe(4);
    expect(entities.combatSync.projectiles.getSmolderSiteCount()).toBe(2);

    // Subsequent snapshot removes killed entities without double-exploding or duplicating wrecks
    const shockwavesBeforeRemoval = entities.combatSync.projectiles.getActiveCounts().shockwaves;
    entities.syncView(makeView(2, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }]), null, 'forestRock');
    expect(entities.wrecks.count).toBe(2);
    expect(entities.combatSync.projectiles.getActiveCounts().shockwaves).toBe(shockwavesBeforeRemoval);
    expect(listSceneEntities(scene).map((e) => e.id)).toEqual([1]);

    // Pooled meshes are immediately available for reuse on next spawn (0 new factory allocations)
    entities.syncView(
      makeView(3, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 20, kind: ENTITY_KIND.recon, q: 4, r: 1 },
        { id: 30, kind: ENTITY_KIND.autocannon, q: -4, r: -1 },
      ]),
      null,
      'forestRock',
    );
    expect(factoryCounts.get('robot.recon')).toBe(reconPoolCreated);
    expect(factoryCounts.get('building.turret')).toBe(turretPoolCreated);
    entities.dispose();
  });
});

describe('EntityMeshes mechanical deaths — LocalHost snapshot-before-event & zero-HP fallback', () => {
  it('bridges view removal before death event via PendingDeathSnapshot and handles hp<=0 snapshots', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);

    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 5, kind: ENTITY_KIND.demoTank, q: 2, r: 2 },
        { id: 6, kind: ENTITY_KIND.solar, q: -4, r: 2 },
        { id: 7, kind: ENTITY_KIND.demoArtillery, q: 4, r: -2 },
      ]),
      null,
      'desert',
    );

    // LocalHost removes killed tank & solar BEFORE emitting combat events
    entities.syncView(
      makeView(2, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 7, kind: ENTITY_KIND.demoArtillery, q: 4, r: -2, hp: 0 }, // zero-HP fallback test
      ]),
      null,
      'desert',
    );
    expect(entities.wrecks.has(7)).toBe(true); // hp <= 0 triggers immediately
    expect(entities.wrecks.has(5)).toBe(false);
    expect(entities.wrecks.has(6)).toBe(false);

    // Death events arrive immediately after syncView (exact LocalHost.fromCore order)
    entities.combatSync.ingestCombatEvents([
      { kind: 'unitDestroyed', atTick: 2, data: { entityId: 5 } },
      { kind: 'buildingDestroyed', atTick: 2, data: { entityId: 6 } },
    ]);

    expect(entities.wrecks.has(5)).toBe(true);
    expect(entities.wrecks.has(6)).toBe(true);
    expect(entities.wrecks.count).toBe(3);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.botDeath']).toBeGreaterThan(0);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.buildingDeath']).toBeGreaterThan(0);
    entities.dispose();
  });
});

describe('EntityMeshes death exclusions & edge cases (cancel/dismantle, pod, fauna, rebuild & rollback)', () => {
  it('ignores non-death removals (cancel/dismantle/pod) and routes fauna separately from mechanical wrecks', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);

    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 2, kind: ENTITY_KIND.solar, q: 2, r: 0, state: ENTITY_STATE.constructing, progress: 0.3 },
        { id: 3, kind: ENTITY_KIND.pod, q: -2, r: 0 },
        { id: 4, kind: ENTITY_KIND.blackAnt, owner: -1, q: 6, r: 0, hp: 5 },
        { id: 8, kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 8, r: 0 },
      ]),
      null,
      'forestRock',
    );

    // Cancelled solar construction, unpacked pod, killed ant & destroyed hive leave view
    entities.combatSync.ingestCombatEvents([
      { kind: 'faunaKilled', atTick: 2, data: { entityId: 4 } },
      { kind: 'nestDestroyed', atTick: 2, data: { entityId: 8 } },
    ]);
    entities.syncView(makeView(2, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }]), null, 'forestRock');
    entities.update(1.0, null, 1.0); // Exceed PENDING_DEATH_TTL_S

    expect(entities.wrecks.count).toBe(0);
    expect(entities.combatSync.projectiles.getActiveCounts().aoeDecals).toBe(0);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.botDeath'] ?? 0).toBe(0);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.buildingDeath'] ?? 0).toBe(0);
    entities.dispose();
  });

  it('clears rubble when rebuilding on destroyed building tiles, supports prediction rollback & resets on planet switch', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);

    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 10, kind: ENTITY_KIND.solar, q: 3, r: 0 },
        { id: 11, kind: ENTITY_KIND.recon, q: -5, r: -3 },
        { id: 12, kind: ENTITY_KIND.demoTank, q: 2, r: 3 },
      ]),
      null,
      'forestRock',
    );
    entities.combatSync.ingestCombatEvents([
      { kind: 'buildingDestroyed', atTick: 2, data: { entityId: 10 } },
      { kind: 'unitDestroyed', atTick: 2, data: { entityId: 11 } },
      { kind: 'unitDestroyed', atTick: 2, data: { entityId: 12 } },
    ]);
    expect(entities.wrecks.count).toBe(3);

    // Rollback snapshot revives tank id=12 at tick >= 2 -> removes premature wreck & restores mesh visibility
    entities.syncView(
      makeView(2, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 12, kind: ENTITY_KIND.demoTank, q: 2, r: 3, hp: 90 },
      ]),
      null,
      'forestRock',
    );
    expect(entities.wrecks.has(12)).toBe(false);
    expect(entities.getRecord(12)!.mesh.visible).toBe(true);

    // Rebuilding at (3, 0) clears overlapping wreck id=10 while keeping distant wreck id=11
    entities.syncView(
      makeView(3, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 12, kind: ENTITY_KIND.demoTank, q: 2, r: 3, hp: 90 },
        { id: 25, kind: ENTITY_KIND.wind, q: 3, r: 0 },
      ]),
      null,
      'forestRock',
    );
    expect(entities.wrecks.has(10)).toBe(false);
    expect(entities.wrecks.has(11)).toBe(true);

    // Switching planet wipes remaining wrecks
    entities.syncView(makeView(4, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }], 'pl_other'), null, 'desert');
    expect(entities.wrecks.count).toBe(0);
    entities.dispose();
  });
});

describe('LocalHost + combatTest scenario live mechanical combat kill integration', () => {
  it('produces bot/building death explosions & shattered wrecks when combatTest scenario runs kills through LocalHost', () => {
    const host = new LocalHost({
      flags: [...COMBAT_TEST_FLAGS],
      source: combatTestSource({ planetType: 'temperate', seed: 'death-int-test', botCount: 2 }),
    });
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    const offStore = bindStoreCombatEvents(host.store, entities.combatSync, () => null);
    const offMsg = host.onMessage((msg) => ingestHostMessageCombatEvents(msg, entities.combatSync, null));
    const offView = host.store.onView((v) => entities.syncView(v, null, 'forestRock', v.tick));

    host.bindStore(host.store);
    const cols = host.state.entities.cols;
    let targetId = -1, targetQ = 0, targetR = 0;
    for (let i = 0; i < host.state.entities.count; i++) {
      if ((cols.owner[i] ?? -1) > 0 && cols.hp[i]! > 0 && cols.kind[i] !== ENTITY_KIND.hq) {
        targetId = cols.id[i]!;
        targetQ = Math.round(cols.q[i]!);
        targetR = Math.round(cols.r[i]!);
        break;
      }
    }
    expect(targetId).toBeGreaterThan(0);

    // Spawn 2 player demoTanks beside rival entity + enemy recon unit right next to them
    host.sim.submit({ colonyIndex: 0, source: 'dev', commandId: 'c1', kind: 'dev.spawnunit', args: { unit: 'demoTank', q: targetQ + 2, r: targetR, count: 2, colonyIndex: 0, fallbackNear: true } });
    host.sim.submit({ colonyIndex: 1, source: 'dev', commandId: 'c2', kind: 'dev.spawnunit', args: { unit: 'recon', q: targetQ + 1, r: targetR + 1, colonyIndex: 1, owner: 1, fallbackNear: true } });
    host.step(2);

    const tankIds: number[] = [];
    for (let i = 0; i < host.state.entities.count; i++) {
      if (cols.owner[i] === 0 && cols.hp[i]! > 0 && cols.kind[i] === ENTITY_KIND.demoTank && Math.abs(cols.q[i]! - targetQ) <= 6) {
        tankIds.push(cols.id[i]!);
      }
    }
    expect(tankIds.length).toBeGreaterThan(0);
    host.sim.submit({ colonyIndex: 0, source: 'player', commandId: 'c3', kind: 'attackTarget', args: { entityIds: tankIds, targetId } });

    for (let i = 0; i < 40 && entities.wrecks.count === 0; i++) {
      host.step(3);
      entities.update(0.1, null, 0.1);
    }

    expect(entities.wrecks.count).toBeGreaterThan(0);
    const firstWreck = entities.wrecks.group.children[0] as THREE.Mesh;
    firstWreck.geometry.computeBoundingBox();
    expect(firstWreck.geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
    const bursts = entities.combatSync.projectiles.getBurstCounts();
    expect((bursts['combat.botDeath'] ?? 0) + (bursts['combat.buildingDeath'] ?? 0)).toBeGreaterThan(0);

    offView();
    offMsg();
    offStore();
    entities.dispose();
    host.stop();
  });
});

describe('EntityMeshes death edge guards (meteorImpact, FoW suppression, sloped groundY & planet switch reset)', () => {
  it('explodes & wrecks both bots and buildings destroyed by meteorImpact and clears combatSync on planet switch', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 40, kind: ENTITY_KIND.recon, q: 2, r: 1 },
        { id: 41, kind: ENTITY_KIND.laserTower, q: -2, r: 2 },
      ]),
      null,
      'forestRock',
    );
    entities.combatSync.ingestCombatEvents([
      { kind: 'meteorImpact', atTick: 2, data: { x: 2, y: 1, destroyedEntityIds: [40, 41] } },
    ]);
    expect(entities.wrecks.has(40)).toBe(true);
    expect(entities.wrecks.has(41)).toBe(true);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.botDeath']).toBeGreaterThan(0);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.buildingDeath']).toBeGreaterThan(0);
    expect(entities.combatSync.projectiles.getActiveCounts().shockwaves).toBe(4);
    expect(entities.combatSync.projectiles.getSmolderSiteCount()).toBe(2);

    // Planet switch must wipe active shockwaves and smolders from combatSync along with wrecks
    entities.syncView(makeView(3, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }], 'pl_next'), null, 'desert');
    expect(entities.wrecks.count).toBe(0);
    expect(entities.combatSync.projectiles.getActiveCounts().shockwaves).toBe(0);
    expect(entities.combatSync.projectiles.getSmolderSiteCount()).toBe(0);
    entities.dispose();
  });

  it('suppresses explosion VFX and wrecks for foreign enemies destroyed unseen under Fog of War', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    const radius = 16;
    const count = hexIndex(radius).count;
    const view = makeView(1, [
      { id: 1, kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0 },
      { id: 77, kind: ENTITY_KIND.recon, owner: 1, q: 10, r: 0 },
    ]);
    view.tiles = {
      count,
      terrain: new Uint8Array(count),
      prep: new Uint8Array(count),
      height: new Float32Array(count),
      owner: new Int8Array(count).fill(-1),
      explored: new Uint8Array(count),
    };
    view.blobs = { combatVision: { byColony: { 0: [hexIndex(radius).indexOf(0, 0)] } } };

    entities.syncView(view, null, 'forestRock');
    expect(entities.getRecord(77)!.mesh.visible).toBe(false);

    entities.combatSync.ingestCombatEvents([{ kind: 'unitDestroyed', atTick: 2, data: { entityId: 77 } }]);
    expect(entities.wrecks.has(77)).toBe(false);
    expect(entities.combatSync.projectiles.getBurstCounts()['combat.botDeath'] ?? 0).toBe(0);
    expect(entities.combatSync.projectiles.getActiveCounts().shockwaves).toBe(0);
    entities.dispose();
  });

  it('elevates multi-tile building wreck groundY onto elevated hill pads instead of burying into lower center height', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    // Mock sloped HexTerrain: center heightAt = 0.2 while pad corner tile height is 1.4
    const slopedTerrain = {
      radius: 16,
      heightAt: (x: number) => (x > 0.5 ? 1.4 : 0.2),
      tileHeightAt: (q: number) => (q > 0 ? 1.4 : 0.2),
    } as unknown as HexTerrain;

    entities.syncView(
      makeView(1, [
        { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
        { id: 88, kind: ENTITY_KIND.roboticsFactory, q: 0, r: 0 },
      ]),
      slopedTerrain,
      'forestRock',
    );
    const factoryRec = entities.getRecord(88)!;
    const expectedElevatedY = factoryRec.mesh.position.y;
    expect(expectedElevatedY).toBeGreaterThanOrEqual(1.39);

    entities.combatSync.ingestCombatEvents([{ kind: 'buildingDestroyed', atTick: 2, data: { entityId: 88 } }]);
    const wreckMesh = entities.wrecks.group.children[0] as THREE.Mesh;
    expect(wreckMesh.position.y).toBeCloseTo(expectedElevatedY, 3);
    entities.dispose();
  });
});

describe('EntityMeshes wreck exact-hex placement & terraform sync', () => {
  it('snaps moving bot wrecks onto the exact pre-death hex center and removes the wreck mesh once cleared in blobs.wrecks', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    const radius = 12;
    const ti = hexIndex(radius).indexOf(5, -2);
    const [hxX, hxZ] = tileXZ(5, -2);

    const view1 = makeView(1, [
      { id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 },
      { id: 91, kind: ENTITY_KIND.demoTank, q: 5, r: -2 },
    ]);
    entities.syncView(view1, null, 'desert');
    const tankRec = entities.getRecord(91)!;
    // Simulate mid-hex interpolated render mesh offset away from exact (5, -2) hex center
    tankRec.mesh.position.x = hxX + 0.48;
    tankRec.mesh.position.z = hxZ - 0.39;

    entities.syncView(
      {
        ...makeView(2, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }]),
        blobs: { wrecks: { byId: { '91': { id: 91, kind: ENTITY_KIND.demoTank, owner: 0, q: 5, r: -2, tiles: [ti], createdAt: 2 } } } },
      },
      null,
      'desert',
    );
    entities.combatSync.ingestCombatEvents([{ kind: 'unitDestroyed', atTick: 2, data: { entityId: 91 } }]);

    expect(entities.wrecks.has(91)).toBe(true);
    const wreckMesh = entities.wrecks.group.children[0] as THREE.Mesh;
    expect(wreckMesh.position.x).toBeCloseTo(hxX, 4);
    expect(wreckMesh.position.z).toBeCloseTo(hxZ, 4);

    // Sim clears wreck via terraform -> blobs.wrecks removes entry 91 -> visual wreck is removed on next view sync
    entities.syncView(
      {
        ...makeView(3, [{ id: 1, kind: ENTITY_KIND.commandHub, q: 0, r: 0 }]),
        blobs: { wrecks: { byId: {} } },
      },
      null,
      'desert',
    );
    expect(entities.wrecks.has(91)).toBe(false);
    entities.dispose();
  });
});
