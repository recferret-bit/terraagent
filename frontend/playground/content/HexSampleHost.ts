import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  createHexTerrain,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  type DepositVisualStage,
  type HexTerrain,
  type HexTiles,
} from '@terra/render/planets/hex';

const RADIUS = 12;
/** Ground classes shown in the six 60° sectors around the flat centre. */
const SECTOR_CLASS = [HEX_TERRAIN.forest, HEX_TERRAIN.rock, HEX_TERRAIN.slope, HEX_TERRAIN.hole, HEX_TERRAIN.shallow, HEX_TERRAIN.deep];
const CLASS_HEIGHT: Record<number, number> = { 0: 0, 1: 0.18, 2: 1.4, 3: 0.7, 4: -0.5, 5: -0.15, 6: -0.6 };
/** Tier sample: three Metals deposits side by side on the flat ring in front of the model (+z, x = -4 / -2 / 0 m),
 * sim `depositTier` 0 (= tier 1) / 2 / 3. */
const TIER_SAMPLE: ReadonlyArray<readonly [q: number, r: number, tier: number]> = [[-4, 4, 0], [-3, 4, 2], [-2, 4, 3]];

function richnessBpForStage(stage: DepositVisualStage): number {
  return stage === 'full' ? 10000 : stage === 'half' ? 3500 : 0;
}

/**
 * Sample tiles (cosmetic demo data, no game rules): flat Prepared ground under the model, one class per sector further
 * out, a few deposits plus a tier 1 / 2 / 3 row (`TIER_SAMPLE`), colony 0 owning radius 5 and colony 1 a wedge next to
 * it (normal and frozen borders).
 */
function sampleTiles(stage: DepositVisualStage = 'full'): HexTiles & { depositTiles: number[] } {
  const hx = hexIndex(RADIUS);
  const terrain = new Uint8Array(hx.count), prep = new Uint8Array(hx.count), height = new Float32Array(hx.count);
  const deposit = new Uint8Array(hx.count), depositTier = new Uint8Array(hx.count), richness = new Uint16Array(hx.count);
  const owner = new Int8Array(hx.count).fill(-1);
  const depositTiles: number[] = [];
  const rBp = richnessBpForStage(stage);
  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!, d = hexDistance(0, 0, q, r);
    const sector = Math.floor(((Math.atan2(r * 0.866, q + r / 2) / (Math.PI * 2)) + 1) * 6) % 6;
    const t = d <= 4 ? HEX_TERRAIN.flat : SECTOR_CLASS[sector]!;
    terrain[i] = t;
    height[i] = CLASS_HEIGHT[t]! * (d <= 4 ? 0 : Math.min(1, (d - 3) / 4));
    prep[i] = d <= 2 ? HEX_PREP.prepared : t === HEX_TERRAIN.flat ? HEX_PREP.flat : HEX_PREP.wild;
    if (d === 7 && sector % 2 === 0) {
      deposit[i] = [HEX_DEPOSIT.metals, HEX_DEPOSIT.minerals, HEX_DEPOSIT.oil][(sector / 2) | 0]!;
      richness[i] = rBp;
      depositTiles.push(i);
    }
    if (d <= 5) owner[i] = 0;
    else if (d <= 8 && sector === 1) owner[i] = 1;
  }
  for (const [q, r, tier] of TIER_SAMPLE) {
    const i = hx.indexOf(q, r);
    deposit[i] = HEX_DEPOSIT.metals;
    depositTier[i] = tier;
    richness[i] = rBp;
    depositTiles.push(i);
  }
  return { terrain, prep, height, deposit, depositTier, richness, owner, depositTiles };
}

/** Optional hex terrain sample scene under the archetypes (`hexterrain=1`): classes, deposit tiers, borders, hatch. */
export class HexSampleHost {
  private terrain: HexTerrain | null = null;
  private tiles: (HexTiles & { depositTiles: number[] }) | null = null;
  private depositStage: DepositVisualStage = 'full';
  constructor(private scene: THREE.Scene) {}

  /** (Re)build for `kind`; returns true when the sample is now shown. */
  sync(kind: PlanetKind, enabled: boolean, hatch: boolean, stage: DepositVisualStage = this.depositStage): boolean {
    this.depositStage = stage;
    if (this.terrain) { this.terrain.dispose(); this.terrain = null; }
    if (!enabled) return false;
    this.tiles = sampleTiles(stage);
    this.terrain = createHexTerrain({ radius: RADIUS, tiles: this.tiles, look: PLANET_SPECS[kind], colorBlindMode: hatch });
    this.terrain.group.position.y = -0.02; // just under the pedestal level so the model stays visible
    this.scene.add(this.terrain.group);
    return true;
  }

  setHatch(on: boolean) { this.terrain?.setColorBlindMode(on); }

  setDepositStage(stage: DepositVisualStage) {
    this.depositStage = stage;
    if (!this.terrain || !this.tiles) return;
    const hx = hexIndex(RADIUS);
    const rBp = richnessBpForStage(stage);
    for (const idx of this.tiles.depositTiles) {
      this.terrain.setTileState(hx.q[idx]!, hx.r[idx]!, undefined, undefined, undefined, undefined, rBp);
    }
  }

  /** Advances the shader time (foliage sway, water ripples). */
  update(dt: number) {
    this.terrain?.tick(dt);
  }
}
