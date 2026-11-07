import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { getInsectAnimator } from '@terra/render/animation/insects/InsectAnimationController';
import { createState, insertRow, ENTITY_KIND, removeRow } from '@terra/sim';
import { CombatSyncController } from '../combatSync';

describe('insect event and snapshot ordering', () => {
  it('samples the release sac when the event precedes the action snapshot, without rewinding on an old view', () => {
    const mesh = createArchetypeMesh('fauna.greenSpitter');
    const sync = new CombatSyncController();
    sync.meshForEntity = id => id === 1 ? mesh : undefined;
    sync.battle.insects.track(1, mesh, 100, false);
    const old = { byEntityId: { 1: { state: 'windup', startedTick: 7, durationTicks: 3, targetId: 2 } } };
    sync.battle.insects.sync(old, 9);
    const animator = getInsectAnimator(mesh)!;
    expect(animator.state).toBe('windup');
    const event = { atTick: 10, data: { attackerId: 1, targetId: 2, weaponId: 'acidSpit', weaponType: 'acid',
      fromX: 0, fromY: 0, aimX: 4, aimY: 0, flightTicks: 3, impactTick: 13 } };
    sync.ingestProjectileFired(event);
    expect(animator.state).toBe('attack');
    const projectile = sync.projectiles.getActiveProjectiles()[0]!;
    const socket = animator.socket('projectile');
    expect(new THREE.Vector3(projectile.fromX, projectile.fromY, projectile.fromZ).distanceTo(socket)).toBeLessThan(1e-6);
    sync.battle.insects.sync(old, 9);
    sync.battle.insects.track(1, mesh, 100, false);
    expect(animator.state).toBe('attack');
    sync.ingestProjectileFired(event);
    expect(sync.projectiles.getActiveProjectiles()).toHaveLength(1);
    sync.battle.insects.sync({ byEntityId: { 1: { state: 'recovery', startedTick: 11, durationTicks: 6 } } }, 11);
    expect(animator.state).toBe('recovery');
    sync.dispose();
  });

  it('retains a snapshot-confirmed corpse through dying and dead, then disposes once', () => {
    const state = createState({ planetId: 'insect-death', planetType: 'temperate', seed: '7', radius: 4 });
    const row = insertRow(state.entities, 1, 0);
    state.entities.cols.kind[row] = ENTITY_KIND.blackAnt;
    state.entities.cols.hp[row] = 50;
    const mesh = createArchetypeMesh('fauna.blackAnt');
    const sync = new CombatSyncController();
    sync.battle.insects.track(1, mesh, 50, false);
    sync.syncPlanetState(state);
    let disposals = 0;
    sync.battle.insects.retire(1, () => { disposals++; });
    removeRow(state.entities, 1, 1);
    sync.syncPlanetState(state);
    expect(getInsectAnimator(mesh)!.state).toBe('dying');
    sync.battle.update(1);
    expect(getInsectAnimator(mesh)!.state).toBe('dead');
    expect(disposals).toBe(0);
    sync.battle.update(1.5);
    expect(disposals).toBe(1);
    sync.dispose();
    expect(disposals).toBe(1);
  });
});
