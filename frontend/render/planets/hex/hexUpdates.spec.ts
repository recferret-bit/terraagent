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
  PREP_BLEND_DURATION_S,
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
const SURFACE_ATTRS = ['position', 'normal', 'color', 'aAO', 'aRock', 'aPrepTarget', 'aPrepStartTime'] as const;

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

/** Asserts the chunk surfaces of two terrains are identical, attribute by attribute. */
function expectSameSurfaces(a: HexTerrain, b: HexTerrain): void {
  const ma = chunkByName(a), mb = chunkByName(b);
  expect([...ma.keys()].sort()).toEqual([...mb.keys()].sort());
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
    const pine = terrain.props.meshes.pine;
    const waterGeo = terrain.water.mesh.geometry;
    const borderGeo = terrain.borderMesh.geometry;

    (tiles.owner as Int8Array)[hx.indexOf(0, 0)] = 0;
    terrain.updateTiles({ ...tiles }, []);
    expect(terrain.chunks).toEqual(chunksBefore);
    expect(terrain.props.meshes.pine).toBe(pine);
    expect(terrain.water.mesh.geometry).toBe(waterGeo);
    expect(terrain.borderMesh.geometry).not.toBe(borderGeo);
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(1);

    (tiles.owner as Int8Array)[hx.indexOf(1, 0)] = 0;
    terrain.refreshBorders();
    expect(terrain.getTerritoryBorderStats().ownedTileCount).toBe(2);
    expect(terrain.water.mesh.geometry).toBe(waterGeo);
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
    const waterGeo = terrain.water.mesh.geometry;
    const boulder = terrain.props.meshes.boulder;
    const pine = terrain.props.meshes.pine;

    const dry = hx.indexOf(-5, 0);
    (tiles.terrain as Uint8Array)[dry] = HEX_TERRAIN.forest;
    terrain.updateTiles([dry]);
    expect(terrain.water.mesh.geometry).toBe(waterGeo);
    expect(terrain.props.meshes.pine).not.toBe(pine); // the new forest grew trees
    expect(terrain.props.meshes.boulder).toBe(boulder); // no boulder moved

    const wet = hx.indexOf(4, 3);
    (tiles.terrain as Uint8Array)[wet] = HEX_TERRAIN.deep;
    terrain.updateTiles([wet]);
    expect(terrain.water.mesh.geometry).not.toBe(waterGeo);
    expect(terrain.water.waterTileCount).toBe(2);
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

describe('RN-09: a pad prepared during play matches a reload once its blend is over', () => {
  it('rebuilds the tile with the pad style after the 0.4 s blend', () => {
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
    (tiles.prep as Uint8Array)[hx.indexOf(1, 0)] = HEX_PREP.prepared;
    terrain.updateTiles([hx.indexOf(1, 0)]);
    const reloaded = createHexTerrain({ radius, tiles: { ...tiles, prep: Uint8Array.from(tiles.prep!) }, look });

    const def = chunkLayout(radius).find((d) => d.cq === 0 && d.cr === 0)!;
    const v = Array.from(buildChunk(radius, def.tiles, tiles).vertexTile).indexOf(hx.indexOf(1, 0)); // vertex order
    expect(v).toBeGreaterThanOrEqual(0);
    const aoOf = (t: HexTerrain) => chunkByName(t).get('hexChunk 0,0')!.geometry.getAttribute('aAO').getX(v);
    expect(aoOf(terrain)).toBe(1); // mid-blend: old ground style under the shader wave
    expect(aoOf(reloaded)).toBeCloseTo(0.96, 6);
    terrain.tick(0.2);
    expect(aoOf(terrain)).toBe(1);
    terrain.tick(0.25);
    expect(terrain.getTilePrepBlend(1, 0)).toBe(1);
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

describe('RN-10 / RN-12: hex shader constants and pad cost', () => {
  const realSources = () => ({
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }) as unknown as THREE.WebGLProgramParametersWithUniforms;

  it('patches three\'s real standard shader with literals built from the TS constants', () => {
    const terrain = createHexTerrain({ radius: 4, tiles: slopeTiles(4), look });
    const sh = realSources();
    terrain.material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.vertexShader).toContain(`/ ${PREP_BLEND_DURATION_S}, 0.0, 1.0);`);
    expect(sh.fragmentShader).toContain(`vec2 tp = vLP.xz / ${TILE_M.toFixed(1)};`);
    expect(sh.fragmentShader).toContain('vec3 evalFoundationPad(');
    expect(sh.fragmentShader.indexOf('uniform sampler2D uPadMap')).toBeLessThan(sh.fragmentShader.indexOf('vec3 evalFoundationPad('));
    terrain.dispose();
  });

  it('throws instead of compiling a half-patched shader when a marker is gone', () => {
    const terrain = createHexTerrain({ radius: 4, tiles: slopeTiles(4), look });
    const sh = realSources();
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '');
    expect(() => terrain.material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer)).toThrow(/begin_vertex/);
    terrain.dispose();
  });

  it('only the hex material carries the pad textures and GLSL; plain terrain does not pay for them', () => {
    const uniforms = terrainUniforms(look, 0, 100, [1, 0]);
    expect(uniforms.uPadMap).toBeUndefined();
    const sh = realSources();
    createTerrainMaterial(uniforms).onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.fragmentShader).not.toContain('evalFoundationPad');
    expect(sh.fragmentShader).not.toContain('uPadMap');
  });
});
