import * as THREE from 'three';
import type { PlanetSpec } from '../../planets/PlanetSpec';

interface Tintable { setNebulaTint(c: THREE.Color): void }

/** Nebula colour that eases toward the shown planet's atmosphere (drives the backdrop uniform and the parallax nebula planes). */
export class NebulaTint {
  private readonly tint = new THREE.Color();
  private readonly target = new THREE.Color();

  constructor(spec: PlanetSpec, private readonly nebA: THREE.IUniform<THREE.Color>, private readonly layers: Tintable) {
    nebA.value.copy(this.retarget(spec)); this.tint.copy(nebA.value); layers.setNebulaTint(this.tint);
  }

  retarget(s: PlanetSpec) { return this.target.set(s.orbital.atmosphereColor).lerp(new THREE.Color(0x30408a), 0.55); }

  update(dt: number, morphRate: number) {
    this.tint.lerp(this.target, 1 - Math.exp(-dt * 1.5 * morphRate)); this.layers.setNebulaTint(this.tint);
    this.nebA.value.copy(this.tint);
  }
}
