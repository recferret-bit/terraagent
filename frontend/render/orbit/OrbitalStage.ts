import * as THREE from 'three';
import type { CreateOrbitalStage, OrbitalStage } from './types';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { ColonyViewport } from '../core/createColonyViewport';
import type { DescentHandoff } from '../descent/types';
import { createSpaceBackdrop, type SpaceBackdrop } from '../visuals/space/SpaceBackdrop';
import { createParallaxLayers, type ParallaxLayers } from '../visuals/space/ParallaxLayers';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../visuals/space/placeholders';
import { StageGlobes, CAM_DIST } from './stage/StageGlobes';
import { StageMoons } from './stage/StageMoons';
import { Satellites } from './stage/Satellites';
import { SunRig } from './stage/SunRig';
import { NebulaTint } from './stage/NebulaTint';
import { updateIdleCamera, driftCarrier } from './stage/idle';
import { DeploySequence } from './deploy/DeploySequence';

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
  private readonly moons: StageMoons;
  private readonly satellites: Satellites;
  private readonly nebula: NebulaTint;
  private readonly carrier: FittedModel;
  private readonly deploy: DeploySequence;

  constructor(private readonly viewport: ColonyViewport, spec: PlanetSpec) {
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
    this.carrier = acquireModel('ship.carrier', 'dune', { size: 6.0, mode: 'max', minRatio: 0.8, maxRatio: 1.25 });
    this.carrier.root.rotation.order = 'YXZ';
    scene.add(this.carrier.root);
    this.moons = new StageMoons(scene, sunDir, spec);
    this.satellites = new Satellites(scene);
    this.nebula = new NebulaTint(spec, this.backdrop.uniforms.uNebA, this.layers);
    this.deploy = new DeploySequence({ scene, camera: this.camera, viewport, sunDir, sun: this.sun, carrier: this.carrier, globes: this.globes, lookNow: this.lookNow });
  }

  beginDeploy(h: DescentHandoff, opts: { biomeKey?: string } = {}) { return this.deploy.begin(h, opts); }
  deployProgress() { return this.deploy.progress(); }
  deployTn() { return this.deploy.tn(); }
  setTerraform(stage: number, smooth?: boolean) { this.globes.current.setTerraform(stage, smooth); }
  setSpinRate(r: number) { this.globes.setSpinRate(r); }

  setPlanet(next: PlanetSpec, opts: { duration?: number; continuousSpin?: boolean } = {}) {
    if (!this.globes.setPlanet(next, opts)) return;
    this.nebula.retarget(next);
    this.moons.setPlanet(next);
  }

  update(dt: number, time: number) {
    const { globes, camera, sun } = this;
    const deploying = this.deploy.active;
    if (!deploying) globes.place(dt);
    globes.updateFade(dt);
    if (!deploying) globes.updateGlobes(dt, time);
    this.nebula.update(dt, globes.morphRate);

    if (deploying) this.deploy.update(dt, time);
    else { sun.smoothMouse(dt); updateIdleCamera(camera, this.lookNow, this.camBase, sun.mouseS, globes.planetPos, time); }
    this.backdrop.update(camera, time);
    this.layers.update(dt, time);
    sun.update(camera, time, globes.planetPos);
    this.moons.update(dt, time, globes.planetPos, globes.morphRate);
    this.satellites.update(time, globes.planetPos);
    if (!deploying) driftCarrier(this.carrier, globes.planetPos, time);
    tickArchetypeMesh(this.carrier.mesh, time);
  }

  dispose() {
    const { camera } = this;
    this.globes.dispose();
    this.layers.dispose(); this.moons.dispose(); this.satellites.dispose();
    this.deploy.dispose();
    camera.near = 0.5; camera.fov = 28; camera.updateProjectionMatrix();
    this.backdrop.dispose(); this.sun.dispose(this.scene); this.carrier.dispose();
    this.scene.environment = null;
  }
}

export const createOrbitalStage: CreateOrbitalStage = (viewport, spec) => new OrbitalStageImpl(viewport, spec);
