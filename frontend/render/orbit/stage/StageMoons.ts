import * as THREE from 'three';
import type { PlanetSpec } from '../../planets/PlanetSpec';
import { createMoon, moonsFor, type Moon } from '../Moons';

interface MoonSet { moons: Moon[]; group: THREE.Group; k: number }

/** Moons (distinct per planet): the active set grows in, others shrink away; all orbit the planet. */
export class StageMoons {
  private readonly sets = new Map<string, MoonSet>();
  private active: MoonSet;

  constructor(private readonly scene: THREE.Scene, private readonly sunDir: THREE.Vector3, spec: PlanetSpec) {
    this.active = this.setFor(spec); this.active.k = 1;
  }

  private setFor(sp: PlanetSpec): MoonSet {
    let ms = this.sets.get(sp.kind);
    if (!ms) {
      const group = new THREE.Group(); group.name = `Moons:${sp.kind}`;
      const moons = moonsFor(sp.kind).map((d, i) => { const m = createMoon(d, this.sunDir, sp.seed + i * 13); group.add(m.group); return m; });
      this.scene.add(group); ms = { moons, group, k: 0 }; this.sets.set(sp.kind, ms);
    }
    return ms;
  }

  setPlanet(spec: PlanetSpec) { this.active = this.setFor(spec); }

  update(dt: number, time: number, planetPos: THREE.Vector3, morphRate: number) {
    for (const ms of this.sets.values()) {
      const target = ms === this.active ? 1 : 0;
      ms.k += (target - ms.k) * Math.min(1, dt * 2.2 * morphRate);
      ms.group.visible = ms.k > 0.01;
      if (!ms.group.visible) continue;
      ms.group.scale.setScalar(1); // scale is applied per moon below so orbits keep their radius
      for (const m of ms.moons) { m.update(planetPos, time); m.group.scale.setScalar(Math.max(ms.k, 0.001)); }
    }
  }

  dispose() { this.sets.forEach((ms) => ms.moons.forEach((m) => m.dispose())); this.sets.clear(); }
}
