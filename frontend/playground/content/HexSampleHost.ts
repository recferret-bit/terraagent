import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createHexTerrain, HEX_DEPOSIT, HEX_PREP, HEX_TERRAIN, type HexTerrain, type HexTiles } from '@terra/render/planets/hex';

const RADIUS = 12;
/** Ground classes shown in the six 60° sectors around the flat centre. */
const SECTOR_CLASS = [HEX_TERRAIN.forest, HEX_TERRAIN.rock, HEX_TERRAIN.slope, HEX_TERRAIN.hole, HEX_TERRAIN.shallow, HEX_TERRAIN.deep];
const CLASS_HEIGHT: Record<number, number> = { 0: 0, 1: 0.18, 2: 1.4, 3: 0.7, 4: -0.5, 5: -0.15, 6: -0.6 };
/** Tiles around the pad that re-run the Wild -> Prepared wave every `WAVE_S` seconds. */
const WAVE_S = 3;

/**
 * Sample tiles (cosmetic demo data, no game rules): a flat Prepared pad under the model, one class per sector further
 * out, a few deposits, colony 0 owning radius 5 and colony 1 a wedge next to it (normal and frozen borders).
 */
function sampleTiles(): HexTiles & { wave: number[] } {
  const hx = hexIndex(RADIUS);
  const terrain = new Uint8Array(hx.count), prep = new Uint8Array(hx.count), height = new Float32Array(hx.count);
  const deposit = new Uint8Array(hx.count), owner = new Int8Array(hx.count).fill(-1);
  const wave: number[] = [];
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!, d = hexDistance(0, 0, q, r);
    const sector = Math.floor(((Math.atan2(r * 0.866, q + r / 2) / (Math.PI * 2)) + 1) * 6) % 6;
    const t = d <= 4 ? HEX_TERRAIN.flat : SECTOR_CLASS[sector]!;
    terrain[i] = t;
    height[i] = CLASS_HEIGHT[t]! * (d <= 4 ? 0 : Math.min(1, (d - 3) / 4));
    prep[i] = d <= 2 ? HEX_PREP.prepared : t === HEX_TERRAIN.flat ? HEX_PREP.flat : HEX_PREP.wild;
    if (d === 3 && q >= 0) wave.push(i);
    if (d === 7 && sector % 2 === 0) deposit[i] = [HEX_DEPOSIT.metals, HEX_DEPOSIT.minerals, HEX_DEPOSIT.oil][(sector / 2) | 0]!;
    if (d <= 5) owner[i] = 0;
    else if (d <= 8 && sector === 1) owner[i] = 1;
  }
  return { terrain, prep, height, deposit, owner, wave };
}

/** Optional hex terrain sample scene under the archetypes (`hexterrain=1`): classes, pad wave, borders, hatch. */
export class HexSampleHost {
  private terrain: HexTerrain | null = null;
  private tiles: (HexTiles & { wave: number[] }) | null = null;
  private clock = 0;
  constructor(private scene: THREE.Scene) {}

  /** (Re)build for `kind`; returns true when the sample is now shown. */
  sync(kind: PlanetKind, enabled: boolean, hatch: boolean): boolean {
    if (this.terrain) { this.terrain.dispose(); this.terrain = null; }
    if (!enabled) return false;
    this.tiles = sampleTiles();
    this.terrain = createHexTerrain({ radius: RADIUS, tiles: this.tiles, look: PLANET_SPECS[kind], colorBlindMode: hatch });
    this.terrain.group.position.y = -0.02; // just under the pedestal level so the model stays visible
    this.scene.add(this.terrain.group);
    this.clock = 0;
    return true;
  }

  setHatch(on: boolean) { this.terrain?.setColorBlindMode(on); }

  /** Advances the shader time and replays the Prepared wave on the ring around the pad every few seconds. */
  update(dt: number) {
    const t = this.terrain, tiles = this.tiles;
    if (!t || !tiles) return;
    t.tick(dt);
    const before = Math.floor(this.clock / WAVE_S);
    this.clock += dt;
    if (Math.floor(this.clock / WAVE_S) === before) return;
    const prep = tiles.prep as Uint8Array, on = prep[tiles.wave[0]!] !== HEX_PREP.prepared;
    for (const i of tiles.wave) prep[i] = on ? HEX_PREP.prepared : HEX_PREP.flat;
    t.updateTiles(tiles.wave);
  }
}
