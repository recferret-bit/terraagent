import * as THREE from 'three';
import type { DescentHandoff } from '../../descent/types';
import { createDropRig } from '../../descent/dropRig';
import { frameRot } from '../stage/math';
import { R } from '../stage/StageGlobes';
import { TB, TC, type Deploy, type DeployHost } from './types';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function computeDeployCorridor(
  host: DeployHost,
  h: DescentHandoff,
  PC: THREE.Vector3,
  cCtr: THREE.Vector3,
  s: number,
) {
  const g = host.globes.current;
  const S = host.sunDir.clone().normalize();
  const Sd = h.sunDir.clone().normalize();
  const sinEl = Sd.dot(Y_AXIS);
  const a = Math.acos(THREE.MathUtils.clamp(sinEl, -1, 1));
  const toC = cCtr.clone().sub(PC).normalize();
  const perp = toC.clone().addScaledVector(S, -toC.dot(S));
  if (perp.lengthSq() < 1e-6) perp.set(0, 1, 0).addScaledVector(S, -S.y);
  perp.normalize();
  const ne = S.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
  // Q maps descent world → stage world directions: +Y (landing up) → ne, and the sun azimuth onto the stage sun
  const xd = Sd.clone().addScaledVector(Y_AXIS, -Sd.dot(Y_AXIS));
  if (xd.lengthSq() < 1e-8) xd.set(1, 0, 0);
  xd.normalize();
  const xs = S.clone().addScaledVector(ne, -S.dot(ne));
  if (xs.lengthSq() < 1e-8) xs.copy(perp);
  xs.normalize();
  const Q = frameRot(xd, Y_AXIS, xs, ne);
  const map = (p: THREE.Vector3) => p.clone().sub(h.centre).applyQuaternion(Q).multiplyScalar(s).add(PC);
  const podEnd = map(h.pod);
  const camEnd = map(h.cam);
  const tgtEnd = map(h.camTarget);
  const qEnd = Q.clone().multiply(h.podQuat);
  // descent globe must show the same surface under the pod: spinWorld_desc = Q⁻¹ · spinWorld_stage
  const qs = g.spin.getWorldQuaternion(new THREE.Quaternion());
  const spinQuat = Q.clone().invert().multiply(qs);
  // hold shot: behind/above the carrier, looking past it at the entry point on the planet
  const toEntry = podEnd.clone().sub(cCtr).normalize();
  const side = toEntry.clone().cross(Y_AXIS);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  else side.normalize();
  const holdCam = cCtr.clone().addScaledVector(toEntry, -11.5).addScaledVector(Y_AXIS, 1.2).addScaledVector(side, 3.2);
  const holdTgt = cCtr.clone().addScaledVector(toEntry, 2.0).addScaledVector(Y_AXIS, -1.1);
  return { ne, Q, podEnd, camEnd, tgtEnd, qEnd, spinQuat, holdCam, holdTgt };
}

