import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { createTerrainMaterial, terrainUniforms } from '../../visuals/terrain/terrainMaterial';
import {
  BORDER_Y_OFFSET,
  buildChunk,
  buildTerritoryBorderGeometry,
  computeEffectiveHeights,
  createHexTerrain,
  HEX_PREP,
  HEX_TERRAIN,
  scatterTileProps,
  specForPlanetType,
  tileHash01,
  type HexTerrain,
  type HexTiles,
} from './index';
import { chunkLayout } from './chunks';
import { makeHeightSampler } from './heightSampler';
import { TILE_M, tileXZ } from './hexMath';

const look = specForPlanetType('temperate');
const SURFACE_ATTRS = ['position', 'normal', 'aAO', 'aRock', 'aHexFlat', 'aHexShore'] as const;
const tintData = (t: HexTerrain) => Array.from((t.uniforms.uTileTint!.value as THREE.DataTexture).image.data as Uint8Array);

/** Every tile a Slope with hashed relief, so a height change spreads through slope easing and normals. */
function slopeTiles(radius: number): HexTiles {
  const hx = hexIndex(radius);
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.slope);
  const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
  const height = new Float32Array(hx.count);
  for (let i = 0; i < hx.count; i++) height[i] = 0.4 + 1.6 * tileHash01(hx.q[i]!, hx.r[i]!, 5);
  return { terrain, prep, height, deposit: new Uint8Array(hx.count), owner: new Int8Array(hx.count).fill(-1) };
}

const copyTiles = (t: HexTiles): HexTiles => ({
  terrain: Uint8Array.from(t.terrain),
  prep: Uint8Array.from(t.prep!),
  height: Float32Array.from(t.height),
  deposit: Uint8Array.from(t.deposit!),
  owner: Int8Array.from(t.owner!),
});

const chunkByName = (t: HexTerrain) => new Map(t.chunks.map((m) => [m.name, m]));
const waterGeos = (t: HexTerrain) => t.water.buckets.map((m) => m.geometry);
const sameGeos = (a: readonly THREE.BufferGeometry[], b: readonly THREE.BufferGeometry[]) => a.length === b.length && a.every((g, i) => g === b[i]);

/** Asserts the chunk surfaces of two terrains are identical, attribute by attribute. */
function expectSameSurfaces(a: HexTerrain, b: HexTerrain): void {
  const ma = chunkByName(a), mb = chunkByName(b);
  expect([...ma.keys()].sort()).toEqual([...mb.keys()].sort());
  expect(tintData(a), 'per-cell class tint').toEqual(tintData(b));
  for (const [name, mesh] of ma) {
    const other = mb.get(name)!;
    for (const attr of SURFACE_ATTRS) {
      expect(Array.from(mesh.geometry.getAttribute(attr).array as Float32Array), `${name} ${attr}`).toEqual(
        Array.from(other.geometry.getAttribute(attr).array as Float32Array),
      );
    }
  }
}

