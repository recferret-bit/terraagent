import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { HEX_TERRAIN, specForPlanetType, tileXZ } from './index';
import { createHexWater } from './hexWater';
import { WATERFALL_RENDER_ORDER } from './waterfallMaterial';

const RADIUS = 40;
const hx = hexIndex(RADIUS);

function oceanTiles() {
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.deep);
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    if (r === 0 || Math.hypot(q - 10, r - 10) < 4) terrain[i] = HEX_TERRAIN.flat;
    else if (Math.abs(r) < 3) terrain[i] = HEX_TERRAIN.shallow;
  }
  return { terrain, height: new Float32Array(hx.count) };
}

describe('Hex perimeter & corner waterfalls', () => {
  it('spawns 3D cascade & mist geometry around ground hexagon corners and edges when water touches the rim', () => {
    const tiles = oceanTiles();
    const water = createHexWater(RADIUS, specForPlanetType('ocean'), tiles);
    const expectedRimWater = Array.from(
      tiles.terrain,
      (t, i) => (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep) && hexDistance(0, 0, hx.q[i]!, hx.r[i]!) === RADIUS,
    ).filter(Boolean).length;
    expect(expectedRimWater).toBeGreaterThan(0);
    expect(water.waterfalls.waterfallTileCount).toBe(expectedRimWater);
    expect(water.waterfalls.group.visible).toBe(true);
    expect(water.waterfalls.meshes.length).toBeGreaterThan(0);
    expect(water.waterfalls.triangleCount).toBeGreaterThan(0);

    let minY = Infinity;
    let hasCornerBisectorNormal = false;
    for (const m of water.waterfalls.meshes) {
      expect(m.renderOrder).toBe(WATERFALL_RENDER_ORDER);
      expect(m.geometry.getAttribute('aFlowUV')).toBeDefined();
      expect(m.geometry.getAttribute('aWaterfallMeta')).toBeDefined();
      const pos = m.geometry.getAttribute('position');
      const nor = m.geometry.getAttribute('normal');
      for (let v = 0; v < pos.count; v++) {
        minY = Math.min(minY, pos.getY(v));
        const nx = nor.getX(v);
        const nz = nor.getZ(v);
        const hl = Math.hypot(nx, nz);
        if (hl > 0.5 && Math.abs(nx / hl - 0.5) < 0.05 && Math.abs(nz / hl - Math.sqrt(3) / 2) < 0.05) {
          hasCornerBisectorNormal = true;
        }
      }
    }
    expect(minY).toBeLessThan(-3.0);
    expect(hasCornerBisectorNormal).toBe(true);
    water.dispose();
  });

  it('produces zero waterfall meshes when water only lies on interior tiles', () => {
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    for (let i = 0; i < hx.count; i++) {
      if (hexDistance(0, 0, hx.q[i]!, hx.r[i]!) <= 3) terrain[i] = HEX_TERRAIN.deep;
    }
    const water = createHexWater(RADIUS, specForPlanetType('ocean'), { terrain, height: new Float32Array(hx.count) });
    expect(water.waterTileCount).toBeGreaterThan(0);
    expect(water.waterfalls.waterfallTileCount).toBe(0);
    expect(water.waterfalls.triangleCount).toBe(0);
    expect(water.waterfalls.meshes).toHaveLength(0);
    expect(water.waterfalls.group.visible).toBe(false);
    water.dispose();
  });
});

describe('Hex waterfall dynamic updates & shader patching', () => {
  it('dynamically spawns and removes corner waterfalls on rim changes while ignoring interior water changes', () => {
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    terrain[hx.indexOf(0, 0)] = HEX_TERRAIN.shallow;
    const tiles = { terrain, height: new Float32Array(hx.count) };
    const water = createHexWater(RADIUS, specForPlanetType('ocean'), tiles);
    expect(water.waterfalls.meshes).toHaveLength(0);

    const cornerIdx = hx.indexOf(RADIUS, 0);
    tiles.terrain[cornerIdx] = HEX_TERRAIN.deep;
    water.update(tiles, [cornerIdx]);
    expect(water.waterfalls.waterfallTileCount).toBe(1);
    expect(water.waterfalls.meshes.length).toBeGreaterThan(0);
    const meshesAfterCorner = [...water.waterfalls.meshes];
    const geosAfterCorner = meshesAfterCorner.map((m) => m.geometry);
    const [cx] = tileXZ(RADIUS, 0);
    let maxX = -Infinity;
    for (const m of meshesAfterCorner) {
      const pos = m.geometry.getAttribute('position');
      for (let v = 0; v < pos.count; v++) maxX = Math.max(maxX, pos.getX(v));
    }
    expect(maxX).toBeGreaterThan(cx);

    const interiorIdx = hx.indexOf(1, 0);
    tiles.terrain[interiorIdx] = HEX_TERRAIN.deep;
    water.update(tiles, [interiorIdx]);
    expect(water.waterfalls.meshes).toEqual(meshesAfterCorner);
    water.waterfalls.meshes.forEach((m, k) => expect(m.geometry).toBe(geosAfterCorner[k]));

    tiles.terrain[cornerIdx] = HEX_TERRAIN.flat;
    water.update(tiles, [cornerIdx]);
    expect(water.waterfalls.waterfallTileCount).toBe(0);
    expect(water.waterfalls.meshes).toHaveLength(0);
    water.dispose();
  });

  it('patches standard shader cleanly with waterfall attributes, swell, projectors, and FoV shroud', () => {
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.deep);
    const water = createHexWater(RADIUS, specForPlanetType('ocean'), { terrain, height: new Float32Array(hx.count) });
    const mat = water.waterfalls.meshes[0]!.material as THREE.MeshStandardMaterial;
    const sh = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(sh.vertexShader).toContain('attribute vec2 aFlowUV;');
    expect(sh.vertexShader).toContain('attribute vec3 aWaterfallMeta;');
    expect(sh.vertexShader).toContain('waterSwellHeight(');
    expect(sh.fragmentShader).toContain('colonyProjectorLighting(');
    expect(sh.fragmentShader).toContain('applyColonyFovShroud(');
    water.dispose();
  });
});
