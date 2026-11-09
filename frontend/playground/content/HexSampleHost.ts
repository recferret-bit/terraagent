import * as THREE from 'three';
import { hexIndex } from '@terra/sim/grid/hex';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  applyTileStatePreset,
  createHexTerrain,
  HEX_PREP,
  HEX_TERRAIN,
  type DepositVisualStage,
  type HexTerrain,
  type HexTiles,
  type TileStatePreset,
} from '@terra/render/planets/hex';

const RADIUS = 12;

function richnessBpForStage(stage: DepositVisualStage): number {
  return stage === 'full' ? 10000 : stage === 'half' ? 3500 : 0;
}

/** Flat prepared ground: height 0, no deposits, no owners. `tileState` preset applies to the central radius. */
function sampleTiles(_stage: DepositVisualStage = 'full', tileState: TileStatePreset = 'prepared'): HexTiles & { depositTiles: number[] } {
  const hx = hexIndex(RADIUS);
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(hx.count).fill(HEX_PREP.prepared);
  const height = new Float32Array(hx.count);
  const deposit = new Uint8Array(hx.count);
  const depositTier = new Uint8Array(hx.count);
  const richness = new Uint16Array(hx.count);
  const owner = new Int8Array(hx.count).fill(-1);
  applyTileStatePreset(RADIUS, prep, terrain, tileState, 4);
  return { terrain, prep, height, deposit, depositTier, richness, owner, depositTiles: [] };
}

/** Optional hex terrain sample (`hexterrain=1`): flat prepared ground, no deposits, no owners, no hatch. */
export class HexSampleHost {
  private terrain: HexTerrain | null = null;
  private tiles: (HexTiles & { depositTiles: number[] }) | null = null;
  private depositStage: DepositVisualStage = 'full';
  private tileState: TileStatePreset = 'prepared';
  constructor(private scene: THREE.Scene) {}

  get hexTerrain(): HexTerrain | null { return this.terrain; }
  get sampleTiles(): HexTiles | null { return this.tiles; }

  /** (Re)build for `kind`; returns true when the sample is now shown. */
  sync(
    kind: PlanetKind,
    enabled: boolean,
    _hatch: boolean,
    stage: DepositVisualStage = this.depositStage,
    tileState: TileStatePreset = this.tileState,
  ): boolean {
    this.depositStage = stage;
    this.tileState = tileState;
    if (this.terrain) { this.terrain.dispose(); this.terrain = null; }
    if (!enabled) return false;
    this.tiles = sampleTiles(stage, tileState);
    this.terrain = createHexTerrain({ radius: RADIUS, tiles: this.tiles, look: PLANET_SPECS[kind], colorBlindMode: false });
    this.terrain.group.position.y = -0.02; // just under the pedestal level so the model stays visible
    this.scene.add(this.terrain.group);
    return true;
  }

  setHatch(_on: boolean) { this.terrain?.setColorBlindMode(false); }

  setDepositStage(stage: DepositVisualStage) {
    this.depositStage = stage;
    if (!this.terrain || !this.tiles || this.tiles.depositTiles.length === 0) return;
    const hx = hexIndex(RADIUS);
    const rBp = richnessBpForStage(stage);
    for (const idx of this.tiles.depositTiles) {
      this.terrain.setTileState(hx.q[idx]!, hx.r[idx]!, undefined, undefined, undefined, undefined, rBp);
    }
  }

  setTileState(preset: TileStatePreset) {
    this.tileState = preset;
    if (!this.terrain || !this.tiles) return;
    const changed = applyTileStatePreset(RADIUS, this.tiles.prep as Uint8Array, this.tiles.terrain, preset, 4);
    if (changed.length > 0) this.terrain.updateTiles(this.tiles, changed);
  }

  /** Advances the shader time (foliage sway, water ripples). */
  update(dt: number) {
    this.terrain?.tick(dt);
  }
}
