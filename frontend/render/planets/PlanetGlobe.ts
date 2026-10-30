import * as THREE from 'three';
import { isShaderOptimized } from '../core/perfConfig';
import type { PlanetSpec } from './PlanetSpec';

export interface PlanetGlobeOptions {
  radius?: number;
  segments?: number;
  /** Cloud shell radius multiplier (default 1.012). */
  cloudScale?: number;
  /** Atmosphere shell radius multiplier (default 1.07). */
  atmScale?: number;
}

export interface PlanetGlobe {
  readonly group: THREE.Group;   // position / scale / fade this
  readonly spin: THREE.Group;    // axial tilt + rotation
  /** Cloud shell (child of `spin`; drifts relative to the surface via rotation.y). */
  readonly clouds: THREE.Mesh;
  /** Limb/atmosphere shell (its ShaderMaterial exposes uShell = shell radius / planet radius). */
  readonly atmosphere: THREE.Mesh;
  readonly radius: number;
  readonly spec: PlanetSpec;
  readonly shared: {
    uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>; uOpacity: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>; uSkyBlend: THREE.IUniform<number>; uSkyColor: THREE.IUniform<THREE.Color>; uAtmStrength: THREE.IUniform<number>;
    uCloudNear: THREE.IUniform<THREE.Vector2>; uHazeDist: THREE.IUniform<THREE.Vector2>;
  };
  setSunDirection(worldDir: THREE.Vector3): void;
  /** 0..1 fade of the entire globe (surface, clouds, atmosphere). */
  setOpacity(o: number): void;
  /** 0..1 cloud presence, independent of the globe's opacity: 0 = clouds dissolved, 1 = full cover. Used by planet morphs. */
  setCloudPresence(v: number): void;
  /**
   * Terraforming progress 0..4 (continuous). Calling it switches the globe to its BARREN state (dust, dry seabeds) and
   * five player colonies then claim territory, one expanding front per whole step, each in its own colour. A claim stops
   * where it meets a neighbour (nearest-colony ownership), leaving a frozen two-sided border; fronts can never cross.
   * Inside a territory the world becomes habitable (grass, forest, new seas) with forge-city sprawl and 3D stacks around
   * the colony; clouds thicken and the atmosphere turns blue. Never called by the descent or the game menu.
   * `smooth` plays the stage continuously instead of in discrete steps (used to collapse a finished terraform before a morph).
   */
  setTerraform(stage: number, smooth?: boolean): void;
  /** Axial spin in rad/s (default 0.025, the menu's idle drift). Clouds drift relative to it. */
  setSpinRate(radPerSec: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}
import { createGlobeMaterials, createSharedUniforms } from './globe/materials';
import { ColonyBeams } from './globe/ColonyBeams';
import { ColonyStructures } from './globe/ColonyStructures';
import { TERRA_ATM, DUSTY_ATM, smooth01 } from './globe/terraform';

/** Procedural planet globe (surface + clouds + Fresnel/limb atmosphere) for one PlanetSpec. */
export function createPlanetGlobe(spec: PlanetSpec, opts: PlanetGlobeOptions = {}): PlanetGlobe {
  const radius = opts.radius ?? 10;
  // Large (descent-scale) globes are seen from a few hundred units up: 160 segments of a R=4000
  // sphere are ~157-unit facets and a polygonal limb, so clamp to 512x256 there. Small globes stay cheap.
  const big = radius > 1000;
  const seg = big ? Math.max(opts.segments ?? 128, 512) : (opts.segments ?? 128);
  const o = spec.orbital;
  const shared = createSharedUniforms(spec);
  const { surfMat, cloudMat, atmMat, atm, atmBase } = createGlobeMaterials(spec, radius, opts.atmScale, shared);

  const group = new THREE.Group(); group.name = `PlanetGlobe:${spec.kind}`;
  const spin = new THREE.Group(); spin.rotation.z = o.axialTilt;
  const geo = new THREE.SphereGeometry(radius, seg, Math.round(seg / 2));
  // renderOrder 0 < clouds (2) < atmosphere (3); among other transparents the globe's far-away origin sorts it first.
  const surface = new THREE.Mesh(geo, surfMat); surface.renderOrder = 0; surface.frustumCulled = false;
  const cloudScale = opts.cloudScale ?? 1.012;
  const cloudGeo = new THREE.SphereGeometry(radius * cloudScale, Math.round(seg * 0.75), Math.round(seg * 0.375));
  const clouds = new THREE.Mesh(cloudGeo, cloudMat); clouds.renderOrder = 2; clouds.frustumCulled = false;
  const atmGeo = new THREE.SphereGeometry(radius * (opts.atmScale ?? 1.07), big ? 192 : 96, big ? 96 : 48);
  const atmo = new THREE.Mesh(atmGeo, atmMat); atmo.renderOrder = 3; atmo.frustumCulled = false;
  spin.add(surface, clouds);

  const colonies = surfMat.uniforms.uCol.value as THREE.Vector3[];
  const beams = new ColonyBeams(radius, colonies, shared.uOpacity);
  spin.add(beams.group);
  const structures = new ColonyStructures(spin, colonies, radius, spec.seed);
  group.add(spin, atmo); // atmosphere is not tilted (rotation-invariant)

  let spinRate = 0.025;
  return {
    group, spin, clouds, atmosphere: atmo, radius, spec, shared,
    setSunDirection(d) { shared.uSunDir.value.copy(d).normalize(); },
    setOpacity(v) {
      const opacity = THREE.MathUtils.clamp(v, 0, 1); shared.uOpacity.value = opacity;
      surfMat.depthWrite = opacity > 0.5; // render state only — no needsUpdate / program switch
      group.visible = opacity > 0.002;
      structures.setOpacity(opacity); structures.layout();
    },
    setTerraform(stage, smooth = false) {
      const t = THREE.MathUtils.clamp(stage, 0, 4);
      surfMat.uniforms.uTerraSmooth.value = smooth ? 1 : 0;
      surfMat.uniforms.uTerra.value = t; surfMat.uniforms.uBarren.value = 1;   // calling this at all = start from a barren world
      const fl = Math.floor(Math.min(t, 3.9999)), fr = t >= 4 ? 1 : t - fl;
      const stepE = smooth ? t : t >= 4 ? 4 : fl + smooth01(fr / 0.7);            // same easing as the shader
      const act = smooth ? (t > 0 && t < 4 ? 0.6 : 0) : t >= 4 || t <= 0 ? 0 : Math.sin(Math.PI * Math.min(1, fr / 0.7));
      beams.setStrength(t <= 0 ? 0 : (0.2 + 0.8 * act) * Math.min(1, stepE * 4));
      structures.setRf(stepE * 0.43);
      if (t > 0) structures.ensure();
      structures.layout();
      const k = stepE / 4;
      cloudMat.uniforms.uCover.value = Math.min(1, THREE.MathUtils.lerp(o.cloudCover * 0.3, o.cloudCover + 0.15, k));   // dry air → wet air
      atm.value.copy(atmBase).lerp(DUSTY_ATM, 0.45).lerp(atmBase.clone().lerp(TERRA_ATM, 0.55), k);                       // dusty haze → blue
    },
    setCloudPresence(v) { cloudMat.uniforms.uCloudTween.value = THREE.MathUtils.clamp(v, 0, 1); },
    update(dt, time) {
      shared.uTime.value = time;
      shared.uOpt.value = isShaderOptimized() ? 1 : 0;
      spin.rotation.y += dt * spinRate;
      clouds.rotation.y += dt * spinRate * 0.24; // clouds drift relative to the surface
    },
    setSpinRate(r) { spinRate = r; },
    dispose() {
      geo.dispose(); beams.dispose(); structures.dispose(); cloudGeo.dispose(); atmGeo.dispose();
      surfMat.dispose(); cloudMat.dispose(); atmMat.dispose();
      group.removeFromParent();
    },
  };
}