describe('RN-03 / RN-07: incremental updates', () => {
  it('an incremental update gives the same chunk buffers as a full rebuild, also across a chunk seam (RN-07)', () => {
    const radius = 40;
    const hx = hexIndex(radius);
    const tiles = slopeTiles(radius);
    const terrain = createHexTerrain({ radius, tiles, look });
    // (2, 10) sits two tiles inside chunk (0,0); tile (0,10) three steps away is a border vertex of chunk (-1,0).
    const x = hx.indexOf(2, 10);
    (tiles.height as Float32Array)[x] = tiles.height[x]! + 1.5;
    (tiles.height as Float32Array)[hx.indexOf(5, 12)] = 0.1;
    terrain.updateTiles([x, hx.indexOf(5, 12)]);

    const fresh = createHexTerrain({ radius, tiles: copyTiles(tiles), look });
    expectSameSurfaces(terrain, fresh);
    terrain.dispose();
    fresh.dispose();
  });

  it('buildChunk with the precomputed planet heights equals buildChunk computing them itself', () => {
    const radius = 12;
    const tiles = slopeTiles(radius);
    const def = chunkLayout(radius)[0]!;
    const own = buildChunk(radius, def.tiles, tiles);
    const shared = buildChunk(radius, def.tiles, tiles, undefined, computeEffectiveHeights(radius, tiles));
    expect(Array.from(shared.position)).toEqual(Array.from(own.position));
    expect(Array.from(shared.normal)).toEqual(Array.from(own.normal));
  });

  it('a borders-only update rebuilds neither chunks, props nor water', () => {
    const radius = 10;
    const hx = hexIndex(radius);
    const tiles = slopeTiles(radius);
    (tiles.terrain as Uint8Array)[hx.indexOf(3, 3)] = HEX_TERRAIN.shallow;
    (tiles.terrain as Uint8Array)[hx.indexOf(-2, 1)] = HEX_TERRAIN.forest;
    const terrain = createHexTerrain({ radius, tiles, look });
    const chunksBefore = [...terrain.chunks];
    const pine = [...terrain.props.meshes.pine];
    expect(pine.length).toBeGreaterThan(0);
    const waterGeo = waterGeos(terrain);
    const borderGeo = terrain.borderMesh.geometry;

    (tiles.owner as Int8Array)[hx.indexOf(0, 0)] = 0;
    terrain.updateTiles({ ...tiles }, []);
    expect(terrain.chunks).toEqual(chunksBefore);
    expect(terrain.props.meshes.pine).toEqual(pine);
    terrain.props.meshes.pine.forEach((m, i) => expect(m).toBe(pine[i]));
    expect(sameGeos(waterGeos(terrain), waterGeo)).toBe(true);
    expect(terrain.borderMesh.geometry).not.toBe(borderGeo);
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(1);

    (tiles.owner as Int8Array)[hx.indexOf(1, 0)] = 0;
    terrain.refreshBorders();
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(2);
    expect(sameGeos(waterGeos(terrain), waterGeo)).toBe(true);
    terrain.dispose();
  });

  it('a delta on dry ground keeps the water and the untouched prop kinds; a water delta rebuilds the water', () => {
    const radius = 10;
    const hx = hexIndex(radius);
    const tiles = slopeTiles(radius);
    (tiles.terrain as Uint8Array)[hx.indexOf(3, 3)] = HEX_TERRAIN.shallow;
    const rockTile = hx.indexOf(-3, 2);
    (tiles.terrain as Uint8Array)[rockTile] = HEX_TERRAIN.rock;
    const terrain = createHexTerrain({ radius, tiles, look });
    const waterGeo = waterGeos(terrain);
    const boulder = [...terrain.props.meshes.boulder];
    const pine = [...terrain.props.meshes.pine];

    const dry = hx.indexOf(-5, 0);
    (tiles.terrain as Uint8Array)[dry] = HEX_TERRAIN.forest;
    terrain.updateTiles([dry]);
    expect(sameGeos(waterGeos(terrain), waterGeo)).toBe(true);
    expect(terrain.props.meshes.pine).not.toEqual(pine); // the new forest grew trees
    expect(terrain.props.meshes.boulder).toHaveLength(boulder.length); // no boulder moved
    terrain.props.meshes.boulder.forEach((m, i) => expect(m).toBe(boulder[i]));

    const wet = hx.indexOf(4, 3);
    (tiles.terrain as Uint8Array)[wet] = HEX_TERRAIN.deep;
    terrain.updateTiles([wet]);
    expect(sameGeos(waterGeos(terrain), waterGeo)).toBe(false);
    expect(terrain.water.waterTileCount).toBe(2);
    terrain.dispose();
  });
});

describe('deposit tier delta', () => {
  it('a depositTier-only change re-scatters the deposit nodes (tier 3 = 5 nodes) without touching the tint', () => {
    const radius = 6;
    const hx = hexIndex(radius);
    const tiles: HexTiles = {
      terrain: new Uint8Array(hx.count).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(hx.count).fill(HEX_PREP.flat),
      height: new Float32Array(hx.count),
      deposit: new Uint8Array(hx.count),
    };
    const i = hx.indexOf(1, 1);
    (tiles.deposit as Uint8Array)[i] = 1; // metals
    const terrain = createHexTerrain({ radius, tiles, look });
    const tintBefore = tintData(terrain);
    expect(terrain.props.counts().metals).toBe(3);
    terrain.updateTiles({ ...tiles, depositTier: Uint8Array.from({ length: hx.count }, (_, k) => (k === i ? 3 : 0)) }, [i]);
    expect(terrain.props.counts().metals).toBe(5);
    expect(tintData(terrain)).toEqual(tintBefore);
    terrain.dispose();
  });
});

