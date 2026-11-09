import { MotionTrack } from '@terra/render/motion/entityMotion';
import { placeTickPose } from '@terra/render/motion/pose';
import * as THREE from 'three';
import { parseWaves } from '@terra/contracts';
import { tickArchetypeMesh, type ArchetypeMesh } from '@terra/render/kitbash';
import {
  createPlanet,
  createRegistryPipeline,
  ENTITY_KIND,
  ENTITY_STATE,
  getMotion,
  getUnitCommand,
  rowOf,
  step,
  type Pipeline,
  type PlanetState,
  type SimCommand,
} from '@terra/sim';
import { buildSafeArchetypeMesh, FAUNA_TICK_MS } from './faunaSimHelpers';
import { MarchMarkers } from './marchMarkers';
import {
  MARCH_ANCHOR,
  MARCH_RADIUS,
  MARCH_ROCKS,
  marchWorld,
  spawnMarchUnits,
  stampMarchGround,
  stampMarchRocks,
} from './marchSetup';

export type MarchPace = 'own' | 'together';

export interface MarchUnitView {
  id: number;
  kind: number;
  x: number;
  y: number;
  q: number;
  r: number;
  state: number;
}

export interface MarchStats {
  active: boolean;
  pace: MarchPace;
  rock: boolean;
  tick: number;
  units: number;
  moving: number;
  arrived: number;
  distinct: number;
  anchor: string;
}

interface Visual {
  id: number;
  mesh: ArchetypeMesh;
  track: MotionTrack;
  walk: number;
}

const FLAGS = parseWaves('..01');

/**
 * Real `moveGroup` march: 30 units, one shared field.
 * Meshes travel at constant speed between sim ticks (200 ms). A chase onto each tick then a hold reads as a hop.
 */
export class MarchSceneHost {
  readonly group = new THREE.Group();
  private sim: PlanetState | null = null;
  private pipeline: Pipeline | null = null;
  private markers: MarchMarkers | null = null;
  private visuals: Visual[] = [];
  private ids: number[] = [];
  private tankId = 0;
  private pace: MarchPace = 'own';
  private rock = false;
  private biomeKey = 'dune';
  private paused = false;
  private orderPending = false;
  private accumMs = 0;
  /** True after a manual step or rebuild: the mesh shows the latest sim pose. Playback clears it. */
  private caughtUp = true;
  private active = false;

  constructor(parent?: THREE.Object3D) {
    this.group.name = 'MarchSceneHost';
    this.group.visible = false;
    parent?.add(this.group);
  }

  get tank(): number {
    return this.tankId;
  }

  setActive(on: boolean, opts?: { pace?: MarchPace; rock?: boolean; biomeKey?: string }): void {
    if (opts?.pace) this.pace = opts.pace;
    if (opts?.rock !== undefined) this.rock = opts.rock;
    if (opts?.biomeKey) this.biomeKey = opts.biomeKey;
    if (!on) {
      this.clear();
      this.active = false;
      this.group.visible = false;
      return;
    }
    this.rebuild();
  }

  setPace(pace: MarchPace): void {
    this.pace = pace;
    if (this.active) this.rebuild();
  }

  setRock(rock: boolean): void {
    this.rock = rock;
    if (this.active) this.rebuild();
  }

  reset(): void {
    if (this.active) this.rebuild();
  }

  order(): void {
    this.orderPending = true;
    this.stepTicks(1);
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  stepTicks(count: number): void {
    if (!this.sim || !this.pipeline) return;
    const n = Math.max(0, Math.trunc(count));
    for (let i = 0; i < n; i++) this.stepOnce();
    if (n > 0) this.showLatest();
  }

  /** World position currently drawn for `id`. The sim pose from `units()` can be ahead of this. */
  drawn(id: number): { x: number; z: number } | null {
    const vis = this.visuals.find((v) => v.id === id);
    return vis ? { x: vis.mesh.position.x, z: vis.mesh.position.z } : null;
  }

  update(dt: number, time: number): void {
    if (!this.active || !this.sim) return;
    let stepped = false;
    if (!this.paused && dt > 0) {
      this.accumMs += dt * 1000;
      while (this.accumMs >= FAUNA_TICK_MS) {
        this.accumMs -= FAUNA_TICK_MS;
        this.stepOnce();
        stepped = true;
      }
    }
    if (stepped) this.caughtUp = false;
    const u = this.caughtUp ? 1 : this.accumMs / FAUNA_TICK_MS;
    this.placeMeshes(u, this.paused ? 0 : dt);
    for (const vis of this.visuals) tickArchetypeMesh(vis.mesh, time, vis.walk, 0);
  }

  units(): MarchUnitView[] {
    if (!this.sim) return [];
    const cols = this.sim.entities.cols;
    return this.ids.map((id) => {
      const row = rowOf(this.sim!.entities, id);
      return { id, kind: cols.kind[row]!, x: cols.x[row]!, y: cols.y[row]!, q: cols.q[row]!, r: cols.r[row]!, state: cols.state[row]! };
    });
  }

  getStats(): MarchStats {
    const units = this.units();
    const tiles = new Set(units.map((u) => `${u.q},${u.r}`));
    const arrived = units.filter((u) => this.sim && getUnitCommand(this.sim, u.id) === null && u.state !== ENTITY_STATE.moving).length;
    return {
      active: this.active,
      pace: this.pace,
      rock: this.rock,
      tick: this.sim?.meta.tick ?? 0,
      units: units.length,
      moving: units.filter((u) => u.state === ENTITY_STATE.moving).length,
      arrived,
      distinct: tiles.size,
      anchor: `${MARCH_ANCHOR.q},${MARCH_ANCHOR.r}`,
    };
  }

  bounds(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.group);
  }

