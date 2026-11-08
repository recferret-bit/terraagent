import * as THREE from 'three';
import { createArchetypeMesh, type ArchetypeMesh } from '../../kitbash/catalog';
import { INSECT_SPECIES } from './rig';
import { INSTANCE_ATTRIBUTES, useInsectInstanceAttributes } from './instanceShader';

interface Batch { mesh: THREE.InstancedMesh; template: ArchetypeMesh; capacity: number }
interface Proxy { mesh: ArchetypeMesh; materialVisible: boolean }

/** Batches authored insects while retaining entity proxies for picking, sockets and corpse lifetimes. */
export class InsectSwarmRenderer {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly proxies = new Map<THREE.Object3D, Proxy>();
  private readonly relative = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();

  constructor(private readonly root: THREE.Object3D) {
    this.group.name = 'insect-swarms';
    root.add(this.group);
  }

  /** Call after pose/action/visibility updates. Removed proxies stay renderable until their owner disposes them. */
  sync(biome: string): void {
    const members = new Map<string, ArchetypeMesh[]>();
    const present = new Set<THREE.Object3D>();
    this.root.traverse(object => {
      const id = object.userData.archetypeId as string | undefined;
      if (!id || !INSECT_SPECIES[id] || !(object as THREE.Mesh).isMesh) return;
      const mesh = object as ArchetypeMesh;
      present.add(mesh);
      if (!this.proxies.has(mesh)) this.proxies.set(mesh, { mesh, materialVisible: (mesh.material as THREE.Material).visible });
      (mesh.material as THREE.Material).visible = false; // Raycasting still uses the original geometry.
      if (!this.visibleToRoot(mesh)) return;
      const key = `${biome}:${id}`;
      const list = members.get(key) ?? [];
      list.push(mesh); members.set(key, list);
    });
    for (const [mesh, proxy] of this.proxies) if (!present.has(mesh)) {
      (proxy.mesh.material as THREE.Material).visible = proxy.materialVisible;
      this.proxies.delete(mesh);
    }
    this.root.updateWorldMatrix(true, true);
    this.inverse.copy(this.group.matrixWorld).invert();
    for (const [key, batch] of this.batches) if (!members.has(key)) { this.release(batch); this.batches.delete(key); }
    for (const [key, list] of members) this.writeBatch(key, list, biome);
  }

  private visibleToRoot(mesh: THREE.Object3D): boolean {
    for (let node: THREE.Object3D | null = mesh; node && node !== this.root; node = node.parent) if (!node.visible) return false;
    return this.root.visible;
  }

  private createBatch(id: string, biome: string, count: number): Batch {
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, count)));
    const template = createArchetypeMesh(id, biome);
    for (const [name, size] of Object.entries(INSTANCE_ATTRIBUTES)) {
      template.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    useInsectInstanceAttributes(template.material as THREE.Material);
    useInsectInstanceAttributes(template.customDepthMaterial!);
    const mesh = new THREE.InstancedMesh(template.geometry, template.material, capacity);
    mesh.customDepthMaterial = template.customDepthMaterial;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `swarm:${id}`;
    this.group.add(mesh);
    return { mesh, template, capacity };
  }

  private writeBatch(key: string, list: ArchetypeMesh[], biome: string): void {
    let batch = this.batches.get(key);
    if (!batch || batch.capacity < list.length) {
      if (batch) this.release(batch);
      batch = this.createBatch(list[0]!.userData.archetypeId, biome, list.length);
      this.batches.set(key, batch);
    }
    const { mesh, template } = batch;
    mesh.count = list.length;
    list.forEach((source, i) => {
      mesh.setMatrixAt(i, this.relative.multiplyMatrices(this.inverse, source.matrixWorld));
      const uniforms = source.userData.uniforms;
      const motion = mesh.geometry.getAttribute('aInsectMotion') as THREE.InstancedBufferAttribute;
      motion.setXYZW(i, uniforms.uTime.value, uniforms.uWalkWeight.value, uniforms.uWorkWeight.value, uniforms.uInsectWalk.value);
      const action = uniforms.uInsectAction.value as THREE.Vector4;
      (mesh.geometry.getAttribute('aInsectAction') as THREE.InstancedBufferAttribute).setXYZW(i, action.x, action.y, action.z, action.w);
      (mesh.geometry.getAttribute('aInsectFlags') as THREE.InstancedBufferAttribute).setXY(i, uniforms.uInsectSacSide.value, uniforms.uSelected?.value ?? 0);
    });
    template.userData.uniforms.uInsectSpecies.value = list[0]!.userData.uniforms.uInsectSpecies.value;
    template.userData.uniforms.uSelectionTime.value = list[0]!.userData.uniforms.uSelectionTime.value;
    mesh.instanceMatrix.needsUpdate = true;
    for (const name of Object.keys(INSTANCE_ATTRIBUTES)) mesh.geometry.getAttribute(name).needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 1; // Full authored attack/death envelope.
  }

  private release(batch: Batch): void {
    batch.mesh.removeFromParent(); batch.mesh.dispose(); batch.mesh.geometry.dispose();
    (batch.mesh.material as THREE.Material).dispose(); // Unified material also disposes its depth material.
  }

  clear(): void {
    for (const batch of this.batches.values()) this.release(batch);
    this.batches.clear();
    for (const proxy of this.proxies.values()) (proxy.mesh.material as THREE.Material).visible = proxy.materialVisible;
    this.proxies.clear();
  }
  dispose(): void { this.clear(); this.group.removeFromParent(); }
}