describe('RN-04: foliage sway', () => {
  it('tick advances the prop foliage time uniform with the terrain time', () => {
    const terrain = createHexTerrain({ radius: 6, tiles: slopeTiles(6), look });
    terrain.tick(0.25);
    terrain.tick(0.5);
    expect(terrain.props.timeU.value).toBe(0.75);
    expect(terrain.uniforms.uTime!.value).toBe(0.75);
    terrain.dispose();
  });
});

describe('RN-02: props sit on the surface under each prop', () => {
  it('every instance takes the height at its own (x, z), not the tile centre', () => {
    const ramp = (x: number, z: number) => 0.5 * x + 0.25 * z;
    const props = scatterTileProps(3, -1, 0, HEX_TERRAIN.rock, HEX_PREP.wild, 0, ramp);
    expect(props.length).toBeGreaterThanOrEqual(2);
    const [cx, cz] = tileXZ(3, -1);
    for (const p of props) {
      expect(p.y).toBe(ramp(p.x, p.z));
      expect(p.y).not.toBe(ramp(cx, cz));
    }
  });
});

describe('RN-05: one cleared-ground rule for height, water and props', () => {
  it('a Shallow tile with prep `flat` keeps its water (it is not cleared ground)', () => {
    const radius = 6;
    const hx = hexIndex(radius);
    const tiles = slopeTiles(radius);
    const i = hx.indexOf(1, 1);
    (tiles.terrain as Uint8Array)[i] = HEX_TERRAIN.shallow;
    (tiles.prep as Uint8Array)[i] = HEX_PREP.flat;
    (tiles.height as Float32Array)[i] = -0.2;
    const terrain = createHexTerrain({ radius, tiles, look: specForPlanetType('ocean') });
    expect(terrain.water.waterTileCount).toBe(1);
    expect(computeEffectiveHeights(radius, tiles)[i]).toBeLessThan(0);
    terrain.dispose();
  });

  it('an irrigated or living Slope tile stays level like a prepared one (no easing towards neighbours)', () => {
    const radius = 4;
    const hx = hexIndex(radius);
    const tiles = slopeTiles(radius);
    const i = hx.indexOf(0, 0);
    (tiles.height as Float32Array)[i] = 1.0;
    const levelled = (p: number) => {
      (tiles.prep as Uint8Array)[i] = p;
      return computeEffectiveHeights(radius, tiles)[i];
    };
    const prepared = levelled(HEX_PREP.prepared);
    expect(prepared).toBeCloseTo(1.0, 6);
    expect(levelled(HEX_PREP.irrigated)).toBe(prepared);
    expect(levelled(HEX_PREP.living)).toBe(prepared);
    expect(levelled(HEX_PREP.wild)).not.toBeCloseTo(1.0, 3);
  });
});

describe('RN-09: a tile prepared during play matches a reload', () => {
  it('rebuilds the tile as plain flat ground at once (no pad, no blend)', () => {
    const radius = 6;
    const hx = hexIndex(radius);
    const count = hexCount(radius);
    const tiles: HexTiles = {
      terrain: new Uint8Array(count).fill(HEX_TERRAIN.flat),
      prep: new Uint8Array(count).fill(HEX_PREP.flat),
      height: new Float32Array(count),
    };
    const terrain = createHexTerrain({ radius, tiles, look });
    terrain.tick(1);
    (tiles.terrain as Uint8Array)[hx.indexOf(1, 0)] = HEX_TERRAIN.rock;
    terrain.updateTiles([hx.indexOf(1, 0)]);
    (tiles.prep as Uint8Array)[hx.indexOf(1, 0)] = HEX_PREP.prepared;
    terrain.updateTiles([hx.indexOf(1, 0)]);
    const reloaded = createHexTerrain({ radius, tiles: { ...tiles, prep: Uint8Array.from(tiles.prep!) }, look });

    const def = chunkLayout(radius).find((d) => d.cq === 0 && d.cr === 0)!;
    const v = Array.from(buildChunk(radius, def.tiles, tiles).vertexTile).indexOf(hx.indexOf(1, 0)); // vertex order
    expect(v).toBeGreaterThanOrEqual(0);
    const aoOf = (t: HexTerrain) => chunkByName(t).get('hexChunk 0,0')!.geometry.getAttribute('aAO').getX(v);
    expect(aoOf(terrain)).toBe(1); // flat-ground AO, the same as a reload
    expect(aoOf(reloaded)).toBe(1);
    expectSameSurfaces(terrain, reloaded);
    terrain.dispose();
    reloaded.dispose();
  });
});

