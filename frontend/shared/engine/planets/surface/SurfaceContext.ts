import * as THREE from 'three';
import type { PlanetSpec } from '../PlanetSpec';
import { createHeightField, type HeightField } from '../../visuals/terrain/heightfields';
import { createTerrain } from '../../visuals/terrain/TerrainMesh';
import { Noise2, mulberry32, smoothstep } from '../../visuals/terrain/noise';
import {
  scatterGrid, buildInstanced, createRockMaterial, makeBoulderGeo, makeSpireGeo, type Place,
} from '../../visuals/terrain/Scatter';

/** Brightness/hue jitter relative to the geometry's baked vertex colours. */
export const jitter = (amt: number, hueShift = 0) => (r: number, c: THREE.Color) => {
  const k = 1 + (r - 0.5) * 2 * amt;
  c.setRGB(k * (1 + (r - 0.5) * hueShift), k, k * (1 - (r - 0.5) * hueShift));
};

export const light = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k);

type Terrain = ReturnType<typeof createTerrain>;

/** Shared state + scatter helpers that every biome strategy builds on (one per createPlanetSurface call). */
export class SurfaceContext {
  readonly half: number;
  readonly field: HeightField;
  readonly terrain: Terrain;
  readonly heightAt: (x: number, z: number) => number;
  readonly level: number;
  readonly group = new THREE.Group();
  readonly timeU: THREE.IUniform = { value: 0 };
  readonly uniformSets: Record<string, THREE.IUniform>[];
  readonly disposables: { dispose(): void }[];
  readonly palette: PlanetSpec['palette'];
  readonly nz: Noise2;
  readonly rng: () => number;
  readonly ext: number;
  readonly cellMul: number;
  readonly rockMat = createRockMaterial({ rough: 0.92 });
  readonly rockTint: THREE.Color;
  readonly darkTint: THREE.Color;

  constructor(readonly spec: PlanetSpec, opts?: { halfSize?: number; quality?: 'low' | 'high' }) {
    this.half = opts?.halfSize ?? 64;
    const quality = opts?.quality ?? 'high';
    const N = quality === 'high' ? 420 : 240;
    this.cellMul = quality === 'high' ? 1 : 1.4;
    this.field = createHeightField(spec, this.half * 2);
    this.terrain = createTerrain(spec, this.field, this.half, N);
    this.heightAt = this.terrain.heightAt;
    this.level = this.field.liquid?.level ?? -999;

    this.group.name = `surface-${spec.kind}`;
    this.group.add(this.terrain.mesh);
    this.uniformSets = [this.terrain.uniforms];
    this.disposables = [this.terrain];

    this.palette = spec.palette;
    this.nz = new Noise2(spec.seed + 99);
    this.rng = mulberry32(spec.seed * 13 + 5);
    this.ext = this.half * 1.25;
    this.disposables.push({ dispose: () => this.rockMat.dispose() });
    this.rockTint = new THREE.Color(this.palette.rock);
    this.darkTint = new THREE.Color(this.palette.rockDark);
  }

  isLiquid = (x: number, z: number) => !!this.field.liquid && this.heightAt(x, z) < this.level + 0.12;
  slopeAt = (x: number, z: number) => {
    const d = 0.9, h = this.heightAt(x, z), f = this.heightAt;
    return Math.max(Math.abs(f(x + d, z) - h), Math.abs(f(x - d, z) - h), Math.abs(f(x, z + d) - h), Math.abs(f(x, z - d) - h)) / d;
  };
  landingFree = (x: number, z: number) => smoothstep(14, 19, Math.hypot(x, z));
  lift = (arr: Place[]) => arr.forEach((p) => { p.y = this.heightAt(p.x, p.z); });

  addMesh = (m: THREE.InstancedMesh) => {
    this.group.add(m);
    this.disposables.push({ dispose() { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); } });
  };
  /** Add an animated layer (water, particles): scene object + its uniforms (for uTime) + disposable. */
  addLayer(object: THREE.Object3D, uniforms: Record<string, THREE.IUniform>, disposable: { dispose(): void }) {
    this.group.add(object); this.uniformSets.push(uniforms); this.disposables.push(disposable);
  }

  boulders = (count: number, probFn: (x: number, z: number) => number, size: [number, number], tint: THREE.Color, variants = 2, mat: THREE.Material = this.rockMat) => {
    const places = scatterGrid(this.rng, this.ext, 2.0 * this.cellMul, (x, z) => probFn(x, z) * this.landingFree(x, z));
    places.length = Math.min(places.length, count);
    this.lift(places);
    for (let v = 0; v < variants; v++) {
      const sub = places.filter((_, i) => i % variants === v);
      this.addMesh(buildInstanced(makeBoulderGeo(11 + v * 5 + this.spec.seed % 7, tint.clone().lerp(this.darkTint, v * 0.25)), mat, sub, { sx: size, sy: [size[0] * 0.7, size[1] * 0.85], sink: 0.12, tilt: 0.35, tint: jitter(0.28) }));
    }
  };
  spires = (probFn: (x: number, z: number) => number, count: number, w: [number, number], h: [number, number], tint: THREE.Color, mat: THREE.Material = this.rockMat) => {
    const places = scatterGrid(this.rng, this.ext, 3.0 * this.cellMul, (x, z) => probFn(x, z) * this.landingFree(x, z));
    places.length = Math.min(places.length, count);
    this.lift(places);
    this.addMesh(buildInstanced(makeSpireGeo(7 + this.spec.seed % 5, tint), mat, places, { sx: w, sy: h, sink: 0.02, tilt: 0.12, tint: jitter(0.25) }));
  };
}
