import * as THREE from 'three';
import type { CreateOrbitalStage, OrbitalGlobeMarkerInput, OrbitalLeadPatron, OrbitalProjectedFrame, OrbitalStage } from './types';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { ColonyViewport } from '../core/createColonyViewport';
import { enqueueDeferredDispose } from '../core/deferredDispose';
import type { DescentHandoff } from '../descent/types';
import { createSpaceBackdrop, type SpaceBackdrop } from '../visuals/space/SpaceBackdrop';
import { createParallaxLayers, type ParallaxLayers } from '../visuals/space/ParallaxLayers';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../visuals/space/placeholders';
import { StageGlobes, CAM_DIST } from './stage/StageGlobes';
import { StageMoons } from './stage/StageMoons';
import { Satellites } from './stage/Satellites';
import { FlagshipCarrier } from './stage/FlagshipCarrier';
import { SunRig } from './stage/SunRig';
import { NebulaTint } from './stage/NebulaTint';
import { GlobeHighlights } from './stage/GlobeHighlights';
import { updateIdleCamera, driftCarrier } from './stage/idle';
import { DeploySequence } from './deploy/DeploySequence';
import { OrbitalCameraDive, type OrbitalCameraDiveOptions } from './deploy/OrbitalCameraDive';

/**
 * Interactive menu backdrop: procedural planet globe (right of frame, UI-safe left), nebula + stars, a sun with
 * lens-flare glow and the ship.carrier hovering in orbit. Own scene + 28° telephoto camera — hand them to
 * `viewport.setView(stage.scene, stage.camera)`. Thin orchestrator: each concern lives in `stage/` or `deploy/`.
 */