describe('RN-01: territory border follows the relief', () => {
  it('every ribbon and hatch vertex sits a fixed lift above the surface under it', () => {
    const radius = 6;
    const hx = hexIndex(radius);
    const effHeights = new Float32Array(hx.count);
    const owner = new Int8Array(hx.count).fill(-1);
    for (let i = 0; i < hx.count; i++) {
      effHeights[i] = hx.q[i]! > 0 ? 1.2 : hx.r[i]! > 1 ? -0.4 : 0; // a 1.2 m step and a 0.4 m drop
      if (Math.max(Math.abs(hx.q[i]!), Math.abs(hx.r[i]!), Math.abs(hx.q[i]! + hx.r[i]!)) <= 1) owner[i] = 0;
    }
    const heightAt = makeHeightSampler(radius, () => effHeights);
    const { geometry } = buildTerritoryBorderGeometry(radius, { height: effHeights, owner }, { effHeights, colorBlindMode: true });
    const pos = geometry.getAttribute('position');
    let offOwnHeight = 0;
    for (let v = 0; v < pos.count; v++) {
      const lift = pos.getY(v) - heightAt(pos.getX(v), pos.getZ(v));
      expect([BORDER_Y_OFFSET, BORDER_Y_OFFSET + 0.002].some((l) => Math.abs(lift - l) < 1e-5), `vertex ${v} lift ${lift}`).toBe(true);
      if (Math.abs(pos.getY(v) - BORDER_Y_OFFSET) > 0.05 && Math.abs(pos.getY(v) - 0.002 - BORDER_Y_OFFSET) > 0.05) offOwnHeight++;
    }
    expect(offOwnHeight).toBeGreaterThan(0); // the step is actually exercised (the owned centre tiles sit at 0)
    geometry.dispose();
  });
});

describe('RN-10: hex shader constants', () => {
  const realSources = () => ({
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }) as unknown as THREE.WebGLProgramParametersWithUniforms;

  it('patches three\'s real standard shader with literals built from the TS constants', () => {
    const terrain = createHexTerrain({ radius: 4, tiles: slopeTiles(4), look });
    const sh = realSources();
    terrain.material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.vertexShader).toContain(`vFlatPos = aHexFlat * (position.xz / ${TILE_M.toFixed(1)});`);
    expect(sh.fragmentShader).toContain(`vec2 tp = vLP.xz / ${TILE_M.toFixed(1)};`);
    expect(sh.fragmentShader.indexOf('uniform sampler2D uTileTint')).toBeLessThan(sh.fragmentShader.indexOf('vec4 hexTileTint('));
    // The hex water gate must be defined before the terrain chunk's `#ifndef` default, or GLSL sees a redefinition.
    expect(sh.fragmentShader.indexOf('#define TA_WATER_GATE smoothstep')).toBeGreaterThan(-1);
    expect(sh.fragmentShader.indexOf('#define TA_WATER_GATE smoothstep')).toBeLessThan(sh.fragmentShader.indexOf('#ifndef TA_WATER_GATE'));
    terrain.dispose();
  });

  it('throws instead of compiling a half-patched shader when a marker is gone', () => {
    const terrain = createHexTerrain({ radius: 4, tiles: slopeTiles(4), look });
    const sh = realSources();
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '');
    expect(() => terrain.material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer)).toThrow(/begin_vertex/);
    terrain.dispose();
  });

  it('only the hex material carries the per-cell tint; plain heightfield terrain keeps its above-water shore band', () => {
    const uniforms = terrainUniforms(look, 0, 100, [1, 0]);
    expect(uniforms.uTileTint).toBeUndefined();
    const sh = realSources();
    createTerrainMaterial(uniforms).onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.fragmentShader).not.toContain('hexTileTint');
    expect(sh.fragmentShader).toContain('#define TA_WATER_GATE 1.0');
    expect(sh.fragmentShader).not.toContain('vHexShore');
  });

  it('the hex and plain terrain materials never share a compiled program (distinct program cache keys)', () => {
    const plain = createTerrainMaterial(terrainUniforms(look, 0, 100, [1, 0]));
    const terrain = createHexTerrain({ radius: 4, tiles: slopeTiles(4), look });
    expect(terrain.material.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    terrain.dispose();
    plain.dispose();
  });
});
