import * as THREE from 'three';
import { resetCompactedBucket } from '../planets/hex/propFocusCompaction';
import { writeInstancedPlaces, type InstOpts, type Place } from '../visuals/terrain/Scatter';
import { PooledObject } from './PooledObject';

/**
 * Pooled `THREE.InstancedMesh` spatial cell bucket used by `TreesOrchestrator`,
 * `GroundObjectsOrchestrator`, and `ResourcesOrchestrator`.
 *
 * Keeps GPU instance buffers pre-allocated inside the parent group and updates `count` + matrices
 * in-place on tile edits instead of repeatedly constructing and disposing `InstancedMesh` objects.
 */
export class PooledInstancedBucket<TPlace extends Place = Place> extends PooledObject {
  private _mesh: THREE.InstancedMesh;
  private _capacity: number;
  cellKey = '';
  placed: TPlace[] = [];

  constructor(
    poolKey: string,
    slotIndex: number,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly parentGroup: THREE.Group,
    initialInstanceCapacity = 48,
  ) {
    super(poolKey, slotIndex);
    this._capacity = Math.max(8, initialInstanceCapacity);
    this._mesh = this.createInstancedMesh(this._capacity);
    this.parentGroup.add(this._mesh);
  }

  get mesh(): THREE.InstancedMesh {
    return this._mesh;
  }

  get capacity(): number {
    return this._capacity;
  }

  private createInstancedMesh(cap: number): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(this.geometry, this.material, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Ensure `instanceColor` exists at full capacity from creation so shader `USE_INSTANCING_COLOR` never flips.
    im.setColorAt(0, new THREE.Color(1, 1, 1));
    if (im.instanceColor) im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    if (this.material.userData?.depthMaterial) {
      im.customDepthMaterial = this.material.userData.depthMaterial as THREE.Material;
    }
    im.count = 0;
    im.visible = false;
    im.name = `${this.poolKey}#${this.slotIndex}`;
    return im;
  }

  private ensureCapacity(required: number): void {
    if (required <= this._capacity) return;
    const nextCap = Math.max(required, 2 ** Math.ceil(Math.log2(required)));
    resetCompactedBucket(this._mesh);
    this.parentGroup.remove(this._mesh);
    this._mesh.dispose();
    this._capacity = nextCap;
    this._mesh = this.createInstancedMesh(nextCap);
    this.parentGroup.add(this._mesh);
  }

  writeCell(
    namePrefix: string,
    propKind: string,
    cellKey: string,
    places: TPlace[],
    opts: InstOpts,
    boundsPad: number,
  ): THREE.InstancedMesh {
    this.ensureCapacity(places.length);
    this.cellKey = cellKey;
    this.placed = places;
    const im = this._mesh;
    resetCompactedBucket(im);
    writeInstancedPlaces(im, places, opts);
    im.name = `${namePrefix}-${propKind} ${cellKey}`;
    im.userData = { propKind, propCell: cellKey, placed: places };
    if (places.length > 0) {
      im.boundingSphere!.radius += boundsPad;
      im.boundingBox!.expandByScalar(boundsPad);
      im.visible = true;
    } else {
      im.visible = false;
    }
    return im;
  }

  protected onAcquire(): void {
    this._mesh.count = 0;
    this._mesh.visible = false;
  }

  protected onRelease(): void {
    this.reset();
  }

  reset(): void {
    resetCompactedBucket(this._mesh);
    this.cellKey = '';
    this.placed = [];
    this._mesh.userData = {};
    this._mesh.count = 0;
    this._mesh.visible = false;
  }

  dispose(): void {
    this.active = false;
    resetCompactedBucket(this._mesh);
    this.placed = [];
    this._mesh.removeFromParent();
    this._mesh.dispose();
  }
}
