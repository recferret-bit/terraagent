import * as THREE from 'three';
import type { DescentHandoff } from '../../../../game/descent/types';
import { createDropRig } from '../../../../game/descent/dropRig';
import { frameRot } from '../stage/math';
import { R } from '../stage/StageGlobes';
import type { Deploy, DeployHost } from './types';

/** Build the deploy plan: where the pod/camera end up on the globe, the hold shot, and the starting lighting snapshot. */
export function planDeploy(host: DeployHost, h: DescentHandoff, opts: { biomeKey?: string }) {
  const { carrier, camera, sun, viewport, scene } = host;
  host.globes.settleForDeploy();
  const g = host.globes.current;
  const PC = g.group.position.clone(), Rs = R * g.group.scale.x, s = Rs / h.R;
  // entry point: on the camera-facing lit side, at the same sun elevation the descent uses at its landing site
  const Y = new THREE.Vector3(0, 1, 0), S = host.sunDir.clone().normalize(), Sd = h.sunDir.clone().normalize();
  const sinEl = Sd.dot(Y), a = Math.acos(THREE.MathUtils.clamp(sinEl, -1, 1));
  carrier.root.updateWorldMatrix(true, true);
  const cBox = new THREE.Box3().setFromObject(carrier.mesh), cCtr = cBox.getCenter(new THREE.Vector3());
  const toC = cCtr.clone().sub(PC).normalize();
  const perp = toC.clone().addScaledVector(S, -toC.dot(S));
  if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0).addScaledVector(S, -S.y);
  perp.normalize();
  const ne = S.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
  // Q maps descent world → stage world directions: +Y (landing up) → ne, and the sun azimuth onto the stage sun
  const xd = Sd.clone().addScaledVector(Y, -Sd.dot(Y)); if (xd.lengthSq() < 1e-8) xd.set(1, 0, 0); xd.normalize();
  const xs = S.clone().addScaledVector(ne, -S.dot(ne)); if (xs.lengthSq() < 1e-8) xs.copy(perp); xs.normalize();
  const Q = frameRot(xd, Y, xs, ne);
  const map = (p: THREE.Vector3) => p.clone().sub(h.centre).applyQuaternion(Q).multiplyScalar(s).add(PC);
  const podEnd = map(h.pod), camEnd = map(h.cam), tgtEnd = map(h.camTarget);
  const qEnd = Q.clone().multiply(h.podQuat);
  // descent globe must show the same surface under the pod: spinWorld_desc = Q⁻¹ · spinWorld_stage
  const qs = g.spin.getWorldQuaternion(new THREE.Quaternion());
  const spinQuat = Q.clone().invert().multiply(qs);

  const rig = createDropRig(carrier.root, { biomeKey: opts.biomeKey ?? 'dune', carrierScale: h.carrierScale, podYaw: h.podYawLocal, attachPod: true });
  rig.setBayGlow(0); rig.setOpen(0); rig.podRig.visible = false;
  for (const m of [rig.pod.root, rig.group]) m.traverse((o) => { const mm = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
  // hold shot: behind/above the carrier, looking past it at the entry point on the planet
  const toEntry = podEnd.clone().sub(cCtr).normalize();
  const side = toEntry.clone().cross(Y).normalize();
  const holdCam = cCtr.clone().addScaledVector(toEntry, -11.5).addScaledVector(Y, 1.2).addScaledVector(side, 3.2);
  const holdTgt = cCtr.clone().addScaledVector(toEntry, 2.0).addScaledVector(Y, -1.1);
  const dQ = carrier.root.getWorldQuaternion(new THREE.Quaternion());
  const atmU = (g.atmosphere.material as THREE.ShaderMaterial).uniforms;
  const { sunLight, hemi, rim } = sun;
  const deploy: Deploy = {
    T: 0, h, rig, PC, Rs, s, Q, ne, podEnd, camEnd, tgtEnd, qEnd,
    p0: camera.position.clone(), t0: host.lookNow.clone(), up0: camera.up.clone(), holdCam, holdTgt,
    dropDir: new THREE.Vector3(0, -1, 0).applyQuaternion(dQ).normalize(), released: false, tgtHold1: new THREE.Vector3(),
    P0: new THREE.Vector3(), q0: new THREE.Quaternion(), sc0: 1, O0: new THREE.Vector3(), G0: new THREE.Vector3(), upR: new THREE.Vector3(),
    camR: new THREE.Vector3(), tgtR: new THREE.Vector3(),
    sunI0: sunLight.intensity, sunC0: sunLight.color.clone(),
    hemi0: [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity], rim0: rim.intensity,
    env0: scene.environmentIntensity, exp0: viewport.renderer.toneMappingExposure, bloom0: viewport.bloom.strength,
    cloudS0: g.clouds.scale.x, shell0: atmU.uShell.value as number, near0: camera.near,
  };
  return { deploy, result: { spinQuat, cloudRotY: g.clouds.rotation.y } };
}
