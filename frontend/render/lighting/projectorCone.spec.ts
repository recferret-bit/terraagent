import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getArchetypeLights, type ArchetypeLightSource } from './archetypeLights';
import { COLONY_VISION_AND_LIGHTS_GLSL } from './ColonyVisionAndLights';
import { EntityProjectorRig } from './EntityProjectorRig';
import { createProjectorBeamMaterial } from './projectorBeamMaterial';
import {
  PROJECTOR_INNER_MIX,
  beamFalloff,
  beamHalfAngle,
  buildBeamRays,
  projectorConeFromSource,
  projectorCosOuter,
} from './projectorCone';

const hero = (): ArchetypeLightSource => getArchetypeLights('robot.hero')[0]!;

function scaled(src: ArchetypeLightSource, k: number): ArchetypeLightSource {
  return {
    ...src,
    pos: [src.pos[0] * k, src.pos[1] * k, src.pos[2] * k],
    target: [src.target[0] * k, src.target[1] * k, src.target[2] * k],
    coneBottomRadius: src.coneBottomRadius * k,
    poolRadius: src.poolRadius * k,
  };
}

describe('projector cone (one definition for the lit pool and the beam)', () => {
  it('robot.hero: the GPU half-angle is the game formula and does not depend on mesh scale', () => {
    const src = hero();
    const len = Math.hypot(src.target[0] - src.pos[0], src.target[1] - src.pos[1], src.target[2] - src.pos[2]);
    const spread = Math.max(src.coneBottomRadius, src.poolRadius) * 1.55;
    const expected = THREE.MathUtils.clamp(len / Math.hypot(len, spread), 0.52, 0.82);
    expect(projectorCosOuter(src)).toBeCloseTo(expected, 10);
    expect(projectorCosOuter(scaled(src, 1.15))).toBeCloseTo(expected, 10);
  });

  it('the inner cone mirrors the GLSL smoothstep of ColonyVisionAndLights', () => {
    expect(COLONY_VISION_AND_LIGHTS_GLSL).toContain(`mix(dirAngle.w, 1.0, ${PROJECTOR_INNER_MIX})`);
    const cone = projectorConeFromSource(hero());
    expect(cone.cosInner).toBeCloseTo(cone.cosOuter + (1 - cone.cosOuter) * PROJECTOR_INNER_MIX, 10);
    const half = beamHalfAngle(cone);
    expect(half).toBeGreaterThan(Math.acos(cone.cosInner));
    expect(half).toBeLessThan(Math.acos(cone.cosOuter));
  });

  it('every generator leaves the lamp at the beam half-angle and ends on the ground plane or at range', () => {
    const src = hero();
    const cone = projectorConeFromSource(src);
    const half = beamHalfAngle(cone);
    const rays = buildBeamRays(cone, { groundY: src.target[1], segments: 32 });
    expect(rays).toHaveLength(32);
    let hits = 0;
    for (const ray of rays) {
      expect(Math.acos(ray.dir.dot(cone.axis))).toBeCloseTo(half, 6);
      const end = ray.origin.clone().addScaledVector(ray.dir, ray.length);
      if (ray.hitsGround) {
        hits++;
        expect(end.y).toBeCloseTo(src.target[1], 6);
        expect(ray.length).toBeLessThan(cone.range);
        // On the ground the end point sits on the spot's half-power contour, i.e. the edge of the lit pool.
        const toEnd = end.clone().sub(cone.apex).normalize();
        expect(toEnd.dot(cone.axis)).toBeCloseTo((cone.cosOuter + cone.cosInner) / 2, 6);
      } else {
        expect(ray.length).toBeCloseTo(cone.range, 6);
      }
    }
    // The headlamp aims 65 deg off vertical: the lower part of the cone lands on the ground, the upper part fades out.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(rays.length);
  });

  it('a lamp aimed straight down lands on a circle of radius h * tan(half-angle)', () => {
    const pylon = getArchetypeLights('building.pylon')[0]!;
    const cone = projectorConeFromSource(pylon);
    const h = pylon.pos[1] - pylon.target[1];
    const r = h * Math.tan(beamHalfAngle(cone));
    for (const ray of buildBeamRays(cone, { groundY: pylon.target[1], segments: 16 })) {
      expect(ray.hitsGround).toBe(true);
      const end = ray.origin.clone().addScaledVector(ray.dir, ray.length);
      expect(Math.hypot(end.x - pylon.pos[0], end.z - pylon.pos[2])).toBeCloseTo(r, 6);
    }
  });

  it('sink extends ground-hitting generators below the plane (dips still get the beam)', () => {
    const src = hero();
    const cone = projectorConeFromSource(src);
    for (const ray of buildBeamRays(cone, { groundY: 0, sink: 1, aperture: 0.14 })) {
      if (!ray.hitsGround) continue;
      expect(ray.origin.y + ray.dir.y * ray.length).toBeCloseTo(-1, 6);
      expect(ray.origin.distanceTo(cone.apex)).toBeCloseTo(0.14, 6);
    }
  });

  it('falloff follows the GPU (1 - d / range)^2', () => {
    expect(beamFalloff(0, 10)).toBe(1);
    expect(beamFalloff(5, 10)).toBeCloseTo(0.25, 10);
    expect(beamFalloff(12, 10)).toBe(0);
  });

});

describe('projector beam mesh and material', () => {
  it('EntityProjectorRig draws the beam in model space along the light axis, never rotated or scaled', () => {
    const rig = new EntityProjectorRig('robot.hero');
    const beam = rig.group.getObjectByName('projector-beam-cone') as THREE.Mesh;
    expect(beam).toBeTruthy();
    expect(beam.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(beam.scale.equals(new THREE.Vector3(1, 1, 1))).toBe(true);
    const src = hero();
    const cone = projectorConeFromSource(src);
    const pos = beam.geometry.getAttribute('position');
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      expect(p.y).toBeGreaterThan(src.target[1] - 1.2 - 1e-4); // never below ground minus the sink
      expect(p.distanceTo(cone.apex)).toBeLessThan(cone.range + 0.2);
    }
    expect(beam.geometry.getAttribute('normal')).toBeTruthy();
    rig.dispose();
  });

  it('the beam material patches three\'s basic shader with the view-facing fade', () => {
    const mat = createProjectorBeamMaterial();
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vBeamN = normalize(normalMatrix * normal);');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= pow(abs(dot(normalize(vBeamN), normalize(vBeamView)))');
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    mat.dispose();
  });
});
