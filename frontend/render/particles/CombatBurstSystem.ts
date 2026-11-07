import * as THREE from 'three';
import { ParticlePresetRegistry } from './ParticlePresetRegistry';
import { BurstLayer, type BurstOrigin } from './BurstLayer';
import { shotRandom } from '../combat/shotContact';

/** Finite effects compose the same registered, validated layer specs as work particles. */
export class CombatBurstSystem {
  private readonly pools = new Map<string, BurstLayer[]>();
  private sequence = 0;
  constructor(private readonly parent: THREE.Object3D) {}

  emit(id: string, origin: BurstOrigin): void {
    let layers = this.pools.get(id);
    if (!layers) {
      const preset = ParticlePresetRegistry.get(id);
      if (!preset || preset.targetKind !== 'combat') throw new Error(`Unknown combat burst: ${id}`);
      layers = preset.layers.map(layer => new BurstLayer(layer, this.parent, id));
      this.pools.set(id, layers);
    }
    const random = shotRandom(`${id}:${this.sequence++}`);
    for (const layer of layers) layer.emit(origin, random);
  }
  update(dt: number): void { for (const layers of this.pools.values()) for (const layer of layers) layer.update(dt); }
  counts(): Record<string, number> {
    return Object.fromEntries([...this.pools].map(([id, layers]) => [id, layers.reduce((n, layer) => n + layer.count, 0)]));
  }
  clear(): void { for (const layers of this.pools.values()) for (const layer of layers) layer.clear(); }
  dispose(): void { for (const layers of this.pools.values()) for (const layer of layers) layer.dispose(); this.pools.clear(); }
}
