import * as THREE from 'three';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { EntityMeshRecord } from '../EntityMeshRecord';
import { updateGroundSelection } from '../selectionPulse';
import { makeGroundRing } from './entityMarkers';

const UP_AXIS = new THREE.Vector3(0, 1, 0);
const _surfNormal = new THREE.Vector3();

/** Aligns a horizontal ground-plane mesh (`+Y` up) to the local heightfield normal at `(wx, wz)`. */
export function alignGroundRingToTerrain(ring: THREE.Object3D, terrain: HexTerrain | null, wx: number, wz: number): void {
  if (!terrain) {
    ring.quaternion.identity();
    return;
  }
  const eps = 0.45;
  const hX0 = terrain.heightAt(wx - eps, wz);
  const hX1 = terrain.heightAt(wx + eps, wz);
  const hZ0 = terrain.heightAt(wx, wz - eps);
  const hZ1 = terrain.heightAt(wx, wz + eps);
  const dhdx = (hX1 - hX0) / (2 * eps);
  const dhdz = (hZ1 - hZ0) / (2 * eps);
  _surfNormal.set(-dhdx, 1, -dhdz).normalize();
  ring.quaternion.setFromUnitVectors(UP_AXIS, _surfNormal);
}

/**
 * Pool of ground selection rings supporting both single-entity selection (`primaryRing` = `EntityMeshes.selectionRing`)
 * and multi-unit selection across any number of simultaneously selected units.
 */
export class SelectionRingPool {
  private readonly extraRings: THREE.Mesh[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    readonly primaryRing: THREE.Mesh,
  ) {}

  sync(
    selectedIds: ReadonlySet<number>,
    entries: ReadonlyMap<number, EntityMeshRecord>,
    terrain: HexTerrain | null,
    time: number,
  ): void {
    const visibleSelected: EntityMeshRecord[] = [];
    for (const id of selectedIds) {
      const rec = entries.get(id);
      if (rec && rec.mesh.visible) visibleSelected.push(rec);
    }

    if (visibleSelected.length === 0) {
      this.primaryRing.visible = false;
      for (const ring of this.extraRings) ring.visible = false;
      return;
    }

    updateGroundSelection(this.primaryRing, visibleSelected[0], time);
    alignGroundRingToTerrain(
      this.primaryRing,
      terrain,
      visibleSelected[0]!.mesh.position.x,
      visibleSelected[0]!.mesh.position.z,
    );

    const extraNeeded = visibleSelected.length - 1;
    while (this.extraRings.length < extraNeeded) {
      const ring = makeGroundRing(0.75, 0.95, 0xff6a13, `selection-ring-${this.extraRings.length + 1}`);
      this.scene.add(ring);
      this.extraRings.push(ring);
    }

    for (let i = 0; i < this.extraRings.length; i++) {
      const ring = this.extraRings[i]!;
      if (i >= extraNeeded) {
        ring.visible = false;
        continue;
      }
      const rec = visibleSelected[i + 1]!;
      updateGroundSelection(ring, rec, time);
      alignGroundRingToTerrain(ring, terrain, rec.mesh.position.x, rec.mesh.position.z);
    }
  }

  dispose(): void {
    for (const ring of this.extraRings) {
      this.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.extraRings.length = 0;
  }
}
