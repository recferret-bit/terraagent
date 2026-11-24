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

/**
 * Carrier inclined orbital drift (foreground-left of the planet): banked into its prograde orbit so its ventral
 * drop-pod bay and canted launch cradles aim inward toward `planetPos` while its solar wings catch the sun.
 */
export function driftCarrier(carrier: FittedModel, planetPos: THREE.Vector3, time: number, camera?: THREE.PerspectiveCamera) {
  const cz = 11.2 + Math.sin(time * 0.083) * 1.4;
  let cx = planetPos.x - 9.6 + Math.sin(time * 0.11) * 0.9;
  const cy = -3.4 + Math.sin(time * 0.17 + 0.6) * 0.35;
  if (camera && camera.aspect > 0 && camera.aspect < 1.05) {
    const dz = Math.max(10, camera.position.z - cz);
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dz * camera.aspect;
    const horizExtent = Math.min(halfW * 0.74, Math.max(carrier.size.x, carrier.size.z) * 0.48);
    cx = THREE.MathUtils.clamp(cx, -halfW + horizExtent, halfW - horizExtent);
  }
  carrier.root.position.set(cx, cy, cz);
  carrier.root.rotation.set(
    0.22 + Math.sin(time * 0.21) * 0.03,
    0.68 + Math.sin(time * 0.07) * 0.14,
    0.98 + Math.sin(time * 0.13) * 0.04,
  );
}
