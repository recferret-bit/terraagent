import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { createPlanetSurface } from '@terra/render/planets/surface';
import type { PlanetSurface } from '@terra/render/planets/surface/types';

/** Optional full planet-surface patch drawn under the archetypes (`surface=1`). */
export class SurfaceHost {
  private surface: PlanetSurface | null = null;
  constructor(private scene: THREE.Scene) {}

  /** (Re)build for `kind`; returns true when a surface is now shown. */
  sync(kind: PlanetKind, enabled: boolean): boolean {
    if (this.surface) { this.scene.remove(this.surface.group); this.surface.dispose(); this.surface = null; }
    if (!enabled) return false;
    this.surface = createPlanetSurface(PLANET_SPECS[kind], { quality: 'low' });
    this.scene.add(this.surface.group);
    this.surface.group.position.y = -0.02; // just under the pedestal so the object stays visible
    return true;
  }

  update(dt: number, time: number) { this.surface?.update(dt, time); }
}
