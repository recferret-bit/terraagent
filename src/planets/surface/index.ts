import * as THREE from 'three';
import type { CreatePlanetSurface, PlanetSurface } from './types';
import { createHeightField } from '../../visuals/terrain/heightfields';
import { createTerrain } from '../../visuals/terrain/TerrainMesh';
import { createWater } from '../../visuals/terrain/Liquids';
import { createParticles } from '../../visuals/terrain/Particles';
import { Noise2, mulberry32, smoothstep } from '../../visuals/terrain/noise';
import {
  scatterGrid, buildInstanced, createFoliageMaterial, createRockMaterial,
  makeBroadleafGeo, makePalmGeo, makePineGeo, makeBoulderGeo, makeSpireGeo, type Place,
} from '../../visuals/terrain/Scatter';

export { applyPlanetLook } from '../applyPlanetLook';
export type { PlanetSurface, CreatePlanetSurface } from './types';

/** Brightness/hue jitter relative to the geometry's baked vertex colours. */
const jitter = (amt: number, hueShift = 0) => (r: number, c: THREE.Color) => {
  const k = 1 + (r - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (r - 0.5) * hueShift), k, k * (1 - (r - 0.5) * hueShift));
};

export const createPlanetSurface: CreatePlanetSurface = (spec, opts) => {
  const half = opts?.halfSize ?? 64;
  const quality = opts?.quality ?? 'high';
  const N = quality === 'high' ? 320 : 200;
  const cellMul = quality === 'high' ? 1 : 1.4;
  const field = createHeightField(spec, half * 2);
  const terrain = createTerrain(spec, field, half, N);
  const heightAt = terrain.heightAt;
  const liquid = field.liquid;
  const level = liquid?.level ?? -999;

  const group = new THREE.Group();
  group.name = `surface-${spec.kind}`;
  group.add(terrain.mesh);

  const timeU: THREE.IUniform = { value: 0 };
  const uniformSets: Record<string, THREE.IUniform>[] = [terrain.uniforms];
  const disposables: { dispose(): void }[] = [terrain];

  const isLiquid = (x: number, z: number) => !!liquid && heightAt(x, z) < level + 0.12;
  const slopeAt = (x: number, z: number) => {
    const d = 0.9, h = heightAt(x, z);
    return Math.max(Math.abs(heightAt(x + d, z) - h), Math.abs(heightAt(x - d, z) - h), Math.abs(heightAt(x, z + d) - h), Math.abs(heightAt(x, z - d) - h)) / d;
  };
  const landingFree = (x: number, z: number) => smoothstep(14, 19, Math.hypot(x, z));

  const P = spec.palette;
  const nz = new Noise2(spec.seed + 99);
  const rng = mulberry32(spec.seed * 13 + 5);
  const ext = half * 1.25;
  const lift = (arr: Place[]) => arr.forEach((p) => { p.y = heightAt(p.x, p.z); });

  const addMesh = (m: THREE.InstancedMesh) => { group.add(m); disposables.push({ dispose() { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); } }); };
  const rockMat = createRockMaterial({ rough: 0.92 });
  disposables.push({ dispose: () => rockMat.dispose() });
  const rockTint = new THREE.Color(P.rock);
  const darkTint = new THREE.Color(P.rockDark);

  const boulders = (count: number, probFn: (x: number, z: number) => number, size: [number, number], tint: THREE.Color, variants = 2, mat: THREE.Material = rockMat) => {
    const places = scatterGrid(rng, ext, 2.0 * cellMul, (x, z) => probFn(x, z) * landingFree(x, z));
    places.length = Math.min(places.length, count);
    lift(places);
    for (let v = 0; v < variants; v++) {
      const sub = places.filter((_, i) => i % variants === v);
      addMesh(buildInstanced(makeBoulderGeo(11 + v * 5 + spec.seed % 7, tint.clone().lerp(darkTint, v * 0.25)), mat, sub, { sx: size, sy: [size[0] * 0.7, size[1] * 0.85], sink: 0.12, tilt: 0.35, tint: jitter(0.28) }));
    }
  };
  const spires = (probFn: (x: number, z: number) => number, count: number, w: [number, number], h: [number, number], tint: THREE.Color, mat: THREE.Material = rockMat) => {
    const places = scatterGrid(rng, ext, 3.0 * cellMul, (x, z) => probFn(x, z) * landingFree(x, z));
    places.length = Math.min(places.length, count);
    lift(places);
    addMesh(buildInstanced(makeSpireGeo(7 + spec.seed % 5, tint), mat, places, { sx: w, sy: h, sink: 0.02, tilt: 0.12, tint: jitter(0.25) }));
  };

  const light = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

  switch (spec.kind) {
    case 'dune': {
      // rust-red rock clusters
      const cl: Place[] = [];
      for (let c = 0; c < 26; c++) {
        const a = rng() * Math.PI * 2, r = 13 + rng() * (ext - 16);
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        const n = 4 + Math.floor(rng() * 8);
        for (let k = 0; k < n; k++) {
          const aa = rng() * Math.PI * 2, rr = Math.pow(rng(), 0.7) * 3.2;
          cl.push({ x: cx + Math.cos(aa) * rr, z: cz + Math.sin(aa) * rr, y: 0, rot: rng() * 6.28, s: Math.pow(rng(), 2.2), r: rng() });
        }
      }
      const places = cl.filter((p) => landingFree(p.x, p.z) > 0.5 && slopeAt(p.x, p.z) < 1.1);
      lift(places);
      for (let v = 0; v < 3; v++) {
        const sub = places.filter((_, i) => i % 3 === v);
        addMesh(buildInstanced(makeBoulderGeo(21 + v * 4, rockTint.clone().lerp(darkTint, v * 0.22)), rockMat, sub, { sx: [0.35, 2.3], sy: [0.3, 1.8], sink: 0.2, tilt: 0.4, tint: jitter(0.3, 0.2) }));
      }
      spires((x, z) => (nz.n(x * 0.05, z * 0.05) > 0.45 ? 0.5 : 0), 24, [0.5, 1.0], [2.5, 6], rockTint.clone().lerp(new THREE.Color(P.groundLow), 0.25));
      const dust = createParticles({ count: 900, box: 150, height: 9, size: 1.5, color: new THREE.Color(0xf0cf9a), drift: new THREE.Vector3(field.wind[0] * 3.2, 0.05, field.wind[1] * 3.2), wobble: 1.5, additive: false, alpha: 0.18, seed: spec.seed });
      group.add(dust.points); uniformSets.push(dust.uniforms); disposables.push(dust);
      break;
    }
    case 'oceanForest': {
      const water = createWater({ level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span }, P.water ?? 0x1f9fb8, P.waterDeep ?? 0x0b3f66, spec.sky.skyColor);
      group.add(water.mesh); uniformSets.push(water.uniforms); disposables.push(water);
      const la = light(P.groundLow, 1.05), lb = light(P.groundHigh, 0.9);
      const forestN = (x: number, z: number) => smoothstep(-0.25, 0.25, nz.fbm(x * 0.03, z * 0.03, 3));
      const trees = scatterGrid(rng, ext, 2.2 * cellMul, (x, z) => {
        const h = heightAt(x, z); if (h < level + 1.5 || slopeAt(x, z) > 0.6) return 0;
        return (0.12 + 0.85 * forestN(x, z)) * landingFree(x, z) * smoothstep(level + 1.5, level + 2.4, h);
      });
      lift(trees);
      const palms = scatterGrid(rng, ext, 3.0 * cellMul, (x, z) => {
        const h = heightAt(x, z) - level; if (h < 0.45 || h > 2.3 || slopeAt(x, z) > 0.5) return 0;
        return 0.35 * landingFree(x, z);
      });
      lift(palms);
      const tmat = createFoliageMaterial(timeU, 1.0), pmat = createFoliageMaterial(timeU, 2.2, true);
      addMesh(buildInstanced(makeBroadleafGeo(la, lb, 4), tmat, trees, { sx: [0.8, 1.5], sy: [0.8, 1.7], sink: 0.1, tilt: 0.08, tint: jitter(0.22, 0.25) }));
      addMesh(buildInstanced(makePalmGeo(light(0x4c9a3a, 1.0)), pmat, palms, { sx: [0.9, 1.3], sy: [0.9, 1.5], sink: 0.1, tilt: 0.12, tint: jitter(0.18, 0.2) }));
      boulders(70, (x, z) => { const h = heightAt(x, z) - level; return h > -0.4 && h < 3 ? 0.07 : 0.005; }, [0.4, 1.4], rockTint);
      const pollen = createParticles({ count: 160, box: 120, height: 10, size: 0.7, color: new THREE.Color(0xfff3c0), drift: new THREE.Vector3(0.7, 0.15, 0.4), wobble: 2.0, additive: true, alpha: 0.5, seed: spec.seed });
      group.add(pollen.points); uniformSets.push(pollen.uniforms); disposables.push(pollen);
      break;
    }
    case 'forestRock': {
      const water = createWater({ level, heightTex: terrain.heightTex, span: terrain.span, coverage: terrain.span }, 0x3d8f94, 0x123b4a, spec.sky.skyColor);
      group.add(water.mesh); uniformSets.push(water.uniforms); disposables.push(water);
      const pa = light(0x2f6a3c, 1.0), pb = light(0x3f7a43, 1.0);
      const forestN = (x: number, z: number) => smoothstep(-0.2, 0.3, nz.fbm(x * 0.035, z * 0.035, 3));
      const pines = scatterGrid(rng, ext, 2.1 * cellMul, (x, z) => {
        const h = heightAt(x, z); if (h < level + 0.9 || slopeAt(x, z) > 0.55) return 0;
        return (0.08 + 0.88 * forestN(x, z)) * landingFree(x, z);
      });
      lift(pines);
      addMesh(buildInstanced(makePineGeo(pa, pb), createFoliageMaterial(timeU, 0.7), pines, { sx: [0.75, 1.35], sy: [0.8, 1.9], sink: 0.1, tilt: 0.06, tint: jitter(0.2, 0.15) }));
      boulders(260, (x, z) => 0.06 + Math.min(0.4, slopeAt(x, z) * 0.35), [0.5, 2.0], rockTint, 3);
      spires((x, z) => (slopeAt(x, z) > 0.45 ? 0.35 : 0.01), 40, [0.7, 1.5], [3, 8], rockTint);
      const motes = createParticles({ count: 140, box: 120, height: 12, size: 0.55, color: new THREE.Color(0xe8f2c0), drift: new THREE.Vector3(0.4, 0.1, 0.25), wobble: 2.5, additive: true, alpha: 0.4, seed: spec.seed });
      group.add(motes.points); uniformSets.push(motes.uniforms); disposables.push(motes);
      break;
    }
  }

  const landingSite = new THREE.Vector3(0, heightAt(0, 0), 0);
  let disposed = false;
  const surface: PlanetSurface = {
    spec, group, halfSize: half, landingSite,
    heightAt, isLiquid,
    update(_dt, time) {
      timeU.value = time;
      for (const u of uniformSets) if (u.uTime) u.uTime.value = time;
    },
    dispose() {
      if (disposed) return; disposed = true;
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
  return surface;
};
