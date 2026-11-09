import * as THREE from 'three';
import { TILE_M } from '@terra/render/planets/hex';
import { MARCH_COUNT, marchWorld } from './marchSetup';

const RING = new THREE.RingGeometry(TILE_M * 0.55, TILE_M * 0.92, 6);
const FLOOR = new THREE.CircleGeometry(18, 48);
const ROCK = new THREE.CylinderGeometry(TILE_M * 0.34, TILE_M * 0.42, 0.7, 6);

/** Ground marks for the ordered hex, each unit's slot, and blocked rock tiles. */
export class MarchMarkers {
  readonly group = new THREE.Group();
  private readonly anchor: THREE.Mesh;
  private readonly slots: THREE.InstancedMesh;
  private readonly rocks: THREE.Mesh[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(parent: THREE.Object3D) {
    this.group.name = 'MarchMarkers';
    const floor = new THREE.Mesh(FLOOR, new THREE.MeshStandardMaterial({ color: 0xb7a48c, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    this.group.add(floor);
    this.anchor = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: 0xff6a13, side: THREE.DoubleSide }));
    this.anchor.rotation.x = -Math.PI / 2;
    this.anchor.position.y = 0.05;
    this.slots = new THREE.InstancedMesh(RING, new THREE.MeshBasicMaterial({ color: 0x4cc9f0, side: THREE.DoubleSide }), MARCH_COUNT);
    this.slots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.anchor, this.slots);
    parent.add(this.group);
  }

  setAnchor(q: number, r: number): void {
    const at = marchWorld(q, r);
    this.anchor.position.x = at.x;
    this.anchor.position.z = at.z;
  }

  setSlots(tiles: ReadonlyArray<{ q: number; r: number }>): void {
    for (let i = 0; i < MARCH_COUNT; i++) {
      const tile = tiles[i];
      this.dummy.position.set(0, -10, 0);
      this.dummy.scale.setScalar(tile ? 1 : 0);
      if (tile) {
        const at = marchWorld(tile.q, tile.r);
        this.dummy.position.set(at.x, 0.06, at.z);
        this.dummy.rotation.set(-Math.PI / 2, 0, 0);
        this.dummy.scale.setScalar(1);
      }
      this.dummy.updateMatrix();
      this.slots.setMatrixAt(i, this.dummy.matrix);
    }
    this.slots.instanceMatrix.needsUpdate = true;
    this.slots.count = Math.min(tiles.length, MARCH_COUNT);
  }

  setRocks(tiles: ReadonlyArray<{ q: number; r: number }>): void {
    for (const mesh of this.rocks) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.rocks.length = 0;
    for (const tile of tiles) {
      const mesh = new THREE.Mesh(ROCK, new THREE.MeshStandardMaterial({ color: 0x8a8178, roughness: 0.82 }));
      const at = marchWorld(tile.q, tile.r);
      mesh.position.set(at.x, 0.35, at.z);
      this.group.add(mesh);
      this.rocks.push(mesh);
    }
  }

  dispose(): void {
    this.setRocks([]);
    this.group.remove(this.anchor, this.slots);
    (this.anchor.material as THREE.Material).dispose();
    (this.slots.material as THREE.Material).dispose();
    this.slots.dispose();
  }
}
