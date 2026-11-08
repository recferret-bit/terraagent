import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseWaves } from '@terra/contracts';
import { createArchetypeMesh } from '@terra/render/kitbash';
import {
  createRegistryPipeline, createState, ensureColonyLedger, ensureColonyRecord,
  populateShootingGallery, TERRAIN, PREP, SimHost, type SimEvent,
} from '@terra/sim';
import { CombatSyncController } from '../combatSync';
import { packView, unpackView } from '../../../store/replica/viewCodec';
import { EntityMeshes } from '../EntityMeshes';

describe('authoritative battle to client muzzle integration', () => {
  it('holds an early shot until the shooter mesh exists instead of firing from its center', () => {
    const sync = new CombatSyncController();
    let mesh: THREE.Object3D | undefined;
    sync.meshForEntity = () => mesh;
    const event = { kind: 'projectileFired', atTick: 1, data: { attackerId: 1, targetId: 2, weaponId: 'laserTower', fromX: 0, fromY: 0, aimX: -4, aimY: -2 } };
    sync.ingestProjectileFired(event);
    expect(sync.vfxFiredSpawnCount).toBe(0);
    mesh = createArchetypeMesh('building.laserTower');
    sync.update(0.01);
    expect(sync.vfxFiredSpawnCount).toBe(1);
    const beam = sync.projectiles.getActiveLasers()[0]!;
    const from = sync.battle.getRig(1)!.muzzle();
    expect(new THREE.Vector3(beam.fromX, beam.fromY, beam.fromZ).distanceTo(from)).toBeLessThan(1e-6);
    sync.dispose();
  });

  it('uses authoritative target records and the same muzzle rig after snapshot replication', () => {
    const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });
    const state = createState({ planetId: 'gallery-client', planetType: 'temperate', seed: '7', radius: 12 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.prep.fill(PREP.prepared);
    const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    colony.status = 'active'; colony.powerSupplyOverride = 800;
    const lanes = populateShootingGallery(state, 'mixed', pipeline.config.data);
    const host = new SimHost(pipeline);
    host.load(state);
    const events: SimEvent[] = [];
    host.onEvents(batch => events.push(...batch));
    host.step(1);
    const entities = new EntityMeshes(new THREE.Scene(), createArchetypeMesh, false);
    entities.syncView(unpackView(packView(host.view(), true).view), null);
    entities.combatSync.ingestCombatEvents(events);
    entities.combatSync.update(0.01);
    for (const lane of lanes) {
      const rig = entities.combatSync.battle.getRig(lane.shooterId);
      expect(rig).toBeDefined();
      expect(entities.combatSync.firedHistory.some(e => e.attackerId === lane.shooterId && e.targetId === lane.targetId)).toBe(true);
    }
    const laser = entities.combatSync.projectiles.getActiveLasers()[0]!;
    const muzzle = entities.combatSync.battle.getRig(lanes[1]!.shooterId)!.muzzle();
    expect(new THREE.Vector3(laser.fromX, laser.fromY, laser.fromZ).distanceTo(muzzle)).toBeLessThan(1e-6);
    entities.dispose();
  });

  it('matches a serialized server impact to the varied exterior endpoint and emits only one burst', () => {
    const shooter = createArchetypeMesh('building.turret');
    const target = createArchetypeMesh('fauna.blueBeetle');
    target.position.set(8, 0, 0);
    const sync = new CombatSyncController();
    sync.meshForEntity = id => id === 1 ? shooter : id === 2 ? target : undefined;
    const fired = { kind: 'projectileFired', atTick: 10, data: {
      attackerId: 1, targetId: 2, weaponId: 'autocannon', weaponType: 'bullet',
      fromX: 0, fromY: 0, aimX: 4, aimY: 0, flightTicks: 2, impactTick: 12,
    } };
    sync.ingestProjectileFired(JSON.parse(JSON.stringify(fired)));
    const projectile = sync.projectiles.getActiveProjectiles()[0]!;
    expect(projectile.toX).toBeLessThan(target.position.x);
    const impact = { kind: 'projectileImpact', atTick: 12, data: {
      attackerId: 1, targetId: 2, weaponId: 'autocannon', weaponType: 'bullet', aimX: 4, aimY: 0, hit: true,
    } };
    sync.ingestProjectileImpact(JSON.parse(JSON.stringify(impact)));
    sync.ingestProjectileImpact(JSON.parse(JSON.stringify(impact)));
    expect(sync.projectiles.getBurstCounts()['combat.impact']).toBe(20);
    expect(sync.vfxImpactSpawnCount).toBe(1);
    const burst = sync.projectiles.group.children.find(child => child.name === 'combat.impact/Chitin / armor chips') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    burst.getMatrixAt(0, matrix);
    const point = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(point.distanceTo(new THREE.Vector3(projectile.toX, projectile.toY, projectile.toZ))).toBeLessThan(0.15);
    sync.dispose();
  });

});
