import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createArchetypeMesh } from '../kitbash';
import { attachInsectAnimator, getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { insectPartMatrix } from '../animation/insects/pose';
import { classifyInsectPart } from '../animation/insects/rig';
import { BattlePresentation } from './BattlePresentation';
import { CombatShotCoordinator } from './CombatShotCoordinator';
import { InsectCorpseLayer } from './InsectCorpseLayer';
import { ProjectileVfxSystem } from '../visuals/projectiles';
import { resetColonyVisionAndLights } from '../lighting';

describe('randomized insect deaths, gore VFX & persistent corpses', () => {
  it('generates distinct per-entity death poses while preserving valid rigid matrices and ground contact', () => {
    const matricesBySeed: number[][] = [];
    for (const [id, species] of [[101, 'blackAnt'], [207, 'blueBeetle'], [319, 'greenSpitter']] as const) {
      const arch = `fauna.${species}`;
      const meshA = createArchetypeMesh(arch);
      const meshB = createArchetypeMesh(arch);
      const animA = attachInsectAnimator(meshA);
      const animB = attachInsectAnimator(meshB);
      animA.die(id * 0.13);
      animB.die(id * 0.79);
      expect(animA.pose.deathSeed).not.toBe(animB.pose.deathSeed);
      animA.update(1.2);
      animB.update(1.2);
      expect(animA.state).toBe('dead');
      const speciesIdx = species === 'blackAnt' ? 0 : species === 'blueBeetle' ? 1 : 2;
      const head = classifyInsectPart('thorax torso', 0, [0, 0.5, 0]);
      const matA = insectPartMatrix(head, { ...animA.pose, species: speciesIdx });
      const matB = insectPartMatrix(head, { ...animB.pose, species: speciesIdx });
      expect(matA.determinant()).toBeCloseTo(1, 5);
      expect(matB.determinant()).toBeCloseTo(1, 5);
      expect(matA.elements.some((v, idx) => Math.abs(v - matB.elements[idx]!) > 1e-3)).toBe(true);
      matricesBySeed.push([...matA.elements]);
    }
    expect(matricesBySeed).toHaveLength(3);
  });

  it('triggers onDeath explosion + acid puddle once and bakes grounded corpses with severed pieces', () => {
    const parent = new THREE.Group();
    const bugA = createArchetypeMesh('fauna.blueBeetle');
    bugA.position.set(2, 0, 3);
    const bugB = createArchetypeMesh('fauna.greenSpitter');
    bugB.position.set(-3, 0, -1);

    const battle = new BattlePresentation(id => (id === 10 ? bugA : id === 11 ? bugB : undefined));
    const vfx = new ProjectileVfxSystem(parent);
    const shots = new CombatShotCoordinator(battle, vfx, id => (id === 10 ? bugA : id === 11 ? bugB : undefined));
    const onDeathSpy = vi.spyOn(vfx, 'emitInsectDeath');

    battle.insects.track(10, bugA, 20, false);
    battle.insects.track(11, bugB, 20, false);
    battle.insects.die(10);
    battle.insects.die(10); // duplicate death signal must not double-explode
    expect(onDeathSpy).toHaveBeenCalledTimes(1);
    expect(vfx.getBurstCounts()['combat.insectDeath']).toBeGreaterThan(0);
    expect(vfx.getBurstCounts()['combat.acidHit']).toBeGreaterThan(0);
    expect(vfx.getActiveAoeDecals().length).toBeGreaterThan(0);

    for (let i = 0; i < 15; i++) battle.update(0.1);
    const corpses = new InsectCorpseLayer(parent, 'desert', 2);
    let retired = false;
    battle.insects.retire(10, () => {
      retired = corpses.preserve(bugA, 0);
    }, true);
    for (let i = 0; i < 10; i++) battle.update(0.2);
    expect(retired).toBe(true);
    expect(corpses.count).toBe(1);

    const corpseMesh = corpses.group.children[0] as THREE.Mesh;
    corpseMesh.geometry.computeBoundingBox();
    expect(corpseMesh.geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
    const animAttr = corpseMesh.geometry.getAttribute('aPartAnim') as THREE.BufferAttribute;
    expect(Array.from(animAttr.array).every(v => v === 0)).toBe(true);
    const colorAttr = corpseMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = corpseMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let bloodVerts = 0;
    for (let i = 0; i < posAttr.count; i++) {
      if (posAttr.getY(i) <= 0.02 && colorAttr.getY(i) > 0.55 && colorAttr.getX(i) < 0.45) bloodVerts++;
    }
    expect(bloodVerts).toBeGreaterThan(20);
    expect(corpseMesh.geometry.boundingBox!.max.x - corpseMesh.geometry.boundingBox!.min.x).toBeGreaterThan(1.4);

    // FIFO eviction test when maxCorpses = 2
    battle.insects.die(11);
    battle.insects.retire(11, () => corpses.preserve(bugB, 0), true);
    const bugC = createArchetypeMesh('fauna.blackAnt');
    const cAnim = getInsectAnimator(bugC) ?? attachInsectAnimator(bugC);
    cAnim.die(0.42);
    cAnim.update(1.5);
    corpses.preserve(bugC, 0);
    expect(corpses.count).toBe(2);

    corpses.setBiome('oceanForest');
    expect(corpses.count).toBe(2);
    corpses.clear();
    expect(corpses.count).toBe(0);
    corpses.dispose();
    shots.clear();
    vfx.dispose();
    resetColonyVisionAndLights();
  });
});