/** Build the deploy plan: where the pod/camera end up on the globe, the hold shot, and the starting lighting snapshot. */
export function planDeploy(host: DeployHost, h: DescentHandoff, opts: { biomeKey?: string }) {
  const { carrier, camera, sun, viewport, scene } = host;
  host.globes.settleForDeploy();
  const g = host.globes.current;
  const PC = g.group.position.clone(), Rs = R * g.group.scale.x, s = Rs / h.R;
  carrier.root.updateWorldMatrix(true, true);
  const cBox = new THREE.Box3().setFromObject(carrier.mesh), cCtr = cBox.getCenter(new THREE.Vector3());
  const { ne, Q, podEnd, camEnd, tgtEnd, qEnd, spinQuat, holdCam, holdTgt } = computeDeployCorridor(host, h, PC, cCtr, s);

  const rig = createDropRig(carrier.root, { biomeKey: opts.biomeKey ?? 'dune', carrierScale: h.carrierScale, podYaw: h.podYawLocal, attachPod: true });
  rig.setBayGlow(0); rig.setOpen(0); rig.podRig.visible = false;
  for (const m of [rig.pod.root, rig.group]) m.traverse((o) => { const mm = (o as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
  const dQ = carrier.root.getWorldQuaternion(new THREE.Quaternion());
  const atmU = (g.atmosphere.material as THREE.ShaderMaterial).uniforms;
  const { sunLight, hemi, rim } = sun;
  const bdU = host.backdrop.uniforms;
  const deploy: Deploy = {
    T: 0, gradeT0: 0.5, h, rig, PC, cCtr, Rs, s, Q, ne, podEnd, camEnd, tgtEnd, qEnd,
    p0: camera.position.clone(), t0: host.lookNow.clone(), up0: camera.up.clone(),
    holdCam: holdCam.clone(), holdTgt: holdTgt.clone(),
    holdCamGoal: holdCam, holdTgtGoal: holdTgt,
    dropDir: new THREE.Vector3(0, -1, 0).applyQuaternion(dQ).normalize(), released: false, tgtHold1: new THREE.Vector3(),
    P0: new THREE.Vector3(), q0: new THREE.Quaternion(), sc0: 1, O0: new THREE.Vector3(), G0: new THREE.Vector3(), upR: new THREE.Vector3(),
    camR: new THREE.Vector3(), tgtR: new THREE.Vector3(),
    sunI0: sunLight.intensity, sunC0: sunLight.color.clone(),
    sunDisc0: bdU.uSunDisc.value, sunColBd0: bdU.uSunColor.value.clone(),
    hemi0: [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity], rim0: rim.intensity,
    env0: scene.environmentIntensity, exp0: viewport.renderer.toneMappingExposure, bloom0: viewport.bloom.strength,
    cloudS0: g.clouds.scale.x, shell0: atmU.uShell.value as number, near0: camera.near,
  };
  return { deploy, result: { spinQuat, cloudRotY: g.clouds.rotation.y } };
}

function reanchorDeployLighting(host: DeployHost, d: Deploy) {
  const { sun, scene, viewport, backdrop } = host;
  const { sunLight, hemi, rim } = sun;
  d.gradeT0 = Math.min(Math.max(0.5, d.T), TC - 0.85);
  d.sunI0 = sunLight.intensity;
  d.sunC0.copy(sunLight.color);
  d.sunDisc0 = backdrop.uniforms.uSunDisc.value;
  d.sunColBd0.copy(backdrop.uniforms.uSunColor.value);
  d.hemi0[0].copy(hemi.color);
  d.hemi0[1].copy(hemi.groundColor);
  d.hemi0[2] = hemi.intensity;
  d.rim0 = rim.intensity;
  d.env0 = scene.environmentIntensity;
  d.exp0 = viewport.renderer.toneMappingExposure;
  d.bloom0 = viewport.bloom.strength;
}

/** Retargets solar lighting (always) and entry corridor geometry (before `TB = 3.6s`) when solar time updates on `welcome`. */
export function retargetDeployPlan(host: DeployHost, d: Deploy, h: DescentHandoff) {
  d.h = h;
  reanchorDeployLighting(host, d);
  if (d.released || d.T >= TB) return null;
  const { ne, Q, podEnd, camEnd, tgtEnd, qEnd, spinQuat, holdCam, holdTgt } = computeDeployCorridor(host, h, d.PC, d.cCtr, d.s);
  d.ne.copy(ne);
  d.Q.copy(Q);
  d.podEnd.copy(podEnd);
  d.camEnd.copy(camEnd);
  d.tgtEnd.copy(tgtEnd);
  d.qEnd.copy(qEnd);
  d.holdCamGoal.copy(holdCam);
  d.holdTgtGoal.copy(holdTgt);
  return { spinQuat, cloudRotY: host.globes.current.clouds.rotation.y };
}
