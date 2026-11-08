import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PARTICLE_PRESETS,
  ParticlePresetRegistry,
  WorkParticleEmitter,
  WorkParticleSystem,
  computeMeshToolOrigins,
  deltaE76,
  evalArchetypeToolOrigins,
  evalBipedArmPoint,
  formatParticleReport,
  getParticleGeometry,
  getParticleGeometryTriCount,
  hexToLab,
  validateParticlePreset,
  type ParticleGeometryKind,
  type ParticlePresetSpec,
} from './index';

describe('Particle geometries & preset registry (@terra/render/particles)', () => {
  it('builds non-indexed 3D BufferGeometries with valid normals for all 15 chunk kinds', () => {
    const kinds: ParticleGeometryKind[] = [
      'leafCluster', 'pineNeedle', 'barkSlab', 'woodSplinter', 'rockShard',
      'slateChunk', 'sandGrain', 'dustCloud', 'soilClod', 'crystalShard',
      'oreNugget', 'oilDroplet', 'weldSpark', 'energyOrb', 'shockRing',
    ];
    for (const kind of kinds) {
      const geo = getParticleGeometry(kind);
      expect(geo.index).toBeNull();
      const pos = geo.getAttribute('position');
      const norm = geo.getAttribute('normal');
      expect(pos).toBeDefined();
      expect(norm).toBeDefined();
      expect(pos.count).toBeGreaterThanOrEqual(12);
      expect(getParticleGeometryTriCount(kind)).toBe(pos.count / 3);
    }
  });

  it('validates all 9 built-in object-of-interaction presets with 0 errors and 0 warnings', () => {
    expect(BUILTIN_PARTICLE_PRESETS.length).toBe(9);
    for (const preset of ParticlePresetRegistry.list()) {
      const report = validateParticlePreset(preset);
      expect(report.pass).toBe(true);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.primarySecondaryDeltaE).toBeGreaterThanOrEqual(15);
      expect(formatParticleReport(report, { quiet: true })).toContain('PASS');
    }
  });

  it('resolves targetKind accurately from terrain, deposit, mode, and biome', () => {
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'forest', biomeKey: 'oceanForest' })).toBe('tree');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'forest', biomeKey: 'dune' })).toBe('rock');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'rock', biomeKey: 'forestRock' })).toBe('rock');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'slope', biomeKey: 'dune' })).toBe('dune');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'hole', biomeKey: 'oceanForest' })).toBe('hole');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'flat', biomeKey: 'oceanForest' })).toBe('flat');
    expect(ParticlePresetRegistry.resolveTargetKind({ terrainKey: 'flat', biomeKey: 'dune' })).toBe('dune');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'flatten', biomeKey: 'oceanForest' })).toBe('dune');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'fill', biomeKey: 'oceanForest' })).toBe('hole');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'clear', biomeKey: 'oceanForest' })).toBe('tree');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'break', biomeKey: 'forestRock' })).toBe('rock');
    expect(ParticlePresetRegistry.resolveTargetKind({ depositKind: 'metals' })).toBe('metals');
    expect(ParticlePresetRegistry.resolveTargetKind({ depositKind: 'minerals' })).toBe('minerals');
    expect(ParticlePresetRegistry.resolveTargetKind({ depositKind: 'oil' })).toBe('oil');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'repair', terrainKey: 'forest' })).toBe('repair');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'construct' })).toBe('repair');
    // real W02 terraform ops (`TerraformOp`): grade follows the tile, dismantle is structural work
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'dismantle', biomeKey: 'oceanForest' })).toBe('repair');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'grade', terrainKey: 'hole', biomeKey: 'oceanForest' })).toBe('hole');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'grade', terrainKey: 'slope', biomeKey: 'oceanForest' })).toBe('dune');
    expect(ParticlePresetRegistry.resolveTargetKind({ mode: 'grade', biomeKey: 'oceanForest' })).toBe('flat');
  });
});

