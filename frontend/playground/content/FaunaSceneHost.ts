import { InsectSwarmRenderer } from '@terra/render/animation/insects/InsectSwarmRenderer';
import { MotionTrack } from '@terra/render/motion/entityMotion';
import * as THREE from 'three';
import {
  DEFAULT_FAUNA_ARCHETYPES,
  FAUNA_VISUAL_SPECIES,
  resolveFaunaBugArchetypeId,
  resolveFaunaHiveArchetypeId,
  tickArchetypeMesh,
  type ArchetypeMesh,
  type FaunaVisualSpecies,
} from '@terra/render/kitbash';
import { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';
import type { FaunaMode, FaunaSceneKind } from '../state';
import { FiringRangeScene, isFiringRangeMode } from './faunaFiringRange';
import {
  buildSafeArchetypeMesh,
  COSMETIC_GESTURES,
  createSeededRng,
  deriveCosmeticGesture,
  DT_TICK_S,
  FAUNA_TICK_MS,
  faunaModeLabel,
  followBugMeshes,
  MAX_EPISODE_WAVES,
  SPECIES_TUNING,
  stepAggressiveBugState,
  stepPassiveBugState,
  WAVE_COOLDOWN_TICKS,
  type BugEntity,
  type CosmeticGesture,
  type FaunaBugSnapshot,
  type FaunaHiveStat,
  type FaunaRenderOptions,
  type FaunaSceneStats,
  type HiveEntity,
  type SeededRng,
} from './faunaSimHelpers';

export {
  COSMETIC_GESTURES,
  createSeededRng,
  deriveCosmeticGesture,
  FAUNA_TICK_MS,
  type CosmeticGesture,
  type FaunaBugSnapshot,
  type FaunaHiveStat,
  type FaunaRenderOptions,
  type FaunaSceneStats,
  type SeededRng,
};

/**
 * Deterministic hive-life playground host (`blackAnt`, `blueBeetle`, `greenSpitter`, `mixed`).
 * Simulation ticks (`5 Hz`) and seeded PRNG draws are strictly decoupled from rendering/culling.
 */
export class FaunaSceneHost {
  readonly group = new THREE.Group();
  private readonly swarms = new InsectSwarmRenderer(this.group);
  readonly projectiles: ProjectileVfxSystem;
  private sceneKind: FaunaSceneKind | null = null;
  private mode: FaunaMode = 'passive';
  private seed = 42;
  private biomeKey = 'dune';
  private paused = false;
  private tick = 0;
  private waveCount = 0;
  private accumMs = 0;
  private caughtUp = true;
  private visualTime = 0;
  private rng: SeededRng = createSeededRng(42);
  private hives: HiveEntity[] = [];
  private bugs: BugEntity[] = [];
  private dummyMeshes: ArchetypeMesh[] = [];
  private dummyPos = new THREE.Vector3(3.6, 0, 3.2);
  private renderOpts: FaunaRenderOptions = { wire: false, bloom: true, shadows: true, pixel: false, culled: false };

  constructor(parent?: THREE.Object3D) {
    this.group.name = 'FaunaSceneHost';
    this.group.visible = false;
    parent?.add(this.group);
    this.projectiles = new ProjectileVfxSystem(this.group);
    this.firing = new FiringRangeScene(this.group, this.projectiles);
  }

  private firing: FiringRangeScene;

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  setRenderOptions(opts: Partial<FaunaRenderOptions>): void {
    Object.assign(this.renderOpts, opts);
    this.applyWire(!!this.renderOpts.wire);
  }

  applyWire(wire: boolean): void {
    this.renderOpts.wire = wire;
    for (const h of this.hives) (h.mesh.material as THREE.MeshStandardMaterial).wireframe = wire;
    for (const b of this.bugs) (b.mesh.material as THREE.MeshStandardMaterial).wireframe = wire;
    for (const d of this.dummyMeshes) (d.material as THREE.MeshStandardMaterial).wireframe = wire;
    this.firing.applyWire(wire);
  }

  setScene(
    scene: FaunaSceneKind | null,
    opts: { mode?: FaunaMode; seed?: number; biomeKey?: string; wire?: boolean } = {},
  ): void {
    this.sceneKind = scene;
    if (opts.mode) this.mode = opts.mode;
    if (opts.seed !== undefined && Number.isFinite(opts.seed)) this.seed = Math.trunc(opts.seed);
    if (opts.biomeKey) this.biomeKey = opts.biomeKey;
    if (opts.wire !== undefined) this.renderOpts.wire = opts.wire;
    this.rebuild();
  }

  setMode(mode: FaunaMode): void {
    if (this.mode === mode) return;
    const wasRange = isFiringRangeMode(this.mode);
    this.mode = mode;
    if (wasRange || isFiringRangeMode(mode)) {
      this.rebuild();
      return;
    }
    if (mode === 'aggressive' && this.sceneKind !== null) {
      this.dispatchAggressiveWaves();
    } else if (mode === 'passive') {
      for (const b of this.bugs) {
        b.order = 'wander';
        b.workWeight = 0;
      }
    }
  }

  setSeed(seed: number): void {
    if (!Number.isFinite(seed)) return;
    this.reset(Math.trunc(seed));
  }

  setBiome(biomeKey: string): void {
    if (this.biomeKey === biomeKey && this.hives.length > 0) return;
    this.biomeKey = biomeKey;
    if (this.sceneKind !== null) this.rebuild();
  }

  reset(seed = this.seed): void {
    if (Number.isFinite(seed)) this.seed = Math.trunc(seed);
    this.rebuild();
  }

  private clearMeshes(): void {
    this.swarms.clear();
    this.projectiles.clear();
    const all = [...this.hives.map((h) => h.mesh), ...this.bugs.map((b) => b.mesh), ...this.dummyMeshes];
    for (const m of all) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.hives = [];
    this.bugs = [];
    this.dummyMeshes = [];
    this.firing.dispose();
  }

  private rebuild(): void {
    this.clearMeshes();
    this.tick = 0;
    this.waveCount = 0;
    this.accumMs = 0;
    this.caughtUp = true;
    this.visualTime = 0;
    this.rng = createSeededRng(this.seed);

    if (this.sceneKind === null) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (isFiringRangeMode(this.mode)) {
      this.firing.build(this.sceneKind, this.mode, this.seed, this.biomeKey);
      this.applyWire(!!this.renderOpts.wire);
      return;
    }

    const speciesList: FaunaVisualSpecies[] =
      this.sceneKind === 'mixed' ? [...FAUNA_VISUAL_SPECIES] : [this.sceneKind];
    const hivePlacements =
      this.sceneKind === 'mixed'
        ? [
            { x: -3.6, z: -1.8 },
            { x: 0.0, z: -2.6 },
            { x: 3.6, z: -1.8 },
          ]
        : [{ x: 0.0, z: -0.6 }];

    this.dummyPos.set(this.sceneKind === 'mixed' ? 0.0 : 3.4, 0, this.sceneKind === 'mixed' ? 3.5 : 2.8);
    this.spawnDummyTargets();

    speciesList.forEach((species, idx) => {
      const pos = hivePlacements[idx] ?? { x: 0, z: 0 };
      this.spawnHiveAndCohort(species, pos.x, pos.z);
    });

    if (this.mode === 'aggressive') {
      this.dispatchAggressiveWaves();
    }
    this.placeBugMeshes();
    this.applyWire(!!this.renderOpts.wire);
  }

  private spawnDummyTargets(): void {
    const turret = buildSafeArchetypeMesh('building.turret', 'building.turret', this.biomeKey);
    turret.position.copy(this.dummyPos);
    const recon = buildSafeArchetypeMesh('robot.recon', 'robot.hero', this.biomeKey);
    recon.position.set(this.dummyPos.x - 1.3, 0, this.dummyPos.z + 0.3);
    recon.rotation.y = Math.PI;
    this.group.add(turret, recon);
    this.dummyMeshes.push(turret, recon);
  }

  private spawnHiveAndCohort(species: FaunaVisualSpecies, hx: number, hz: number): void {
    const tuning = SPECIES_TUNING[species];
    const hiveArchId = resolveFaunaHiveArchetypeId(this.biomeKey, species);
    const bugArchId = resolveFaunaBugArchetypeId(this.biomeKey, species);
    const fallbackHive = DEFAULT_FAUNA_ARCHETYPES[species].hive;
    const fallbackBug = DEFAULT_FAUNA_ARCHETYPES[species].bug;

    const hiveMesh = buildSafeArchetypeMesh(hiveArchId, fallbackHive, this.biomeKey);
    hiveMesh.position.set(hx, 0, hz);
    this.group.add(hiveMesh);

    const hiveId = `hive:${species}`;
    const entranceX = hx;
    const entranceZ = hz + 1.25;
    this.hives.push({
      hiveId,
      species,
      hiveArchetypeId: hiveArchId,
      bugArchetypeId: bugArchId,
      x: hx,
      y: 0,
      z: hz,
      entranceX,
      entranceZ,
      maxResidents: tuning.maxResidents,
      waveCount: 0,
      lastWaveTick: 0,
      mesh: hiveMesh,
    });

    for (let i = 0; i < tuning.initialResidents; i++) {
      const angle = this.rng.nextRange(0, Math.PI * 2);
      const dist = this.rng.nextRange(0.65, tuning.wanderRadiusM);
      const bx = entranceX + Math.cos(angle) * dist;
      const bz = entranceZ + Math.sin(angle) * dist;
      const wAngle = this.rng.nextRange(0, Math.PI * 2);
      const wDist = this.rng.nextRange(0.7, tuning.wanderRadiusM);
      const tx = entranceX + Math.cos(wAngle) * wDist;
      const tz = entranceZ + Math.sin(wAngle) * wDist;
      const bugId = `${species}:${i + 1}`;
      const bugMesh = buildSafeArchetypeMesh(bugArchId, fallbackBug, this.biomeKey);
      this.group.add(bugMesh);
      this.bugs.push({
        track: new MotionTrack(),
        bugId,
        index: i,
        species,
        hiveId,
        archetypeId: bugArchId,
        x: bx,
        y: 0,
        z: bz,
        yaw: Math.atan2(tx - bx, tz - bz),
        targetX: tx,
        targetZ: tz,
        attackOffsetX: 0,
        attackOffsetZ: 0,
        wanderTimerTicks: this.rng.nextInt(3, 10),
        walkWeight: 1,
        workWeight: 0,
        gesture: deriveCosmeticGesture(this.seed, bugId, 0),
        order: 'wander',
        mesh: bugMesh,
      });
    }
  }

  private dispatchAggressiveWaves(): void {
    for (const hive of this.hives) {
      if (hive.waveCount >= MAX_EPISODE_WAVES) continue;
      if (hive.waveCount > 0 && this.tick - hive.lastWaveTick < WAVE_COOLDOWN_TICKS) continue;
      hive.waveCount += 1;
      hive.lastWaveTick = this.tick;
      this.waveCount += 1;
      for (const bug of this.bugs) {
        if (bug.hiveId !== hive.hiveId) continue;
        bug.attackOffsetX = this.rng.nextRange(-0.9, 0.9);
        bug.attackOffsetZ = this.rng.nextRange(-0.9, 0.5);
        bug.order = 'attack';
      }
    }
  }

  /** Advance deterministic simulation by `ticks` fixed steps (`200 ms` each), even while paused. */
  stepTick(ticks = 1): void {
    if (this.sceneKind === null) return;
    const count = Math.max(0, Math.trunc(ticks));
    if (count > 0) { this.caughtUp = true; this.accumMs = 0; }
    for (let i = 0; i < count; i++) {
      if (isFiringRangeMode(this.mode)) this.firing.stepTicks(1);
      else this.stepSingleTick();
      this.advanceVisuals(DT_TICK_S, true);
    }
  }

  private stepSingleTick(): void {
    if (this.sceneKind === null) return;
    this.tick += 1;

    if (this.mode === 'aggressive') {
      this.dispatchAggressiveWaves();
    }

    for (const bug of this.bugs) {
      const tuning = SPECIES_TUNING[bug.species];
      const hive = this.hives.find((h) => h.hiveId === bug.hiveId)!;
      bug.gesture = deriveCosmeticGesture(this.seed, bug.bugId, this.tick);

      if (this.mode === 'passive') {
        stepPassiveBugState(bug, hive, tuning, this.rng);
      } else {
        stepAggressiveBugState(bug, tuning, this.dummyPos, this.tick, (from, to) => this.fireAcidGlob(from, to));
      }
      bug.track.push({ tick: this.tick, x: bug.x, y: bug.z, rot: bug.yaw });
    }
  }

  private fireAcidGlob(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): void {
    this.projectiles.onProjectileFired({
      weaponKind: 'acid',
      weaponId: 'spitterAcid',
      arc: 'indirect',
      from,
      to,
      speed: 12,
      durationS: 0.55,
      autoImpactOnArrival: true,
    });
  }

  /** Fires a demonstration acid glob + splash preview without consuming gameplay RNG. */
  triggerAcidPreview(): void {
    this.group.visible = true;
    if (isFiringRangeMode(this.mode)) {
      const ends = this.firing.acidEnds();
      const from = ends?.from ?? { x: 0, y: 0.75, z: -0.6 };
      const to = ends?.to ?? { x: this.dummyPos.x, y: 0.55, z: this.dummyPos.z };
      this.fireAcidGlob(from, to);
      this.projectiles.onProjectileImpact({ weaponKind: 'acid', weaponId: 'spitterAcid', at: to });
      return;
    }
    const spitter = this.bugs.find((b) => b.species === 'greenSpitter') ?? this.bugs[0];
    const from = spitter ? { x: spitter.x, y: 0.65, z: spitter.z } : { x: 0, y: 0.75, z: -0.6 };
    const to = { x: this.dummyPos.x, y: 0.55, z: this.dummyPos.z };
    this.fireAcidGlob(from, to);
    this.projectiles.onProjectileImpact({
      weaponKind: 'acid',
      weaponId: 'spitterAcid',
      at: to,
    });
  }

  /** Spawn / reset only. Playback samples the tick history instead of chasing each logical pose. */
  private placeBugMeshes(): void {
    for (const b of this.bugs) {
      b.track.push({ tick: this.tick, x: b.x, y: b.z, rot: b.yaw });
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.y = b.yaw;
    }
  }

  /** Frame visual update: advances fixed ticks when unpaused and updates GPU shader uniforms. */
  update(_time: number, dt: number, opts?: Partial<FaunaRenderOptions>): void {
    if (opts) this.setRenderOptions(opts);
    if (this.sceneKind === null) return;
    const elapsed = this.paused ? 0 : Math.max(0, dt);
    if (elapsed > 0) {
      this.accumMs += elapsed * 1000;
      while (this.accumMs >= FAUNA_TICK_MS) {
        this.accumMs -= FAUNA_TICK_MS;
        this.caughtUp = false;
        if (isFiringRangeMode(this.mode)) this.firing.stepTicks(1);
        else this.stepSingleTick();
      }
    }
    this.advanceVisuals(elapsed);
  }

  /** One local clock for pose, corpse, and VFX time; wall-clock/camera updates cannot unpause it. */
  private advanceVisuals(dt: number, snap = false): void {
    this.visualTime += dt;
    const tick = isFiringRangeMode(this.mode) ? this.firing.tick : this.tick;
    const renderTick = this.caughtUp ? tick : tick - 1 + this.accumMs / FAUNA_TICK_MS;
    if (isFiringRangeMode(this.mode)) {
      this.firing.follow(dt, renderTick, snap);
      this.firing.tickMeshes(this.visualTime, !!this.renderOpts.culled, dt);
      this.projectiles.update(dt);
      this.swarms.sync(this.biomeKey);
      return;
    }
    followBugMeshes(this.bugs, dt, renderTick, snap);
    this.projectiles.update(dt);
    if (this.renderOpts.culled) return;
    for (const h of this.hives) tickArchetypeMesh(h.mesh, this.visualTime, 0, 0);
    for (const b of this.bugs) tickArchetypeMesh(b.mesh, this.visualTime, b.walkWeight, b.workWeight);
    for (const d of this.dummyMeshes) tickArchetypeMesh(d, this.visualTime, 0, this.mode === 'aggressive' ? 1 : 0);
    this.swarms.sync(this.biomeKey);
  }

  bounds(): THREE.Box3 {
    if (isFiringRangeMode(this.mode) && this.sceneKind !== null) return this.firing.bounds();
    if (this.sceneKind === 'mixed') {
      return new THREE.Box3(new THREE.Vector3(-5.2, 0, -4.4), new THREE.Vector3(5.2, 2.6, 4.8));
    }
    return new THREE.Box3(new THREE.Vector3(-3.6, 0, -3.2), new THREE.Vector3(4.8, 2.4, 4.0));
  }

  getStats(): FaunaSceneStats {
    if (isFiringRangeMode(this.mode)) {
      return this.firing.stats(this.sceneKind, this.paused, this.projectiles.getActiveProjectiles().length);
    }
    const hives: FaunaHiveStat[] = this.hives.map((h) => {
      const residents = this.bugs.filter((b) => b.hiveId === h.hiveId).length;
      const elapsed = this.tick - h.lastWaveTick;
      const nextWaveTicks =
        this.mode === 'aggressive' && h.waveCount < MAX_EPISODE_WAVES
          ? Math.max(0, WAVE_COOLDOWN_TICKS - elapsed)
          : 0;
      return {
        hiveId: h.hiveId,
        species: h.species,
        hiveArchetypeId: h.hiveArchetypeId,
        bugArchetypeId: h.bugArchetypeId,
        mode: this.mode,
        residents,
        maxResidents: h.maxResidents,
        waveCount: h.waveCount,
        position: { x: h.x, y: h.y, z: h.z },
        targetColony: this.mode === 'aggressive' ? 'colony:0' : null,
        nextWaveTicks,
      };
    });
    const populationCount = hives.reduce((acc, h) => acc + h.residents, 0);
    const maxPopulation = hives.reduce((acc, h) => acc + h.maxResidents, 0);
    return {
      tick: this.tick,
      rngDraws: this.rng.draws,
      mode: this.mode,
      modeLabel: faunaModeLabel(this.mode),
      scene: this.sceneKind,
      biomeKey: this.biomeKey,
      seed: this.seed,
      paused: this.paused,
      populationCount,
      maxPopulation,
      waveCount: this.waveCount,
      activeProjectiles: this.projectiles.getActiveProjectiles().length,
      hives,
      bugs: this.bugs.map((b) => ({
        bugId: b.bugId,
        species: b.species,
        hiveId: b.hiveId,
        archetypeId: b.archetypeId,
        x: Number(b.x.toFixed(4)),
        y: Number(b.y.toFixed(4)),
        z: Number(b.z.toFixed(4)),
        yaw: Number(b.yaw.toFixed(4)),
        walkWeight: b.walkWeight,
        workWeight: b.workWeight,
        gesture: b.gesture,
        order: b.order,
      })),
    };
  }
}
