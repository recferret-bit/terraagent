import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CreateDescentSequence, DescentHandoff, DescentPhase, DescentSequence, DescentTelemetry } from './types';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { createPlanetGlobe } from '../planets/PlanetGlobe';
import { createSpaceBackdrop } from '../visuals/space/SpaceBackdrop';
import { acquireModel, tickArchetypeMesh } from '../visuals/space/placeholders';
import { clamp, lerp, makeCurve, smoothstep, smoother } from './math';
import { createStreakField } from './fx/Streaks';
import { createPlasma } from './fx/Plasma';
import { createCanopy } from './fx/Canopy';
import { createCloudDeck } from './fx/CloudDeck';
import { createFlames } from './fx/Flames';
import { createGroundFX } from './fx/GroundFX';
import { createDropRig, CUT_POSE } from './dropRig';

void PLANET_SPECS;
const R = 4000;          // globe radius (m-ish). The surface patch sits on its top at y≈0.
const Y0 = 600;          // pod altitude while docked to the carrier
const FOGMAX = 0.013;
const DECK = 150;        // cloud deck altitude
const TL = 35;           // authored timeline length; real time is scaled by duration/35
const D2R = Math.PI / 180;

const PHASES: [number, DescentPhase][] = [[4, 'orbit'], [8, 'release'], [15, 'freefall'], [23, 'reentry'], [29, 'chute'], [34, 'retro'], [99, 'touchdown']];
const phaseOf = (t: number): DescentPhase => { for (const [e, p] of PHASES) if (t < e) return p; return 'touchdown'; };

// pod altitude above ground (carrier-docked until 4 s)
const altCurve = makeCurve([[0, Y0], [4, Y0], [8, 585], [15, 470], [23, 230], [29, 60], [34, 0], [35, 0]]);
const speedCurve = makeCurve([[0, 27600], [4, 27600], [8, 27200], [15, 21000], [19, 9800], [23, 2400], [25, 900], [29, 320], [34, 12], [35, 0]]);
const gCurve = makeCurve([[0, 0], [8, 0.1], [14, 0.6], [17, 3.5], [19.5, 6.8], [22, 4.0], [23, 2.0], [24, 3.8], [25, 1.2], [29, 1.0], [30, 2.4], [33, 1.6], [34, 1.0], [35, 1.0]]);
const streakSpeed = makeCurve([[0, 0], [8, 0], [10, 60], [15, 180], [19, 260], [23, 150], [26, 30], [29, 0]]);
const camPhi = makeCurve([[3.6, 112], [8, 96], [11, 88], [15, 85], [17, 100], [21, 130], [23, 150], [26, 160], [29, 150]]);
const camEps = makeCurve([[3.6, -12], [6, -5], [8, 14], [11, 40], [15, 58], [17, 22], [21, 10], [23, 12], [26, 14], [29, 18]]);
const camLnD = makeCurve([[3.6, Math.log(46)], [8, Math.log(52)], [11, Math.log(38)], [15, Math.log(22)], [17, Math.log(17)], [21, Math.log(15)], [23, Math.log(26)], [26, Math.log(38)], [29, Math.log(40)]]);
const camLookY = makeCurve([[3.6, 0], [8, 2], [15, 0], [23, 3], [26, 6], [29, 4]]);

const FINAL_POS = new THREE.Vector3(42, 46, 42);
const FINAL_TARGET = new THREE.Vector3(0, 0, 0);

function caption(t: number, name: string): string {
  if (t < 2) return 'Carrier on station — drop bay arming';
  if (t < 4) return 'Bay open — pod clamps releasing';
  if (t < 8) return 'Drop pod away — separation nominal';
  if (t < 15) return 'Freefall — entry corridor locked';
  if (t < 23) return 'Atmospheric interface — hold on';
  if (t < 26) return 'Heat shield jettisoned — chute deploying';
  if (t < 29) return 'Chute stable — punching through the cloud deck';
  if (t < 34) return 'Retro-thrusters firing — brace for touchdown';
  if (t < 34.6) return 'Touchdown confirmed — pod opening';
  return `Surface contact — welcome to ${name}`;
}

