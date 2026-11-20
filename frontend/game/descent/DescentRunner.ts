import * as THREE from 'three';
import { isDayNightExternalSync, stepStandaloneDayNight } from '@terra/render/core/dayNightConfig';
import { enqueueDeferredDispose } from '@terra/render/core/deferredDispose';
import type { DescentHandoff, DescentOptions, DescentPrestige, DescentSequence, DescentTelemetry } from '@terra/render/descent/types';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { acquireModel } from '@terra/render/visuals/space/placeholders';
import { setDescentSunDirection } from '@terra/render/core/shadowConfig';
import { clamp } from './math';
import { altCurve, Telemetry } from './timeline';
import { createDropRig, CUT_POSE } from '@terra/render/descent/dropRig';
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
import { computeSpaceEntrySolar, DescentSolarEvaluator } from './parts/descentSolarSync';
import { prepareSceneSky, SkyRig } from './parts/SkyRig';

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
  private sky: SkyRig; private cam: CameraRig; private touchdown: Touchdown; private ground: GroundFx;
  /** Update order matters (e.g. the camera reads the pod pose, the sky reads the camera). */
  private parts: FramePart[];
  private disposeOrder: FramePart[];
  private readonly deferPartDispose: boolean;
  private partsDisposed = false;
  private t = 0;
  private started = false; private finished = false; private disposed = false;
  private telCbs: ((x: DescentTelemetry) => void)[] = [];
  private doneCbs: ((h: THREE.Object3D) => void)[] = [];

  constructor(opts: DescentOptions) {
    const { viewport, scene, camera, spec, surface } = opts;
    this.deferPartDispose = Boolean(opts.deferPartDispose);
    this.duration = opts.duration ?? 35;
    this.startAt = clamp(opts.startAt ?? 0, 0, 30); // authored seconds to begin at (2 = carrier hand-off, bay arming)
    this.tScale = TL / this.duration;
    const dens = spec.orbital.atmosphereDensity;
    this.tel = new Telemetry(dens, spec.name, this.duration, this.tScale, spec.kind);
    prepareSceneSky(scene, spec);

    const traj = new Trajectory(surface);
    const root = new THREE.Group(); root.name = 'descent:root';
    const initSpace = computeSpaceEntrySolar(new DescentSolarEvaluator().evaluate(spec, 0), viewport.bloom.strength);
    const sunDir = initSpace.entrySunDir.clone();
    this.ctx = { viewport, scene, camera, spec, surface, dens, startAt: this.startAt, tScale: this.tScale, sunDir, traj, root, prestige: opts.prestige };
    setDescentSunDirection(viewport, sunDir); // key light + shadows from the same sun as globe/clouds (RN-42)

    // ---- models (carrier + shared drop rig: bay plate, clamp arms, pod, heat shield — identical to the menu stage's)
    const carrier = acquireModel('ship.carrier', spec.biomeKey, { size: 34, mode: 'max', minRatio: 0.45, maxRatio: 1.8 }, { spaceLit: true });
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
    this.sky = new SkyRig(this.ctx, opts.precomputedGlobeSpheres);
    const reentry = new ReentryFx(this.ctx, podR, podH);
    const flames = new RetroFlames(podRoot, pod);
    const chute = new ChuteFx(this.ctx, podRoot, podH, podR);
    this.ground = new GroundFx(this.ctx);
    const bay = new CarrierBay(this.ctx, carrier, rig, pod, podH);
    const shield = new HeatShield(this.ctx, rig, podH);
    this.cam = new CameraRig(this.ctx, carrier);

    this.parts = [bay, shield, reentry, chute, flames, this.ground, this.touchdown, this.cam, this.sky];
    this.disposeOrder = [this.sky, reentry, flames, chute, this.ground, this.touchdown, bay];
    this.telOut = this.tel.at(0);
    this.handoff = this.buildHandoff(carrier.root.scale.x);
  }

  /** Hand-off description for the menu stage (carrier-local camera pose + the lighting it must converge to). */
  private buildHandoff(carrierScale: number): DescentHandoff {
    const { startAt, podH } = this, { traj, sunDir, spec } = this.ctx;
    const space = computeSpaceEntrySolar(this.sky.solarEval.evaluate(spec, 0), this.sky.savedBloom);
    sunDir.copy(space.entrySunDir);
    const cq0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02 * Math.sin(startAt * 0.6), 0.3, 0));
    const h: DescentHandoff = {
      startAt,
      camLocal: CUT_POSE.cam.clone(), targetLocal: CUT_POSE.target.clone(), upLocal: CUT_POSE.up.clone(),
      sunLocal: sunDir.clone().applyQuaternion(cq0.clone().invert()),
      sunColor: space.sunColor.clone(), sunIntensity: space.sunIntensity, sunDisc: space.spaceLit,
      hemiColor: space.hemiColor.clone(), hemiGround: space.hemiGround.clone(), hemiIntensity: space.hemiIntensity,
      exposure: space.exposure, envIntensity: space.envIntensity, bloom: space.bloom,
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

  setPrestige(prestige: DescentPrestige | undefined) { this.ctx.prestige = prestige; }

  alignGlobe(spinQuat: THREE.Quaternion, cloudRotY: number) {
    this.ctx.globeAligned = true;
    this.sky.globe.spin.quaternion.copy(spinQuat);
    this.sky.globe.clouds.rotation.y = cloudRotY;
  }

  syncHandoffSolar(opts?: { updateEntryDir?: boolean; dtSec?: number }): boolean {
    if (this.started || this.finished || this.disposed) return false;
    const dtSec = opts?.dtSec ?? 0;
    const updateEntryDir = opts?.updateEntryDir ?? true;
    if (dtSec <= 0) this.sky.solarEval.reset();
    const space = computeSpaceEntrySolar(this.sky.solarEval.evaluate(this.ctx.spec, dtSec), this.sky.savedBloom);
    const dirChanged = updateEntryDir && this.handoff.sunDir.distanceToSquared(space.entrySunDir) > 1e-5;
    const lightChanged =
      Math.abs(this.handoff.sunIntensity - space.sunIntensity) > 1e-3 ||
      Math.abs((this.handoff.sunDisc ?? 1) - space.spaceLit) > 1e-3 ||
      Math.abs(this.handoff.sunColor.r - space.sunColor.r) + Math.abs(this.handoff.sunColor.b - space.sunColor.b) > 2e-3;
    if (updateEntryDir) {
      this.ctx.sunDir.copy(space.entrySunDir);
      setDescentSunDirection(this.ctx.viewport, this.ctx.sunDir);
      this.sky.syncEntrySun(this.ctx.sunDir);
      const cq0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02 * Math.sin(this.startAt * 0.6), 0.3, 0));
      this.handoff.sunDir.copy(space.entrySunDir);
      this.handoff.sunLocal.copy(space.entrySunDir).applyQuaternion(cq0.invert());
    }
    this.handoff.sunColor.copy(space.sunColor);
    this.handoff.sunIntensity = space.sunIntensity;
    this.handoff.sunDisc = space.spaceLit;
    this.handoff.hemiColor.copy(space.hemiColor);
    this.handoff.hemiGround.copy(space.hemiGround);
    this.handoff.hemiIntensity = space.hemiIntensity;
    this.handoff.envIntensity = space.envIntensity;
    this.handoff.exposure = space.exposure;
    this.handoff.bloom = space.bloom;
    this.tel.fill(this.handoff.tel, Math.min(this.startAt, 2.6));
    return dirChanged || lightChanged;
  }

  syncPlanetSpec(spec: PlanetSpec) {
    if (this.ctx.spec.kind === spec.kind && this.ctx.spec.name === spec.name) return;
    this.sky.setPlanetSpec(spec);
    this.ground.setPlanetKind(spec.kind, spec.seed);
    this.tel.setPlanet(spec.orbital.atmosphereDensity, spec.name, spec.kind);
    if (!this.started) this.syncHandoffSolar();
  }

  setExternalGround(active: boolean) {
    this.ctx.traj.externalGround = active;
  }

  start() { if (this.started) return; this.started = true; this.rewind(false); }

  update(dt: number) {
    if (this.finished || this.disposed) return false;
    if (!this.started) this.start();
    const step = Math.min(dt, 0.1);
    if (step > 0 && !isDayNightExternalSync()) {
      stepStandaloneDayNight(step);
    }
    this.t = Math.min(this.duration, this.t + step);
    if (this.t >= this.duration - 1e-9) { this.finish(); return false; }
    this.applyFrame(this.t * this.tScale, step * this.tScale);
    return true;
  }

  skip() { if (!this.started) this.started = true; this.finish(); }
  onTelemetry(cb: (t: DescentTelemetry) => void) { this.telCbs.push(cb); }
  onComplete(cb: (hero: THREE.Object3D) => void) { this.doneCbs.push(cb); }

  disposeDeferred() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.finished) {
      this.finished = true;
      this.restoreSceneState();
    }
    this.disposeParts(true);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.finished) {
      this.finished = true;
      this.restoreSceneState();
    }
    this.disposeParts(false);
  }

  /** QA helper: deterministic seek (re-simulates from 0 in 1/30 s steps). */
  seek(s: number) {
    if (this.finished) return;
    this.rewind();
    while (this.t < s - 1e-9) { const d = Math.min(1 / 30, s - this.t); this.t += d; this.applyFrame(this.t * this.tScale, d * this.tScale); }
  }

  private rewind(resetSolar = true) {
    this.t = this.startAt / this.tScale;
    this.tel.resetPeak();
    for (const p of this.parts) {
      if (p === this.sky && !resetSolar) continue;
      p.reset?.();
    }
    this.applyFrame(this.startAt, 0);
  }

  private applyFrame(tn: number, dtn: number) {
    const f = this.f, { traj, dens, spec, tScale } = this.ctx;
    f.tn = tn; f.dtn = dtn;
    f.solar = this.sky.solarEval.evaluate(spec, dtn / tScale);
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
    this.restoreSceneState();
    this.disposeParts(this.deferPartDispose);
    for (const c of this.doneCbs) c(h);
  }

  /** Restore camera + lights/sky and detach temporary objects immediately (< 0.05 ms). */
  private restoreSceneState() {
    this.ctx.surface.group.visible = true;
    this.ctx.root.removeFromParent();
    setDescentSunDirection(this.ctx.viewport, null);
    this.cam.restore();
    this.sky.restore();
  }

  private disposeParts(defer: boolean) {
    if (this.partsDisposed) return;
    this.partsDisposed = true;
    const order = this.disposeOrder.splice(0);
    if (!defer) {
      for (const p of order) p.dispose?.();
      return;
    }
    for (const p of order) {
      if (p === this.sky) this.sky.disposeDeferred();
      else enqueueDeferredDispose(() => p.dispose?.());
    }
  }
}
