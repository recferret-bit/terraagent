import * as THREE from 'three';
import { bez, slerpDir, smoother, win } from '../stage/math';
import { TA, TB, TC, type Deploy, type DeployHost } from './types';

const Y_UP = new THREE.Vector3(0, 1, 0);
// scratch vectors (fully rewritten before every read within one call)
const dA = new THREE.Vector3(), dB = new THREE.Vector3(), dC = new THREE.Vector3();

/** Phase A+B (T <= TB): fly to the hold shot behind the carrier, pod lowers into the bay, clamps open, pod drops. */
export function stepHold(host: DeployHost, d: Deploy, T: number) {
  const { camera, lookNow } = host;
  const e = smoother(T / TA);
  camera.position.lerpVectors(d.p0, d.holdCam, e);
  dA.subVectors(d.holdCam, d.p0);
  camera.position.y += Math.sin(Math.PI * e) * dA.length() * 0.1;
  lookNow.lerpVectors(d.t0, d.holdTgt, smoother(Math.min(1, T / TA * 1.15)));
  camera.position.addScaledVector(dB.subVectors(d.holdTgt, d.holdCam).normalize(), 0.35 * win(TA, TB, T)); // slow push-in
  camera.up.lerpVectors(d.up0, Y_UP, e).normalize();
  camera.lookAt(lookNow);
  const podIn = win(0.3, 2.0, T);
  d.rig.podRig.visible = podIn > 0;
  d.rig.podRig.position.copy(d.rig.dockedCentre);
  d.rig.podRig.position.y += (1 - podIn) * d.rig.podH * 0.95 / d.h.carrierScale;
  // B: clamps open, pod drops out of the bay under gravity
  const open = win(TA - 0.3, TA + 0.4, T);
  d.rig.setOpen(open);
  const fall = Math.max(0, T - (TA + 0.25)), drop = 0.5 * 9.0 * fall * fall;
  d.rig.podRig.position.y -= drop * d.rig.podH * 0.35 / d.h.carrierScale;
  d.rig.podRig.rotation.z = 0.25 * fall * fall;
  d.rig.setBayGlow(d.h.bayGlow * win(0.2, 1.6, T) * (1 - 0.5 * win(TA + 0.2, TB, T)));
  // as the clamps let go the camera re-frames from the ship onto the falling pod
  const track = win(TA - 0.5, TB, T);
  if (track > 0) {
    d.rig.podRig.updateWorldMatrix(true, false);
    d.rig.podRig.getWorldPosition(dC);
    lookNow.lerp(dC, track);
    camera.lookAt(lookNow);
  }
}

/** Detach the pod from the carrier and capture the release-time offsets the dive interpolates from. */
function release(host: DeployHost, d: Deploy) {
  const { camera, lookNow } = host;
  d.released = true;
  host.scene.attach(d.rig.podRig);
  d.rig.podRig.getWorldPosition(d.P0); d.rig.podRig.getWorldQuaternion(d.q0);
  d.sc0 = d.rig.podRig.getWorldScale(dA).x;
  // pod centre (rig origin is the pod centre)
  d.O0.subVectors(camera.position, d.P0); d.G0.subVectors(lookNow, d.P0); d.upR.copy(camera.up); d.tgtHold1.copy(lookNow);
  d.camR.subVectors(d.camEnd, d.podEnd); d.tgtR.subVectors(d.tgtEnd, d.podEnd);
}

/**
 * Phase C (T > TB): the scale-dive. Pod falls toward the real planet along a curve; pod + camera offset shrink together
 * (constant on-screen size) until everything equals the descent frame mapped onto this globe.
 */
export function stepDive(host: DeployHost, d: Deploy, T: number) {
  const { camera, lookNow } = host;
  const g = host.globes.current;
  if (!d.released) release(host, d);
  const u = (T - TB) / (TC - TB), e = smoother(u);
  const ep = 0.5 * u + 2 * u * u - 1.5 * u * u * u; // starts at the drop's speed, accelerates, settles (f'(1)=0)
  const L = d.P0.distanceTo(d.podEnd);
  dA.copy(d.P0).addScaledVector(d.dropDir, L * 0.18);
  dB.copy(d.podEnd).addScaledVector(d.ne, L * 0.42);
  bez(d.P0, dA, dB, d.podEnd, ep, dC);
  const sc = Math.exp(THREE.MathUtils.lerp(Math.log(d.sc0), Math.log(d.s), ep));
  d.rig.podRig.position.copy(dC);
  d.rig.podRig.scale.setScalar(sc);
  d.rig.podRig.quaternion.copy(d.q0).slerp(d.qEnd, e);
  // camera offset: direction slerp, length tied to the pod scale
  const k0 = d.O0.length() / d.sc0, k1 = d.camR.length() / d.s;
  dA.copy(d.O0).normalize(); dB.copy(d.camR).normalize();
  slerpDir(dA, dB, e, dA);
  camera.position.copy(dC).addScaledVector(dA, THREE.MathUtils.lerp(k0, k1, e) * sc);
  dB.copy(d.G0).multiplyScalar(1 / d.sc0).lerp(dA.copy(d.tgtR).multiplyScalar(1 / d.s), e).multiplyScalar(sc);
  lookNow.copy(dC).add(dB);
  // ease from the world-fixed hold shot into pod-follow (no velocity kick at release)
  const f = win(0, 0.3, u);
  if (f < 1) {
    dA.subVectors(d.holdTgt, d.holdCam).normalize();
    dB.copy(d.holdCam).addScaledVector(dA, 0.35);
    camera.position.lerpVectors(dB, camera.position, f);
    lookNow.lerpVectors(d.tgtHold1, lookNow, f);
  }
  camera.up.copy(d.upR).lerp(d.ne, e).normalize();
  camera.lookAt(lookNow);
  camera.near = THREE.MathUtils.clamp(camera.position.distanceTo(dC) * 0.02, 0.0004, d.near0);
  camera.fov = THREE.MathUtils.lerp(28, d.h.fov, e);
  camera.updateProjectionMatrix();
  // globe look converges to the descent's: cloud shell height, atmosphere thickness, cloud near-fade
  g.clouds.scale.setScalar(THREE.MathUtils.lerp(d.cloudS0, (1 + 150 / d.h.R) / 1.012, e));
  (g.atmosphere.material as THREE.ShaderMaterial).uniforms.uShell.value = THREE.MathUtils.lerp(d.shell0, 1.035, e);
  g.shared.uCloudNear.value.set(40 * d.s * e, 500 * d.s * e + 0.0001);
  d.rig.setBayGlow(d.h.bayGlow * 0.5 * (1 - win(0, 0.3, u)));
}