describe('Particle validator & WorkParticleSystem lifecycle', () => {
  it('catches composition, contrast, emissive, bounce, drag, beamRadius, and budget defects in validateParticlePreset', () => {
    const clean = structuredClone(ParticlePresetRegistry.getByTargetKind('tree'));
    expect(validateParticlePreset(clean).pass).toBe(true);

    const monochrome: ParticlePresetSpec = {
      ...structuredClone(clean),
      id: 'test.mono',
      toolBeam: { ...clean.toolBeam, beamRadius: 0 },
      layers: clean.layers.map((l) => ({
        ...l,
        color: l.role === 'accent' ? l.color : 0x55585c,
        bounce: 0,
        drag: -1,
      })),
    };
    const monoReport = validateParticlePreset(monochrome);
    expect(monoReport.pass).toBe(false);
    const codes = monoReport.issues.map((i) => i.code);
    expect(codes).toContain('LOW_LAYER_CONTRAST');
    expect(codes).toContain('NO_GROUND_BOUNCE');
    expect(codes).toContain('PHYSICS_INVALID');
    expect(deltaE76(hexToLab(0x38a845), hexToLab(0x5c3a21))).toBeGreaterThan(45);
  });

  it('manages active emitters, transitions stopped workers to dying, and cleans up after fadeout', () => {
    const parent = new THREE.Group();
    const sys = new WorkParticleSystem(parent);

    sys.syncSites([
      {
        workerId: '42',
        targetKind: 'tree',
        botOrigin: [0, 0, 0],
        toolOrigins: [[-0.3, 0.8, 0.4], [0.3, 0.8, 0.4]],
        targetPos: [0, 0.5, 1.2],
        groundY: 0,
        intensity: 1,
      },
    ]);
    expect(sys.getActiveCount()).toBe(1);
    for (let i = 0; i < 12; i++) sys.update(0.05);
    expect(sys.group.children.length).toBe(1);

    sys.syncSites([
      {
        workerId: '42',
        targetKind: 'rock',
        botOrigin: [0, 0, 0],
        toolOrigins: [[0, 0.5, 0.7]],
        targetPos: [0, 0.4, 1.2],
        groundY: 0,
        intensity: 1,
      },
    ]);
    expect(sys.getActiveCount()).toBe(2);

    sys.syncSites([]);
    for (let i = 0; i < 40; i++) sys.update(0.1);
    expect(sys.getActiveCount()).toBe(0);
    expect(sys.group.children.length).toBe(0);

    sys.emitCompletionBurst(
      {
        targetKind: 'dune',
        botOrigin: [1, 0, 1],
        toolOrigins: [[1, 0.6, 1.5]],
        targetPos: [1, 0.3, 2.1],
        groundY: 0,
      },
      0.2,
    );
    expect(sys.getActiveCount()).toBe(1);
    for (let i = 0; i < 45; i++) sys.update(0.05);
    expect(sys.getActiveCount()).toBe(0);
    sys.dispose();
  });
});

describe('Tool origins kinematics (@terra/render/particles)', () => {
  it('evaluates GPU-synchronized hand/tool origins for robot.hero and updates live with uTime and uWorkWeight', () => {
    const restOrigins = evalArchetypeToolOrigins({
      archetypeId: 'robot.hero',
      position: [0, 0, 0],
      yaw: 0,
      time: 0,
      walkWeight: 0,
      workWeight: 0,
    });
    const workOriginsT0 = evalArchetypeToolOrigins({
      archetypeId: 'robot.hero',
      position: [0, 0, 0],
      yaw: 0,
      time: 0,
      walkWeight: 0,
      workWeight: 1,
    });
    const workOriginsT1 = evalArchetypeToolOrigins({
      archetypeId: 'robot.hero',
      position: [0, 0, 0],
      yaw: 0,
      time: 0.35,
      walkWeight: 0,
      workWeight: 1,
    });

    expect(workOriginsT0).toHaveLength(2);
    // In work pose (workWeight = 1), BipedArm pitches hands up and forward compared to rest pose
    expect(workOriginsT0[0][1]).toBeGreaterThan(restOrigins[0][1] + 0.08);
    expect(workOriginsT0[0][2]).toBeGreaterThan(restOrigins[0][2] + 0.15);
    // Left and right hands oscillate with uTime during work sweep
    expect(workOriginsT1[0][1]).not.toBeCloseTo(workOriginsT0[0][1], 3);
    expect(workOriginsT1[1][2]).not.toBeCloseTo(workOriginsT0[1][2], 3);

    // Exact match with evalBipedArmPoint at scaled palm center
    const exactLeft = evalBipedArmPoint(
      [0.465 * 0.88, 0.79 * 0.88, 0.275 * 0.88],
      [0.44 * 0.88, 1.48 * 0.88, 0],
      0.35 * 5.0,
      0,
      1,
    );
    expect(workOriginsT1[0][0]).toBeCloseTo(exactLeft[0], 6);
    expect(workOriginsT1[0][1]).toBeCloseTo(exactLeft[1], 6);
    expect(workOriginsT1[0][2]).toBeCloseTo(exactLeft[2], 6);

    const mesh = new THREE.Mesh();
    mesh.position.set(2, 0.5, -1);
    mesh.rotation.y = Math.PI / 2;
    mesh.userData = {
      archetypeId: 'robot.hero',
      uniforms: {
        uTime: { value: 0.35 },
        uWalkWeight: { value: 0 },
        uWorkWeight: { value: 1 },
      },
    };
    const meshOrigins = computeMeshToolOrigins(mesh);
    expect(meshOrigins[0][0]).toBeCloseTo(2 + exactLeft[2], 5);
    expect(meshOrigins[0][1]).toBeCloseTo(0.5 + exactLeft[1], 5);
    expect(meshOrigins[0][2]).toBeCloseTo(-1 - exactLeft[0], 5);
  });
});

