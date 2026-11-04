import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import type { TileStatePreset } from '@terra/render/planets/hex';
import { createPlanetSurface } from '@terra/render/planets/surface';
import type { PlanetSurface } from '@terra/render/planets/surface/types';

function stampSurfaceTerraformMap(tex: THREE.DataTexture, preset: TileStatePreset) {
  const data = tex.image.data as Uint8Array;
  const n = tex.image.width;
  const half = n * 0.5;
  const maxR = n * 0.14;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - half, dz = y + 0.5 - half;
      const dist = Math.hypot(dx, dz);
      const o = (y * n + x) * 4;
      const inside = dist <= maxR;
      data[o] = inside && (preset === 'living' || (preset === 'mixed' && dx <= 0)) ? 255 : 0;
      data[o + 1] = inside && (preset === 'irrigated' || (preset === 'mixed' && dx > 0 && dz >= 0)) ? 255 : 0;
      data[o + 2] = inside && (preset === 'prepared' || (preset === 'mixed' && dx > 0 && dz < 0)) ? 255 : 0;
      data[o + 3] = 255;
    }
  }
  tex.needsUpdate = true;
}

/** Optional full planet-surface patch drawn under the archetypes (`surface=1`). */
export class SurfaceHost {
  private surface: PlanetSurface | null = null;
  private tileState: TileStatePreset = 'prepared';
  constructor(private scene: THREE.Scene) {}

  /** (Re)build for `kind`; returns true when a surface is now shown. */
  sync(kind: PlanetKind, enabled: boolean, tileState: TileStatePreset = this.tileState): boolean {
    this.tileState = tileState;
    if (this.surface) { this.scene.remove(this.surface.group); this.surface.dispose(); this.surface = null; }
    if (!enabled) return false;
    this.surface = createPlanetSurface(PLANET_SPECS[kind], { quality: 'low' });
    this.scene.add(this.surface.group);
    this.surface.group.position.y = -0.02; // just under the pedestal so the object stays visible
    this.setTileState(tileState);
    return true;
  }

  setTileState(preset: TileStatePreset) {
    this.tileState = preset;
    const mesh = this.surface?.group.getObjectByName('terrain');
    const tex = mesh?.userData?.uniforms?.uTerraformMap?.value as THREE.DataTexture | undefined;
    if (tex) stampSurfaceTerraformMap(tex, preset);
  }

  update(dt: number, time: number) { this.surface?.update(dt, time); }
}