  private rebuild(): void {
    this.clear();
    this.pipeline = createRegistryPipeline({ flags: FLAGS });
    const state = createPlanet({ type: 'flat', seed: 'march', radius: MARCH_RADIUS, planetId: 'pg-march' });
    stampMarchGround(state);
    if (this.rock) stampMarchRocks(state);
    const spawned = spawnMarchUnits(state);
    this.ids = spawned.ids;
    this.tankId = spawned.tankId;
    this.sim = state;
    this.markers = new MarchMarkers(this.group);
    this.markers.setAnchor(MARCH_ANCHOR.q, MARCH_ANCHOR.r);
    this.markers.setRocks(this.rock ? MARCH_ROCKS : []);
    this.syncVisuals();
    this.active = true;
    this.group.visible = true;
    this.paused = false;
    this.orderPending = true;
    this.accumMs = 0;
    this.stepOnce();
    this.showLatest();
  }

  private stepOnce(): void {
    if (!this.sim || !this.pipeline) return;
    const cmds: SimCommand[] = this.orderPending ? [this.marchCommand()] : [];
    this.orderPending = false;
    step(this.sim, cmds, 1, this.pipeline);
    this.syncVisuals();
    this.markers?.setSlots(this.slotTiles());
  }

  private marchCommand(): SimCommand {
    return {
      colonyIndex: 0,
      source: 'player',
      commandId: `march_${this.sim?.meta.tick ?? 0}`,
      kind: 'moveGroup',
      args: { entityIds: this.ids, q: MARCH_ANCHOR.q, r: MARCH_ANCHOR.r, ...(this.pace === 'together' ? { pace: 'together' } : {}) },
    };
  }

  private slotTiles(): Array<{ q: number; r: number }> {
    if (!this.sim) return [];
    const tiles = [];
    for (const id of this.ids) {
      const motion = getMotion(this.sim, id);
      if (motion) tiles.push({ q: motion.goal.q, r: motion.goal.r });
    }
    return tiles;
  }

  /** Shifts each mesh span to the new sim pose. A new mesh is placed on that pose. */
  private syncVisuals(): void {
    if (!this.sim) return;
    const cols = this.sim.entities.cols;
    for (const id of this.ids) {
      const row = rowOf(this.sim.entities, id);
      const world = marchWorld(cols.x[row]!, cols.y[row]!);
      let vis = this.visuals.find((v) => v.id === id);
      if (!vis) {
        vis = this.createVisual(id, row, world);
      }
      const previous = vis.track.at(this.sim.meta.tick - 1);
      const dx = world.x - (previous?.x ?? world.x), dz = world.z - (previous?.y ?? world.z);
      const yaw = dx * dx + dz * dz > 0.0004 ? Math.atan2(dx, dz) : previous?.rot ?? 0;
      vis.track.push({ tick: this.sim.meta.tick, x: world.x, y: world.z, rot: yaw });
      vis.walk = cols.state[row] === ENTITY_STATE.moving ? 1 : 0;
    }
  }

  private createVisual(id: number, row: number, world: { x: number; z: number }): Visual {
    const kind = this.sim!.entities.cols.kind[row];
    const arch = kind === ENTITY_KIND.demoTank ? 'robot.tank' : 'robot.hero';
    const mesh = buildSafeArchetypeMesh(arch, 'robot.hero', this.biomeKey);
    this.group.add(mesh);
    const vis: Visual = {
      id, mesh,
      track: new MotionTrack(), walk: 0,
    };
    mesh.position.set(world.x, 0.02, world.z);
    this.visuals.push(vis);
    return vis;
  }

  /** Manual step and rebuild present the sim pose at once. Playback then fills the next tick. */
  private showLatest(): void {
    this.caughtUp = true;
    this.placeMeshes(1, 0);
  }

  /**
   * Constant-speed draw between the previous sim pose and the current one.
   * `u` is the fraction of the 200 ms tick already elapsed. Explicit steps snap the heading; pause freezes it.
   */
  private placeMeshes(u: number, dt: number): void {
    const t = Math.min(1, Math.max(0, u));
    for (const vis of this.visuals) {
      const pose = vis.track.at((this.sim?.meta.tick ?? 0) - 1 + t);
      if (pose) placeTickPose(vis.mesh, pose, dt, this.caughtUp);
    }
  }

  private clear(): void {
    for (const vis of this.visuals) {
      this.group.remove(vis.mesh);
      vis.mesh.geometry.dispose();
    }
    this.visuals = [];
    this.markers?.dispose();
    this.markers = null;
    this.sim = null;
    this.pipeline = null;
    this.ids = [];
  }
}