class OrbitalStageImpl implements OrbitalStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly camBase = new THREE.Vector3(0, 1.4, CAM_DIST);
  private readonly lookNow = new THREE.Vector3(0, 0.3, 0);
  private readonly sunDir = new THREE.Vector3(0.62, 0.3, 0.55).normalize();
  private readonly backdrop: SpaceBackdrop;
  private readonly layers: ParallaxLayers;
  private readonly sun: SunRig;
  private readonly globes: StageGlobes;
  private readonly highlights: GlobeHighlights;
  private readonly moons: StageMoons;
  private readonly satellites: Satellites;
  private readonly flagship: FlagshipCarrier;
  private readonly nebula: NebulaTint;
  private readonly carrier: FittedModel;
  private readonly deploy: DeploySequence;
  private readonly cameraDive: OrbitalCameraDive;
  private readonly viewport: ColonyViewport;
  private lastTime = 0;
  private disposed = false;

  constructor(viewport: ColonyViewport, spec: PlanetSpec) {
    this.viewport = viewport;
    const { scene, sunDir } = this;
    scene.background = new THREE.Color(0x01020a);
    scene.environment = viewport.environment;
    scene.environmentIntensity = 0.4;

    const sc = viewport.renderer.domElement;
    const aspect = () => (sc.clientWidth || window.innerWidth) / Math.max(1, sc.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(28, aspect(), 0.5, 4000);
    this.camera.position.copy(this.camBase);

    this.backdrop = createSpaceBackdrop({ seed: 4242, sunDir });
    scene.add(this.backdrop.group);
    this.sun = new SunRig(scene, sunDir);
    // parallax depth layers (3 star layers, nebula planes, distant planets, asteroids, foreground motes)
    this.layers = createParallaxLayers({ seed: 9091, camDist: CAM_DIST, sunDir, aspect });
    scene.add(this.layers.group);

    this.globes = new StageGlobes(scene, sunDir, spec, aspect);
    this.highlights = new GlobeHighlights(scene);
    this.carrier = acquireModel('ship.carrier', 'dune', { size: 6.0, mode: 'max', minRatio: 0.8, maxRatio: 1.25 }, { spaceLit: true });
    this.carrier.root.rotation.order = 'YXZ';
    scene.add(this.carrier.root);
    this.moons = new StageMoons(scene, sunDir, spec);
    this.satellites = new Satellites(scene);
    this.flagship = new FlagshipCarrier(scene);
    this.nebula = new NebulaTint(spec, this.backdrop.uniforms.uNebA, this.layers);
    const deployHost = { scene, camera: this.camera, viewport, sunDir, sun: this.sun, backdrop: this.backdrop, carrier: this.carrier, globes: this.globes, lookNow: this.lookNow };
    this.deploy = new DeploySequence(deployHost);
    this.cameraDive = new OrbitalCameraDive(deployHost);
  }

  beginDeploy(h: DescentHandoff, opts: { biomeKey?: string } = {}) {
    const res = this.deploy.begin(h, opts);
    try { this.viewport.renderer.compile?.(this.scene, this.camera); } catch { /* headless fallback */ }
    return res;
  }
  retargetDeploy(h: DescentHandoff) { return this.deploy.retarget(h); }
  deployProgress() { return this.deploy.progress(); }
  deployTn() { return this.deploy.tn(); }
  beginCameraDive(opts?: OrbitalCameraDiveOptions) { this.cameraDive.begin(opts); }
  cameraDiveProgress() { return this.cameraDive.progress(); }
  setTerraform(stage: number, smooth?: boolean) { this.globes.current.setTerraform(stage, smooth); }
  setSpinRate(r: number) { this.globes.setSpinRate(r); }
  setHighlights(markers: readonly OrbitalGlobeMarkerInput[]) {
    const target = markers.find((m) => m.role === 'target');
    this.globes.setContinentLock(markers.length > 0, target ? -target.yaw * 0.28 : 0);
    this.highlights.setHighlights(markers);
  }
  projectHighlights(): OrbitalProjectedFrame {
    const frame = this.highlights.project(this.camera, this.globes.planetPos, this.lastTime, this.sun.mouseS);
    const flagship = this.flagship.project(this.camera);
    return flagship ? { ...frame, flagship } : frame;
  }
  setLeadPatron(patron: OrbitalLeadPatron | null) { this.flagship.setLeadPatron(patron); }

  setPlanet(next: PlanetSpec, opts: { duration?: number; continuousSpin?: boolean } = {}) {
    if (!this.globes.setPlanet(next, opts)) return;
    this.flagship.setLeadPatron(null); // a patron belongs to one planet; the app re-sets it for the new one
    this.nebula.retarget(next);
    this.moons.setPlanet(next);
  }

  update(dt: number, time: number) {
    this.lastTime = time;
    const { globes, camera, sun } = this;
    const deploying = this.deploy.active;
    const diving = this.cameraDive.active;
    const transitioning = deploying || diving;
    if (!transitioning) globes.place(dt);
    globes.updateFade(dt);
    if (!transitioning) globes.updateGlobes(dt, time);
    this.nebula.update(dt, globes.morphRate);

    if (deploying) this.deploy.update(dt, time);
    else if (diving) this.cameraDive.update(dt);
    else { sun.smoothMouse(dt); updateIdleCamera(camera, this.lookNow, this.camBase, sun.mouseS, globes.planetPos, time); }
    const showHl = !deploying && (!diving || this.cameraDive.progress() < 0.45);
    this.highlights.setVisible(showHl);
    if (showHl) this.highlights.update(globes.current, globes.planetPos, camera, dt, time);
    this.backdrop.update(camera, time);
    this.layers.update(dt, time);
    sun.update(camera, time, globes.planetPos);
    this.moons.update(dt, time, globes.planetPos, globes.morphRate);
    this.satellites.update(time, globes.planetPos);
    this.flagship.update(time, globes.planetPos, !transitioning);
    if (!transitioning) driftCarrier(this.carrier, globes.planetPos, time);
    tickArchetypeMesh(this.carrier.mesh, time);
  }

  disposeDeferred() {
    if (this.disposed) return;
    this.disposed = true;
    const { camera, scene } = this;
    camera.near = 0.5; camera.fov = 28; camera.updateProjectionMatrix();
    scene.environment = null;
    this.globes.disposeDeferred();
    enqueueDeferredDispose(
      () => this.highlights.dispose(),
      () => this.layers.dispose(),
      () => this.moons.dispose(),
      () => this.satellites.dispose(),
      () => this.flagship.dispose(),
      () => this.deploy.dispose(),
      () => this.cameraDive.dispose(),
      () => this.backdrop.dispose(),
      () => this.sun.dispose(scene),
      () => this.carrier.dispose(),
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const { camera } = this;
    this.globes.dispose();
    this.highlights.dispose();
    this.layers.dispose(); this.moons.dispose(); this.satellites.dispose(); this.flagship.dispose();
    this.deploy.dispose();
    this.cameraDive.dispose();
    camera.near = 0.5; camera.fov = 28; camera.updateProjectionMatrix();
    this.backdrop.dispose(); this.sun.dispose(this.scene); this.carrier.dispose();
    this.scene.environment = null;
  }
}

export const createOrbitalStage: CreateOrbitalStage = (viewport, spec) => new OrbitalStageImpl(viewport, spec);
