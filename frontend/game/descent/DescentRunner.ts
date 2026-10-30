import * as THREE from 'three';
import type { DescentHandoff, DescentOptions, DescentSequence, DescentTelemetry } from './types';
import { acquireModel } from '@shared/engine/visuals/space/placeholders';
import { clamp } from './math';
import { altCurve, Telemetry } from './timeline';
import { createDropRig, CUT_POSE } from './dropRig';
import { FINAL_POS, FINAL_TARGET, R, TL } from './constants';
import { FrameState, type DescentContext, type FramePart } from './parts/FrameState';
import { Trajectory } from './parts/Trajectory';
import { bayGlowAt, CarrierBay } from './parts/CarrierBay';
import { HeatShield } from './parts/HeatShield';
import { ReentryFx } from './parts/ReentryFx';
import { ChuteFx } from './parts/ChuteFx';
import { RetroFlames } from './parts/RetroFlames';
import { GroundFx } from './parts/GroundFx';
import { Touchdown } from './parts/Touchdown';
import { CameraRig } from './parts/CameraRig';
import { prepareSceneSky, SkyRig, SPACE_HEMI, SPACE_HEMI_GROUND, SPACE_SUN, SPACE_SUN_INTENSITY } from './parts/SkyRig';

/**
 * The ~35 s descent cinematic. Orchestrates single-purpose frame parts (pod kinematics, carrier bay, heat shield,
 * reentry fx, chute, retro flames, ground fx, touchdown, camera, sky) that each update from the shared `FrameState`.
 */
export class DescentRunner implements DescentSequence {
  readonly duration: number;
  readonly handoff: DescentHandoff;
  readonly finalPose = { position: FINAL_POS.clone(), target: FINAL_TARGET.clone() };

  private ctx: DescentContext;
  private f = new FrameState();
  private tel = new Telemetry(0, '', 0, 1);
  private telOut: DescentTelemetry;
  private tScale: number;
  private startAt: number;
  private podRoot = new THREE.Group();
  private podH: number;
  private sky: SkyRig; private cam: CameraRig; private touchdown: Touchdown;
  /** Update order matters (e.g. the camera reads the pod pose, the sky reads the camera). */
  private parts: FramePart[];
  private disposeOrder: FramePart[];
  private t = 0;
  private started = false; private finished = false; private disposed = false;
  private telCbs: ((x: DescentTelemetry) => void)[] = [];
  private doneCbs: ((h: THREE.Object3D) => void)[] = [];

  constructor(opts: DescentOptions) {
    const { viewport, scene, camera, spec, surface } = opts;
    this.duration = opts.duration ?? 35;
    this.startAt = clamp(opts.startAt ?? 0, 0, 30); // authored seconds to begin at (2 = carrier hand-off, bay arming)
    this.tScale = TL / this.duration;
    const dens = spec.orbital.atmosphereDensity;
    this.tel = new Telemetry(dens, spec.name, this.duration, this.tScale);
    prepareSceneSky(scene, spec);

    const traj = new Trajectory(surface);
    const root = new THREE.Group(); root.name = 'descent:root';
    const sunDir = new THREE.Vector3(35, 55, 25).normalize();
    this.ctx = { viewport, scene, camera, spec, surface, dens, startAt: this.startAt, tScale: this.tScale, sunDir, traj, root };

    // ---- models (carrier + shared drop rig: bay plate, clamp arms, pod, heat shield — identical to the menu stage's)
    const carrier = acquireModel('ship.carrier', spec.biomeKey, { size: 34, mode: 'max', minRatio: 0.45, maxRatio: 1.8 });
    const rig = createDropRig(carrier.root, { biomeKey: spec.biomeKey, carrierScale: carrier.root.scale.x, attachPod: false });
    const pod = rig.pod, podH = rig.podH, podR = rig.podR;
    this.podH = podH;
    const hero = acquireModel('robot.hero', spec.biomeKey);
    const podRoot = this.podRoot; podRoot.rotation.order = 'YXZ'; podRoot.name = 'descent:podRoot';
    podRoot.add(rig.podRig);
    this.touchdown = new Touchdown(this.ctx, podRoot, pod, carrier, hero, podH, podR);
    scene.add(root);
    root.add(podRoot, carrier.root, hero.root);

    // ---- environment objects (construction order == scene child order)
    this.sky = new SkyRig(this.ctx);
    const reentry = new ReentryFx(this.ctx, podR, podH);
    const flames = new RetroFlames(podRoot, pod);
    const chute = new ChuteFx(this.ctx, podRoot, podH, podR);
    const ground = new GroundFx(this.ctx);
    const bay = new CarrierBay(this.ctx, carrier, rig, pod, podH);
    const shield = new HeatShield(this.ctx, rig, podH);
    this.cam = new CameraRig(this.ctx, carrier);

    this.parts = [bay, shield, reentry, chute, flames, ground, this.touchdown, this.cam, this.sky];
    this.disposeOrder = [this.sky, reentry, flames, chute, ground, this.touchdown, bay];
    this.telOut = this.tel.at(0);
    this.handoff = this.buildHandoff(carrier.root.scale.x);
  }