describe('Preset coverage & emitter robustness (@terra/render/particles)', () => {
  it('has exactly one preset per target kind, and NaN beam emissive fails the validator', () => {
    const kinds = ParticlePresetRegistry.list().map((p) => p.targetKind).sort();
    expect(kinds).toEqual(['dune', 'flat', 'hole', 'metals', 'minerals', 'oil', 'repair', 'rock', 'tree']);
    expect(new Set(BUILTIN_PARTICLE_PRESETS.map((p) => p.id)).size).toBe(9);
    const clean = structuredClone(ParticlePresetRegistry.getByTargetKind('rock'));
    const nanBeam = { ...clean, toolBeam: { ...clean.toolBeam, emissiveIntensity: Number.NaN, pulseFreq: Number.NaN } };
    const codes = validateParticlePreset(nanBeam).issues.map((i) => i.code);
    expect(codes).toContain('EMISSIVE_TOO_LOW');
    expect(codes).toContain('PHYSICS_INVALID');
  });

  it('an emitter freezes on dt 0 / NaN (no NaN positions) and sizes its burst ring by burst progress', () => {
    const site = {
      workerId: '7', targetKind: 'rock' as const, botOrigin: [0, 0, 0] as [number, number, number],
      toolOrigins: [[0, 0.5, 0.7]] as [number, number, number][], targetPos: [0, 0.4, 1.2] as [number, number, number],
      groundY: 0, intensity: 1,
    };
    const em = new WorkParticleEmitter(ParticlePresetRegistry.getByTargetKind('rock'), site);
    em.step(0.05);
    expect(em.step(Number.NaN)).toBe(true);
    expect(em.step(0)).toBe(true);
    em.step(0.05);
    const m = new THREE.Matrix4();
    for (const mesh of em.group.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh)) {
      mesh.getMatrixAt(0, m);
      expect(m.elements.every(Number.isFinite)).toBe(true);
    }
    const ring = em.group.children.find((c) => (c as THREE.Mesh).geometry === getParticleGeometry('shockRing'))!;
    em.triggerBurst(0.2);
    em.step(0.05); // 25 % through a 0.2 s burst: the ring starts small, not at the end of a 1 s burst's growth
    expect(ring.scale.x).toBeGreaterThan(0.45);
    expect(ring.scale.x).toBeLessThan(0.45 + 0.5 * 1.45);
    em.dispose();
  });

  it('spawns each chunk outside the target volume, with X, Y and Z all varying', () => {
    const target: [number, number, number] = [2, 0.52, -3];
    const em = new WorkParticleEmitter(ParticlePresetRegistry.getByTargetKind('tree'), {
      workerId: 'tree-outside',
      targetKind: 'tree',
      botOrigin: [2, 0, -6],
      toolOrigins: [[2, 0.9, -5.2]],
      targetPos: target,
      groundY: 0,
      intensity: 1,
    });
    const layers = (em as unknown as {
      layers: { px: Float32Array; py: Float32Array; pz: Float32Array; spec: { count: number } }[];
    }).layers;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (const layer of layers) {
      for (let i = 0; i < layer.spec.count; i++) {
        const dx = layer.px[i] - target[0];
        const dy = layer.py[i] - target[1];
        const dz = layer.pz[i] - target[2];
        expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(0.45);
        expect(Math.hypot(dx, dy, dz)).toBeLessThan(1.6);
        expect(layer.py[i]).toBeGreaterThanOrEqual(0.08 - 1e-5); // Float32Array rounds 0.08 down by a few nm
        xs.push(layer.px[i]);
        ys.push(layer.py[i]);
        zs.push(layer.pz[i]);
      }
    }
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(span(xs)).toBeGreaterThan(0.5);
    expect(span(ys)).toBeGreaterThan(0.5);
    expect(span(zs)).toBeGreaterThan(0.5);
    const keys = xs.map((x, i) => `${x.toFixed(4)}|${ys[i]!.toFixed(4)}|${zs[i]!.toFixed(4)}`);
    expect(new Set(keys).size).toBe(xs.length);

    em.step(0.016);
    const targetV = new THREE.Vector3(...target);
    const orbs = em.group.children.filter((c): c is THREE.Mesh =>
      (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry === getParticleGeometry('energyOrb'));
    const nearest = Math.min(...orbs.map((m) => m.position.distanceTo(targetV)));
    expect(nearest).toBeGreaterThan(0.45);
    expect(nearest).toBeLessThan(1.35);
    em.dispose();
  });
});
