// Display pedestal: slab + top + blue rim + faint grid, scaled per model.
import * as THREE from 'three';

export class Pedestal {
  readonly group = new THREE.Group();
  readonly topMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.9 });

  constructor() {
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.8, metalness: 0.2 });
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.3, 64), slabMat); slab.position.y = -0.17; slab.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), this.topMat); top.position.y = -0.012; top.receiveShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 8, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1e5bff, emissive: 0x1e5bff, emissiveIntensity: 3 }));
    const grid = new THREE.GridHelper(2, 8, 0x5b8cff, 0x2a2f3a); grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.5;
    this.group.add(slab, top, rim, grid);
  }
}