  /** Hand-off description for the menu stage (carrier-local camera pose + the lighting it must converge to). */
  private buildHandoff(carrierScale: number): DescentHandoff {
    const { startAt, podH } = this, { traj, sunDir } = this.ctx;
    const cq0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02 * Math.sin(startAt * 0.6), 0.3, 0));
    const h: DescentHandoff = {
      startAt,
      camLocal: CUT_POSE.cam.clone(), targetLocal: CUT_POSE.target.clone(), upLocal: CUT_POSE.up.clone(),
      sunLocal: sunDir.clone().applyQuaternion(cq0.clone().invert()),
      sunColor: SPACE_SUN.clone(), sunIntensity: SPACE_SUN_INTENSITY,
      hemiColor: SPACE_HEMI.clone(), hemiGround: SPACE_HEMI_GROUND.clone(), hemiIntensity: 0.3,
      exposure: 1.0, envIntensity: 0.3, bloom: this.sky.savedBloom,
      bayGlow: bayGlowAt(startAt), podYawLocal: -0.3, carrierScale,
      tel: this.tel.at(Math.min(startAt, 2.6)),
      telAt: this.tel.at,
      R, centre: traj.C.clone(), fov: CameraRig.fov(startAt),
      pod: new THREE.Vector3(), podQuat: new THREE.Quaternion(), cam: new THREE.Vector3(), camTarget: new THREE.Vector3(),
      sunDir: sunDir.clone(), podH,
    };
    const pb = traj.pos(startAt, new THREE.Vector3());
    h.pod.set(pb.x, pb.y + podH / 2, pb.z);
    h.podQuat.setFromEuler(traj.podRot(startAt, new THREE.Euler()));
    CameraRig.curve(startAt, h.pod, h.cam, h.camTarget);
    return h;
  }

  alignGlobe(spinQuat: THREE.Quaternion, cloudRotY: number) {
    this.sky.globe.spin.quaternion.copy(spinQuat);
    this.sky.globe.clouds.rotation.y = cloudRotY;
  }

  start() { if (this.started) return; this.started = true; this.rewind(); }

  update(dt: number) {
    if (this.finished || this.disposed) return false;
    if (!this.started) this.start();
    const step = Math.min(dt, 0.1);
    this.t = Math.min(this.duration, this.t + step);
    if (this.t >= this.duration - 1e-9) { this.finish(); return false; }
    this.applyFrame(this.t * this.tScale, step * this.tScale);
    return true;
  }

  skip() { if (!this.started) this.started = true; this.finish(); }
  onTelemetry(cb: (t: DescentTelemetry) => void) { this.telCbs.push(cb); }
  onComplete(cb: (hero: THREE.Object3D) => void) { this.doneCbs.push(cb); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.finished) { this.finished = true; this.restoreAndCleanup(); }
  }

  /** QA helper: deterministic seek (re-simulates from 0 in 1/30 s steps). */
  seek(s: number) {
    if (this.finished) return;
    this.rewind();
    while (this.t < s - 1e-9) { const d = Math.min(1 / 30, s - this.t); this.t += d; this.applyFrame(this.t * this.tScale, d * this.tScale); }
  }

  private rewind() {
    this.t = this.startAt / this.tScale;
    for (const p of this.parts) p.reset?.();
    this.applyFrame(this.startAt, 0);
  }

  private applyFrame(tn: number, dtn: number) {
    const f = this.f, { traj, dens } = this.ctx;
    f.tn = tn; f.dtn = dtn;
    // pod kinematics
    traj.pos(tn, f.podBase);
    f.podCenter.set(f.podBase.x, f.podBase.y + this.podH / 2, f.podBase.z);
    this.podRoot.position.copy(f.podCenter);
    traj.podRot(tn, this.podRoot.rotation);
    f.yRel = altCurve(tn);
    f.setEnvelopes(dens);
    for (const p of this.parts) p.update(f);
    this.tel.fill(this.telOut, tn, f.heat);
    for (const cb of this.telCbs) cb(this.telOut);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.t = this.duration;
    this.applyFrame(TL, 0);
    const h = this.touchdown.handHero();
    this.restoreAndCleanup();
    for (const c of this.doneCbs) c(h);
  }

  /** Restore camera + lights/sky, remove every temporary object. */
  private restoreAndCleanup() {
    this.ctx.surface.group.visible = true;
    this.cam.restore();
    this.sky.restore();
    this.ctx.root.removeFromParent();
    for (const p of this.disposeOrder) p.dispose?.();
  }
}

