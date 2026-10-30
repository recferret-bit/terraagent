// .agents/skills/diorama-viewport-auditor/examples/DiagnosticTurntable.ts
import * as THREE from 'three';

export type DiagnosticCameraView = 'iso' | 'front' | 'side' | 'top';

/**
 * Mounts a 1m x 1m calibrated reference pedestal and switches the camera
 * between 4 diagnostic angles so AI agents can visually audit 3D models via screenshots.
 */
export class DiagnosticTurntable {
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    // 1. Reference Y=0 Grid & 1-Meter Scale Ring
    const grid = new THREE.GridHelper(6, 6, 0x00f0ff, 0x334155);
    grid.position.y = 0.002;
    this.group.add(grid);

    const ringGeo = new THREE.RingGeometry(0.98, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe59838, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.004;
    this.group.add(ring);

    scene.add(this.group);
  }

  public setView(camera: THREE.PerspectiveCamera, view: DiagnosticCameraView, targetRadius = 2.0): void {
    const dist = targetRadius * 3.2;
    switch (view) {
      case 'front':
        camera.position.set(0, targetRadius * 0.65, dist);
        break;
      case 'side':
        camera.position.set(dist, targetRadius * 0.65, 0);
        break;
      case 'top':
        camera.position.set(0.01, dist * 1.15, 0.01);
        break;
      case 'iso':
      default:
        camera.position.set(dist * 0.75, dist * 0.78, dist * 0.75);
        break;
    }
    camera.lookAt(0, targetRadius * 0.4, 0);
    camera.updateProjectionMatrix();
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
