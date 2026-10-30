import * as THREE from 'three';
import type { FittedModel } from '../../visuals/space/placeholders';

/** Camera: slow cinematic sway + mouse-driven parallax (planet/carrier/moons/layers separate by depth). */
export function updateIdleCamera(camera: THREE.PerspectiveCamera, lookNow: THREE.Vector3, camBase: THREE.Vector3, mouseS: THREE.Vector2, planetPos: THREE.Vector3, time: number) {
  camera.position.set(
    camBase.x + Math.sin(time * 0.05) * 0.9 + mouseS.x * 3.6,
    camBase.y + Math.sin(time * 0.037 + 1.0) * 0.35 + mouseS.y * 2.0,
    camBase.z,
  );
  lookNow.set(planetPos.x * 0.35, 0.3, 0);
  camera.lookAt(lookNow);
  camera.updateMatrixWorld();
}

/** Carrier hover drift (lower-left of the planet, between camera and globe). */
export function driftCarrier(carrier: FittedModel, planetPos: THREE.Vector3, time: number) {
  const cx = planetPos.x - 13.5 + Math.sin(time * 0.11) * 1.4;
  const cy = -5.2 + Math.sin(time * 0.17 + 0.6) * 0.45;
  const cz = 12 + Math.sin(time * 0.083) * 2.0;
  carrier.root.position.set(cx, cy, cz);
  carrier.root.rotation.set(0.08 + Math.sin(time * 0.21) * 0.03, 0.9 + Math.sin(time * 0.07) * 0.22, -0.1 + Math.sin(time * 0.13) * 0.04);
}