export const createDescentSequence: CreateDescentSequence = (opts) => {
  const { viewport, scene, camera, spec, surface } = opts;
  const duration = opts.duration ?? 35;
  const startAt = clamp(opts.startAt ?? 0, 0, 30); // authored seconds to begin at (2 = carrier hand-off, bay arming)
  const tScale = TL / duration;
  const o = spec.orbital;
  const dens = o.atmosphereDensity;

  // ---- save state to restore
  const saved = { near: camera.near, far: camera.far, fov: camera.fov, bloom: viewport.bloom.strength, envI: scene.environmentIntensity };
  if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color(0x000000);
  if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(spec.sky.fogColor, spec.sky.fogDensity);
  const bg = scene.background as THREE.Color, fog = scene.fog as THREE.FogExp2;

  // ---- geometry of the landing
  const L = surface.landingSite.clone();
  const fd = new THREE.Vector3(0.6, 0, 0.8).normalize();       // hero walks out along this (towards the gameplay camera)
  const fdYaw = Math.atan2(fd.x, fd.z);
  const podLand = new THREE.Vector3(L.x - fd.x * 2.6, 0, L.z - fd.z * 2.6);
  podLand.y = surface.heightAt(podLand.x, podLand.z);
  const lat0 = new THREE.Vector2(-90, 60);                       // pod's lateral offset at release (drifts to the landing spot)
  const sunDir = new THREE.Vector3(35, 55, 25).normalize();      // == viewport sun offset, so lighting is continuous at handover

  // ---- models (carrier + shared drop rig: bay plate, clamp arms, pod, heat shield — identical to the menu stage's)
  const carrier = acquireModel('ship.carrier', spec.biomeKey, { size: 34, mode: 'max', minRatio: 0.45, maxRatio: 1.8 });
  const rig = createDropRig(carrier.root, { biomeKey: spec.biomeKey, carrierScale: carrier.root.scale.x, attachPod: false });
  const pod = rig.pod;
  const podH = rig.podH, podR = rig.podR;
  const hero = acquireModel('robot.hero', spec.biomeKey);
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const podRoot = new THREE.Group(); podRoot.rotation.order = 'YXZ'; podRoot.name = 'descent:podRoot';
  podRoot.add(rig.podRig);
  // heat shield (rig mesh; detaches at chute)
  const shieldGeo = rig.shieldGeo, shieldMat = rig.shieldMat, shield = rig.shield;
  // hatch + ramp
  const hatchMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, metalness: 0.6, roughness: 0.4 });
  const hatchGeo = new RoundedBoxGeometry(podR * 0.85, podH * 0.5, 0.1, 3, 0.04);
  const hatchLight = new THREE.MeshStandardMaterial({ color: 0x113344, emissive: 0x30d8ff, emissiveIntensity: 3.5 });
  const hatchLightGeo = new RoundedBoxGeometry(podR * 0.7, 0.07, 0.07, 2, 0.02);
  const hatchPivot = new THREE.Group(); const hatchHinge = new THREE.Group(); hatchPivot.add(hatchHinge);
  const hatch = new THREE.Mesh(hatchGeo, hatchMat); hatch.position.y = podH * 0.25; hatch.castShadow = true;
  const hatchStrip = new THREE.Mesh(hatchLightGeo, hatchLight); hatchStrip.position.set(0, podH * 0.5 - 0.1, 0.06);
  hatchHinge.add(hatch, hatchStrip); hatchPivot.visible = false; podRoot.add(hatchPivot);
  const hasTop = new THREE.Group(); hasTop.name = 'descent:root'; scene.add(hasTop);
  hasTop.add(podRoot, carrier.root, hero.root);
  for (const m of [pod, carrier]) m.root.traverse((ob) => { const mm = (ob as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined; if (mm) mm.fog = false; });
  hero.root.visible = false;

  // ---- environment objects
  const backdrop = track(createSpaceBackdrop({ seed: spec.seed, sunDir, nebulaA: new THREE.Color(o.atmosphereColor).lerp(new THREE.Color(0x2a3f9a), 0.55), nebulaB: 0x3a2a8a }));
  hasTop.add(backdrop.group);
  const globe = track(createPlanetGlobe(spec, { radius: R, segments: 160, cloudScale: 1 + DECK / R, atmScale: 1.035 }));
  globe.group.position.set(L.x, -R - 6, L.z);
  globe.setSunDirection(sunDir);
  globe.spin.rotation.set(1.0, 2.2, 0.0); // landing site (world +Y) maps to a mid-latitude point, not the polar cap
  globe.group.rotation.set(0, 0, 0);
  hasTop.add(globe.group);
  const cloudCol = new THREE.Color(o.cloudColor);
  const deck = track(createCloudDeck(DECK, Math.max(o.cloudCover, 0.3), cloudCol));
  deck.u.uSun.value.copy(sunDir);
  hasTop.add(deck.group);
  const streaks = track(createStreakField(240, 40, 4.5, 110, spec.seed));
  hasTop.add(streaks.mesh);
  const plasma = track(createPlasma(podR, podH));
  plasma.group.position.y = 0; hasTop.add(plasma.group);
  const flames = track(createFlames(podR));
  podRoot.add(flames.group); flames.group.position.y = -podH / 2;
  const canopy = track(createCanopy(podH / 2, podR, new THREE.Color(spec.palette.accent).lerp(new THREE.Color(0xff6a2a), 0.5), 0xe8e4da));
  podRoot.add(canopy.group);
  const gfx = track(createGroundFX(spec.kind, spec.seed));
  hasTop.add(gfx.group);
  const fxLight = new THREE.PointLight(0xff7a2a, 0, 70, 2); hasTop.add(fxLight); // single pooled light
  // free-flying heat shield copy (detached)
  const shieldFree = new THREE.Mesh(shieldGeo, shieldMat); shieldFree.visible = false; shieldFree.castShadow = true; hasTop.add(shieldFree);

  // ---- state
  let t = 0, started = false, finished = false, disposed = false, delivered = false, scroll = 0;
  const telCbs: ((x: DescentTelemetry) => void)[] = [], doneCbs: ((h: THREE.Object3D) => void)[] = [];
  const tel: DescentTelemetry = { t: 0, duration, progress: 0, phase: 'orbit', altitudeKm: 400, speedKmh: 0, gForce: 0, heatPct: 0, caption: '' };
  const podBase = new THREE.Vector3(), podCenter = new THREE.Vector3(), camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const colA = new THREE.Color(), colB = new THREE.Color(), colC = new THREE.Color();
  const atmCol = new THREE.Color(o.atmosphereColor);
  const skyZ = new THREE.Color(spec.sky.skyColor), skyH = new THREE.Color(spec.sky.horizonColor), fogC = new THREE.Color(spec.sky.fogColor), sunC = new THREE.Color(spec.sky.sunColor), hemiC = new THREE.Color(spec.sky.skyColor), hemiG = new THREE.Color(spec.sky.hemiGround);
  const haze = new THREE.Color(spec.sky.horizonColor).lerp(cloudCol, 0.5);
  const spaceSun = new THREE.Color(1.0, 0.96, 0.88), spaceHemi = new THREE.Color(0.45, 0.55, 0.85), spaceHemiG = new THREE.Color(0.04, 0.04, 0.07);
  const sunPosDelta = viewport.sun.position.clone().sub(viewport.sun.target.position);
  void sunPosDelta;
  const C = new THREE.Vector3(L.x, -R - 6, L.z);
  // opening camera: whole planet, centred; orbit view direction chosen ⟂ sun so the terminator is visible
  const cd0 = new THREE.Vector3(-0.6, 0, 0.8).normalize();
  const pod0 = new THREE.Vector3(podLand.x + lat0.x, Y0, podLand.z + lat0.y);
  const focus0 = new THREE.Vector3(pod0.x, Y0 + podH / 2, pod0.z);
  const off0 = C.clone().sub(focus0).addScaledVector(cd0, 4.8 * R);
  const off0Len = off0.length(), dir0 = off0.clone().normalize();
  void dir0; void off0Len; void cd0;
  const cq = new THREE.Quaternion();
  const bayGlowAt = (tn: number) => 3.5 * smoother(0.6, 2.5, tn) * (1 - 0.6 * smoothstep(4, 6, tn));

  const pos = (tn: number, out: THREE.Vector3) => {
    const s = smoother(4, 34, tn);
    const yRel = altCurve(tn);
    const x = podLand.x + lat0.x * (1 - s), z = podLand.z + lat0.y * (1 - s);
    const g = surface.heightAt(x, z) * smoothstep(80, 0, yRel);
    return out.set(x, yRel + g - 4.0 * smoothstep(34.55, 35, tn), z);
  };
  const posNoSink = new THREE.Vector3();
  const detach23 = pos(23, new THREE.Vector3()), v23 = (altCurve(23.02) - altCurve(22.98)) / 0.04;
  const handHero = () => {
    const mesh = hero.mesh;
    scene.attach(mesh);
    hero.root.removeFromParent();
    mesh.visible = true;
    delivered = true;
    return mesh;
  };

  function applyFrame(tn: number, dtn: number) {
    // ---------- pod kinematics
    pos(tn, podBase);
    podCenter.set(podBase.x, podBase.y + podH / 2, podBase.z);
    const tum = smoothstep(4, 4.6, tn) * (1 - smoothstep(8, 13, tn));
    const sway = 0.07 * Math.sin(tn * 1.1) * smoothstep(24, 26, tn) * (1 - smoothstep(30, 33, tn));
    podRoot.position.copy(podCenter);
    podRoot.rotation.set(0.35 * Math.sin(1.3 * (tn - 4)) * tum + sway * 0.5, 2.4 * smoother(4, 12, tn), 0.5 * Math.sin(0.9 * (tn - 4) + 1) * tum + sway);
    const yRel = altCurve(tn);

    // envelopes
    const P = smoothstep(14.6, 17.5, tn) * (1 - smoothstep(21.3, 23.6, tn));
    const plasmaI = P * (0.55 + 1.1 * dens);
    const heat = clamp(smoothstep(14.8, 19, tn) * (1 - smoothstep(22, 28, tn)) * (0.6 + 0.5 * dens));
    const thr = smoothstep(28.9, 29.6, tn) * (1 - smoothstep(34.0, 34.4, tn));

    // ---------- carrier + bay
    const cDrift = smoother(4, 14, tn);
    carrier.root.visible = tn < 14.6;
    carrier.root.position.set(pod0.x - 100 * cDrift, Y0 + podH - 0.4 + 60 * cDrift, pod0.z - 80 * cDrift);
    carrier.root.rotation.set(0.02 * Math.sin(tn * 0.6), 0.3 + 0.05 * cDrift, 0);
    const open = smoother(2.2, 3.8, tn);
    rig.setOpen(open);
    rig.setBayGlow(bayGlowAt(tn));
    pod.root.visible = true;

    // ---------- heat shield: attached until 23, then free-falling
    const free = tn >= 23;
    shield.visible = !free;
    if (free) {
      const tau = tn - 23;
      shieldFree.visible = tau < 4.5;
      shieldFree.position.set(detach23.x + 0.6 * tau, detach23.y + v23 * tau - 4.9 * tau * tau + 0.5 * v23 * 0 - podH / 2 + 0.02, detach23.z);
      shieldFree.rotation.set(0.7 * tau, 1.4 * tau, 0.5 * tau);
    } else shieldFree.visible = false;
    shieldMat.emissiveIntensity = 1.1 * P * (1 - smoothstep(23, 26, tn));

    // ---------- plasma, streaks
    plasma.group.visible = plasmaI > 0.01;
    plasma.group.position.set(podCenter.x, podCenter.y, podCenter.z);
    plasma.u.uI.value = plasmaI; plasma.u.uTime.value = tn;
    plasma.u.uCool.value.set(o.atmosphereColor).multiplyScalar(0).add(colA.setRGB(1.4, 0.32, 0.05).lerp(atmCol, 0.25).multiplyScalar(1.0));
    const sp = streakSpeed(tn);
    scroll += sp * dtn / tScale; // streak scroll in "authored seconds"
    const dist = camPos.distanceTo(podCenter);
    const cb = tn > 17 ? 1 - smoothstep(0, 28, Math.abs(camPos.y - DECK)) : 0;
    const wind = 0.16 * smoothstep(9, 13, tn) * (1 - smoothstep(21, 25, tn)) + 0.25 * cb;
    streaks.u.uIntensity.value = wind + 0.9 * P;
    streaks.mesh.visible = streaks.u.uIntensity.value > 0.003;
    streaks.u.uColA.value.setRGB(0.55, 0.7, 1.0).lerp(colA.setRGB(1.6, 0.5, 0.1), P);
    streaks.u.uColB.value.setRGB(0.9, 0.95, 1.0).lerp(colB.setRGB(2.0, 1.3, 0.7), P);
    streaks.u.uPod.value.copy(podCenter); streaks.u.uScroll.value = scroll; streaks.u.uLen.value = 2.5 + 0.1 * sp;
    void dist;

    // ---------- chute
    const dep = smoother(23.1, 24.4, tn), x = smoother(23.6, 25.2, tn);
    const infl = x * (1 + 0.12 * Math.sin(Math.PI * x));
    const rel = smoother(29.3, 31, tn);
    canopy.update(tn, dep * (1 - rel), infl * (1 - 0.5 * rel), sunDir);
    canopy.group.position.set(14 * rel, 28 * rel * rel, -6 * rel);
    canopy.group.scale.setScalar(1 - 0.85 * rel);
    if (rel >= 1) canopy.group.visible = false;

    // ---------- retro flames + ground fx + light
    flames.group.visible = thr > 0.01;
    flames.u.uI.value = thr * (0.88 + 0.12 * Math.sin(tn * 40)); flames.u.uTime.value = tn;
    const gx = podBase.x, gz = podBase.z;
    tmpA.set(gx, surface.heightAt(gx, gz), gz);
    const pxScale = viewport.renderer.domElement.height / (2 * Math.tan(camera.fov * D2R * 0.5));
    gfx.update(tn, tmpA, thr * smoothstep(30, 3, yRel) + 0.0, pxScale);
    const lightI = 60 * plasmaI + 45 * thr;
    fxLight.intensity = lightI; fxLight.visible = lightI > 0.1;
    fxLight.color.setRGB(1, 0.5, 0.18).lerp(colC.setRGB(1, 0.75, 0.5), thr);
    fxLight.position.set(podBase.x, podBase.y - 1.0, podBase.z);

    // ---------- touchdown: hatch, hero
    const td = tn >= 33.95;
    hatchPivot.visible = td;
    if (td) {
      const slide = smoother(34.0, 34.35, tn), ramp = smoother(34.3, 34.75, tn);
      hatchPivot.rotation.set(0, fdYaw - podRoot.rotation.y, 0);
      hatchPivot.position.set(0, 0, 0);
      hatchHinge.position.set(0, -podH * 0.5 + podH * 0.07 + 0.0, podR * (0.55 + 0.45 * slide));
      hatchHinge.rotation.x = 1.75 * ramp;
      hatchLight.emissiveIntensity = 3.5 * slide;
    }
    const hp = smoother(34.35, 34.95, tn);
    hero.root.visible = tn >= 34.3 && !delivered;
    if (hero.root.visible) {
      hero.root.position.set(lerp(podLand.x + fd.x * podR * 0.3, L.x, hp), L.y + 0.05 * Math.abs(Math.sin(hp * Math.PI * 4)) * (hp < 1 ? 1 : 0), lerp(podLand.z + fd.z * podR * 0.3, L.z, hp));
      hero.root.rotation.set(0, fdYaw, 0);
    }
    if (!delivered) tickArchetypeMesh(hero.mesh, tn);
    tickArchetypeMesh(pod.mesh, tn); tickArchetypeMesh(carrier.mesh, tn);

    // ---------- camera
    {
      const k = clamp(tn, 3.6, 29), ph = camPhi(k) * D2R, ep = camEps(k) * D2R, D = Math.exp(camLnD(k));
      camPos.set(podCenter.x + D * Math.cos(ep) * Math.cos(ph), podCenter.y + D * Math.sin(ep), podCenter.z + D * Math.cos(ep) * Math.sin(ph));
      camTgt.set(podCenter.x, podCenter.y + camLookY(k), podCenter.z);
      const e = smoother(29, 34, tn);
      if (e > 0) { if (e >= 1) { camPos.copy(FINAL_POS); camTgt.copy(FINAL_TARGET); } else { camPos.lerp(FINAL_POS, e); camTgt.lerp(FINAL_TARGET, e); } }
    }
    // carrier-locked hand-off shot (same carrier-local pose the menu stage dollies into), released as the pod drops
    const cw = 1 - smoother(startAt + 1.4, 6.4, tn);
    camera.up.set(0, 1, 0);
    if (cw > 0) {
      carrier.root.updateWorldMatrix(true, false);
      carrier.root.getWorldQuaternion(cq);
      tmpA.copy(CUT_POSE.cam); carrier.root.localToWorld(tmpA);
      tmpB.copy(CUT_POSE.target); carrier.root.localToWorld(tmpB);
      camPos.lerp(tmpA, cw); camTgt.lerp(tmpB, cw);
      tmpC.copy(CUT_POSE.up).applyQuaternion(cq);
      camera.up.lerp(tmpC, cw).normalize();
    }
    // shake
    const shakeEnv = 1 - smoothstep(31, 33.5, tn);
    const amp = (0.05 * smoothstep(9, 15, tn) + 0.3 * plasmaI + 0.5 * Math.exp(-Math.pow((tn - 24.1) / 0.35, 2)) + 0.05 * thr) * shakeEnv;
    if (amp > 1e-4) {
      camPos.x += amp * (Math.sin(tn * 37.1) + 0.6 * Math.sin(tn * 71.3 + 2));
      camPos.y += amp * (Math.sin(tn * 43.7 + 1) + 0.6 * Math.sin(tn * 67.1 + 4));
      camPos.z += amp * (Math.sin(tn * 31.9 + 3) + 0.6 * Math.sin(tn * 59.3));
    }
    camera.position.copy(camPos);
    camera.fov = 28 + 8 * smoothstep(13, 17, tn) * (1 - smoothstep(25, 31, tn));
    const dPod = camPos.distanceTo(podCenter);
    camera.near = clamp(dPod * 0.02, 0.3, 300);
    camera.far = Math.max(4000, camPos.distanceTo(C) + R * 1.6);
    camera.updateProjectionMatrix();
    camera.lookAt(camTgt);
    camera.updateMatrixWorld();
    const camAlt = Math.max(camPos.y, 1);

    // ---------- sky / fog / globe / lights
    const kSky = smoothstep(26, 31, tn);
    backdrop.uniforms.uSpace.value = 1 - smoothstep(15.5, 21, tn);
    const toSky = smoothstep(17, 25, tn);
    backdrop.uniforms.uZenith.value.copy(atmCol).multiplyScalar(0.22).lerp(skyZ, toSky).lerp(fogC, kSky);
    backdrop.uniforms.uHorizon.value.copy(atmCol).lerp(skyH, toSky).lerp(fogC, kSky);
    backdrop.uniforms.uHorizonH.value = -Math.sin(Math.acos(R / (R + camAlt))) * (1 - kSky);
    backdrop.uniforms.uBandUp.value = 0.35 * smoothstep(8, 19, tn);
    backdrop.uniforms.uBandI.value = 0.9 * dens * smoothstep(7, 12, tn) * (1 - smoothstep(21, 26, tn));
    backdrop.uniforms.uBandColor.value.copy(atmCol);
    backdrop.uniforms.uSunDisc.value = 1 - smoothstep(24, 30, tn);
    backdrop.uniforms.uCloud.value = cb * 0.9;
    backdrop.uniforms.uCloudColor.value.copy(haze);
    backdrop.uniforms.uNebI.value = 0.3;
    backdrop.update(camera, tn);

    bg.copy(fogC).lerp(colA.set(0x000000), 0);
    fog.color.copy(haze).lerp(fogC, kSky);
    const dRamp = smoothstep(14, 19, tn) * FOGMAX;
    fog.density = (tn < 22 ? dRamp : lerp(FOGMAX, spec.sky.fogDensity, smoother(22, 31, tn)) ) * (1 + 3 * cb) * (tn >= 31 ? 1 : 1);
    if (tn >= 31) fog.density = spec.sky.fogDensity;
    surface.group.visible = tn >= 19;

    globe.setOpacity(1 - smoothstep(27, 31, tn));
    globe.shared.uSkyBlend.value = smoothstep(16, 24, tn) * 0.9;
    globe.shared.uSkyColor.value.copy(backdrop.uniforms.uHorizon.value);
    globe.shared.uHazeDist.value.set(100, 9000);
    globe.shared.uCloudNear.value.set(40, 500);
    globe.shared.uAtmStrength.value = smoothstep(140, 420, camAlt);
    globe.shared.uTime.value = tn;

    deck.group.visible = tn > 14;
    deck.u.uVis.value = smoothstep(16, 21, tn);
    deck.u.uCentre.value.set(podCenter.x, podCenter.z); deck.u.uTime.value = tn;

    viewport.sun.color.copy(spaceSun).lerp(sunC, kSky);
    viewport.sun.intensity = lerp(3.4, spec.sky.sunIntensity, kSky);
    viewport.hemi.color.copy(spaceHemi).lerp(hemiC, kSky);
    viewport.hemi.groundColor.copy(spaceHemiG).lerp(hemiG, kSky);
    viewport.hemi.intensity = lerp(0.3, spec.sky.hemiIntensity, kSky);
    viewport.renderer.toneMappingExposure = lerp(1.0, spec.sky.exposure, kSky);
    scene.environmentIntensity = lerp(0.3, saved.envI, smoothstep(20, 30, tn));
    viewport.bloom.strength = saved.bloom + 0.2 * P + 0.15 * thr;
    tmpC.copy(podCenter); viewport.followShadow(tmpC);
    posNoSink.copy(podBase);

    // ---------- telemetry
    const real = tn / tScale;
    tel.t = real; tel.duration = duration; tel.progress = clamp(tn / TL);
    tel.phase = phaseOf(tn);
    tel.altitudeKm = 400 * Math.pow(Math.max(yRel, 0) / Y0, 1.6);
    tel.speedKmh = speedCurve(tn);
    tel.gForce = gCurve(tn) * (0.75 + 0.5 * dens);
    tel.heatPct = heat * 100;
    tel.caption = caption(tn, spec.name);
    for (const cb2 of telCbs) cb2(tel);
  }

  function restoreAndCleanup() {
    // restore camera + lights/sky, remove every temporary object
    surface.group.visible = true;
    camera.up.set(0, 1, 0);
    camera.fov = 28; camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
    camera.position.copy(FINAL_POS); camera.lookAt(FINAL_TARGET); camera.updateMatrixWorld();
    scene.environmentIntensity = saved.envI;
    viewport.bloom.strength = saved.bloom;
    viewport.applySky(spec);
    viewport.followShadow(L);
    hasTop.removeFromParent();
    for (const d of disposables) d.dispose();
    for (const g of [hatchGeo, hatchLightGeo]) g.dispose();
    for (const m of [hatchMat, hatchLight]) m.dispose();
    rig.dispose(); carrier.dispose();
    fxLight.dispose?.();
    if (!delivered) hero.dispose();
    else hero.root.removeFromParent();
  }

  function finish() {
    if (finished) return;
    finished = true;
    t = duration;
    applyFrame(TL, 0);
    const h = handHero();
    restoreAndCleanup();
    for (const c of doneCbs) c(h);
  }

  // hand-off description for the menu stage (carrier-local camera pose + the lighting it must converge to)
  const cq0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02 * Math.sin(startAt * 0.6), 0.3, 0));
  const handoff: DescentHandoff = {
    startAt,
    camLocal: CUT_POSE.cam.clone(), targetLocal: CUT_POSE.target.clone(), upLocal: CUT_POSE.up.clone(),
    sunLocal: sunDir.clone().applyQuaternion(cq0.clone().invert()),
    sunColor: spaceSun.clone(), sunIntensity: 3.4,
    hemiColor: spaceHemi.clone(), hemiGround: spaceHemiG.clone(), hemiIntensity: 0.3,
    exposure: 1.0, envIntensity: 0.3, bloom: saved.bloom,
    bayGlow: bayGlowAt(startAt), podYawLocal: -0.3, carrierScale: carrier.root.scale.x,
    tel: { t: startAt / tScale, duration, progress: clamp(startAt / TL), phase: phaseOf(startAt), altitudeKm: 400, speedKmh: speedCurve(startAt), gForce: 0, heatPct: 0, caption: caption(startAt, spec.name) },
  };

  const api: DescentSequence = {
    duration, handoff,
    finalPose: { position: FINAL_POS.clone(), target: FINAL_TARGET.clone() },
    start() { if (started) return; started = true; t = startAt / tScale; scroll = 0; applyFrame(startAt, 0); },
    update(dt) {
      if (finished || disposed) return false;
      if (!started) api.start();
      const step = Math.min(dt, 0.1);
      t = Math.min(duration, t + step);
      if (t >= duration - 1e-9) { finish(); return false; }
      applyFrame(t * tScale, step * tScale);
      return true;
    },
    skip() { if (!started) started = true; finish(); },
    onTelemetry(cb) { telCbs.push(cb); },
    onComplete(cb) { doneCbs.push(cb); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!finished) { finished = true; restoreAndCleanup(); }
    },
  };
  // QA helper: deterministic seek (re-simulates from 0 in 1/30 s steps)
  (api as DescentSequence & { seek?: (s: number) => void }).seek = (s: number) => {
    if (finished) return;
    t = startAt / tScale; scroll = 0; applyFrame(startAt, 0);
    while (t < s - 1e-9) { const d = Math.min(1 / 30, s - t); t += d; applyFrame(t * tScale, d * tScale); }
  };
  void posNoSink; void tmpC;
  return api;
};
