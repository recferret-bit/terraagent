import { MotionTrack } from '@terra/render/motion/entityMotion';
import { placeTickPose } from '@terra/render/motion/pose';
import { BattlePresentation } from '@terra/render/combat/BattlePresentation';
import { CombatShotCoordinator } from '@terra/render/combat/CombatShotCoordinator';
import { InsectCorpseLayer } from '@terra/render/combat/InsectCorpseLayer';
import { WreckageLayer } from '@terra/render/combat/WreckageLayer';
import * as THREE from 'three';
import { attachEntityProjectorRig, type EntityProjectorRigState } from '@terra/render/lighting/EntityProjectorRig';
import { TILE_M } from '@terra/render/planets/hex';
import {
  resolveFaunaBugArchetypeId,
  resolveFaunaHiveArchetypeId,
  tickArchetypeMesh,
  type ArchetypeMesh,
  type FaunaVisualSpecies,
} from '@terra/render/kitbash';
import type { ProjectileVfxSystem } from '@terra/render/visuals/projectiles';
import {
  createPlanet,
  createRegistryPipeline,
  DEPOSIT,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getFaunaHivesState,
  PREP,
  populateShootingGallery,
  populateInsectAttackScene,
  step,
  TERRAIN,
  type FiringRangeMode,
  type Pipeline,
  type PlanetState,
  type SimEvent,
} from '@terra/sim';
import { parseWaves } from '@terra/contracts';
import { axialToPlane } from '@terra/sim/grid/hex';
import type { FaunaMode, FaunaSceneKind } from '../state';
import {
  buildSafeArchetypeMesh,
  deriveCosmeticGesture,
  faunaModeLabel,
  syncPlaygroundNightProjectors,
  type FaunaBugSnapshot,
  type FaunaHiveStat,
  type FaunaSceneStats,
} from './faunaSimHelpers';

const RANGE_RADIUS = 12;
const PLANET_FLAGS = parseWaves('..07');

interface SimVisual {
  track: MotionTrack;
  id: number;
  kind: number;
  mesh: ArchetypeMesh;
  x: number;
  z: number;
  yaw: number;
  walk: number;
  work: number;
}

export function isFiringRangeMode(mode: FaunaMode): mode is FiringRangeMode {
  return mode === 'gallery' || mode === 'turrets' || mode === 'units' || mode === 'bugs' || mode === 'robots';
}

/** Sim axial (x, y) → playground metres. `axialToPlane` is tile units; the game draws those × `TILE_M`. */
export function firingRangeWorld(x: number, y: number, height = 0): { x: number; y: number; z: number } {
  const [px, pz] = axialToPlane(x, y);
  return { x: px * TILE_M, y: height, z: pz * TILE_M };
}

function stampFlatPrepared(state: PlanetState): void {
  const layers = state.grid.layers;
  layers.terrain.fill(TERRAIN.flat);
  layers.prep.fill(PREP.prepared);
  layers.height.fill(0);
  layers.deposit.fill(DEPOSIT.none);
  layers.owner.fill(-1);
  layers.richness?.fill(0);
  layers.depositTier?.fill(0);
}

function armColony(state: PlanetState): void {
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, state.meta.tick));
  colony.status = 'active';
  colony.powerSupplyOverride = 800;
  colony.stock['metals.t1'] = 600;
  colony.stock['minerals.t1'] = 500;
  colony.stock['bio.biomass'] = 500;
  colony.stock['bio.water'] = 500;
}

function archetypeFor(kind: number, biomeKey: string): string {
  if (kind === ENTITY_KIND.hiveBlackAnt) return resolveFaunaHiveArchetypeId(biomeKey, 'blackAnt');
  if (kind === ENTITY_KIND.hiveBlueBeetle) return resolveFaunaHiveArchetypeId(biomeKey, 'blueBeetle');
  if (kind === ENTITY_KIND.hiveGreenSpitter) return resolveFaunaHiveArchetypeId(biomeKey, 'greenSpitter');
  if (kind === ENTITY_KIND.blackAnt) return resolveFaunaBugArchetypeId(biomeKey, 'blackAnt');
  if (kind === ENTITY_KIND.blueBeetle) return resolveFaunaBugArchetypeId(biomeKey, 'blueBeetle');
  if (kind === ENTITY_KIND.greenSpitter) return resolveFaunaBugArchetypeId(biomeKey, 'greenSpitter');
  if (kind === ENTITY_KIND.commandHub) return 'building.commandHub';
  if (kind === ENTITY_KIND.autocannon) return 'building.turret';
  if (kind === ENTITY_KIND.laserTower) return 'building.laserTower';
  if (kind === ENTITY_KIND.recon) return 'robot.recon';
  if (kind === ENTITY_KIND.demoTank) return 'robot.tank';
  if (kind === ENTITY_KIND.demoArtillery) return 'robot.artillery';
  return 'robot.builder';
}

function bugSpecies(kind: number): FaunaVisualSpecies | null {
  if (kind === ENTITY_KIND.blackAnt) return 'blackAnt';
  if (kind === ENTITY_KIND.blueBeetle) return 'blueBeetle';
  if (kind === ENTITY_KIND.greenSpitter) return 'greenSpitter';
  return null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Real tiny planet for the playground firing range. Cosmetic passive / aggressive scenes do not use it.
 * A command hub plus `powerSupplyOverride` keeps turrets on the W03 grid so the real turret step will fire.
 */
export class FiringRangeScene {
  readonly battle = new BattlePresentation(id => this.visuals.find(v => v.id === id)?.mesh);
  private readonly shots: CombatShotCoordinator;
  private readonly corpses: InsectCorpseLayer;
  readonly wrecks: WreckageLayer;
  private readonly pendingWrecks = new Map<number, SimVisual>();
  private readonly queuedShots: Array<{ attackerId: number; firedTick: number; age: number; input: Parameters<CombatShotCoordinator['dispatchShot']>[1]; speedMps?: number }> = [];
  private readonly heldImpacts = new Map<string, Array<() => void>>();
  private sim: PlanetState | null = null;
  private pipeline: Pipeline | null = null;
  private visuals: SimVisual[] = [];
  private mode: FiringRangeMode = 'turrets';
  private biomeKey = 'dune';
  private seed = 42;

  constructor(
    private group: THREE.Group,
    private projectiles: ProjectileVfxSystem,
  ) {
    this.shots = new CombatShotCoordinator(this.battle, this.projectiles, id => this.visuals.find(v => v.id === id)?.mesh);
    this.corpses = new InsectCorpseLayer(this.group, this.biomeKey);
    this.wrecks = new WreckageLayer(this.group, this.biomeKey);
  }

  get tick(): number {
    return this.sim?.meta.tick ?? 0;
  }

  dispose(): void {
    for (const v of this.visuals) this.dropVisual(v, false);
    this.flushPendingWrecks();
    this.visuals = [];
    this.queuedShots.length = 0;
    this.heldImpacts.clear();
    this.shots.clear();
    this.corpses.clear();
    this.wrecks.clear();
    this.battle.clear();
    this.sim = null;
    this.pipeline = null;
  }

  build(scene: FaunaSceneKind, mode: FiringRangeMode, seed: number, biomeKey: string): void {
    this.dispose();
    this.mode = mode === 'turrets' || mode === 'units' ? 'gallery' : mode;
    this.biomeKey = biomeKey;
    this.corpses.setBiome(biomeKey);
    this.wrecks.setBiome(biomeKey);
    this.seed = seed;
    this.pipeline = createRegistryPipeline({ flags: PLANET_FLAGS });
    const state = createPlanet({ type: 'flat', seed: String(seed), radius: RANGE_RADIUS, planetId: 'pg-range' });
    stampFlatPrepared(state);
    armColony(state);
    const data = this.pipeline.config.data;
    if (mode === 'gallery' || mode === 'turrets' || mode === 'units') {
      populateShootingGallery(state, scene, data);
    } else {
      populateInsectAttackScene(state, scene, mode, data);
    }
    this.sim = state;
    this.syncFromSim(true);
  }

  stepTicks(count: number): void {
    if (!this.sim || !this.pipeline) return;
    const n = Math.max(0, Math.trunc(count));
    for (let i = 0; i < n; i++) {
      const result = step(this.sim, [], 1, this.pipeline);
      this.syncFromSim(false);
      this.battle.sync(this.sim.blobs.battle);
      this.battle.insects.sync(this.sim.blobs.insectActions, this.sim.meta.tick);
      this.ingest(result.events);
      this.flushPendingWrecks();
    }
  }

  follow(dt: number, renderTick = this.tick, snap = false): void {
    for (const v of this.visuals) {
      const pose = v.track.at(renderTick);
      if (pose) placeTickPose(v.mesh, pose, dt, snap);
      v.mesh.position.y = 0;
    }
  }

  tickMeshes(time: number, culled: boolean, dt: number, nightMode = false): void {
    if (!culled) for (const v of this.visuals) tickArchetypeMesh(v.mesh, time, v.walk, v.work);
    this.battle.update(dt);
    this.shots.update(dt);
    syncPlaygroundNightProjectors(
      this.visuals
        .map((v) => ({ archetypeId: archetypeFor(v.kind, this.biomeKey), mesh: v.mesh }))
        .filter((e) => !e.archetypeId.startsWith('fauna.')),
      nightMode,
    );
    for (let i = this.queuedShots.length - 1; i >= 0; i--) {
      const q = this.queuedShots[i]!;
      q.age += dt;
      const alignKey = `${q.attackerId}:${q.firedTick}`;
      const targetGone = q.input.targetId !== undefined && !this.visuals.some(v => v.id === q.input.targetId);
      if (!this.visuals.some(v => v.id === q.attackerId) || targetGone || q.age >= 3.5) {
        this.queuedShots.splice(i, 1);
        this.heldImpacts.delete(alignKey);
        continue;
      }
      if (this.shots.isReadyToFire(q.attackerId, q.input)) {
        this.queuedShots.splice(i, 1);
        this.shots.dispatchShot(q.attackerId, q.input, { burstSeed: q.attackerId * 31 + q.firedTick });
        const deferred = this.heldImpacts.get(alignKey);
        if (deferred) {
          this.heldImpacts.delete(alignKey);
          for (const run of deferred) run();
        }
      }
    }
  }

  applyWire(wire: boolean): void {
    for (const v of this.visuals) (v.mesh.material as THREE.MeshStandardMaterial).wireframe = wire;
  }

  bounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const v of this.visuals) {
      v.mesh.updateWorldMatrix(true, false);
      if (v.mesh.geometry.boundingBox) bounds.union(v.mesh.geometry.boundingBox.clone().applyMatrix4(v.mesh.matrixWorld));
    }
    return bounds.expandByScalar(1.5);
  }

  acidEnds(): { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null {
    const from = this.visuals.find((v) => v.kind === ENTITY_KIND.greenSpitter) ?? this.visuals.find((v) => bugSpecies(v.kind));
    const to = this.visuals.find((v) => v.kind === ENTITY_KIND.recon) ?? this.visuals.find((v) => v.kind === ENTITY_KIND.autocannon);
    if (!from || !to) return null;
    return { from: { x: from.x, y: 0.65, z: from.z }, to: { x: to.x, y: 0.55, z: to.z } };
  }

  stats(scene: FaunaSceneKind | null, paused: boolean, activeProjectiles: number): FaunaSceneStats {
    const fauna = this.sim ? getFaunaHivesState(this.sim) : null;
    const hives = this.hiveStats(fauna);
    const bugs = this.bugStats();
    const populationCount = bugs.length;
    const maxPopulation = hives.reduce((sum, h) => sum + h.maxResidents, 0);
    return {
      tick: this.tick,
      rngDraws: 0,
      mode: this.mode,
      modeLabel: faunaModeLabel(this.mode),
      scene,
      biomeKey: this.biomeKey,
      seed: this.seed,
      paused,
      populationCount,
      maxPopulation,
      waveCount: 0,
      activeProjectiles,
      animations: this.battle.insects.snapshots(),
      hives,
      bugs,
    };
  }

  private hiveStats(fauna: ReturnType<typeof getFaunaHivesState> | null): FaunaHiveStat[] {
    if (!fauna) return [];
    return Object.values(fauna.hivesById)
      .sort((a, b) => a.hiveId - b.hiveId)
      .map((hive) => {
        const world = firingRangeWorld(hive.q, hive.r);
        const vis = this.visuals.find((v) => v.id === hive.hiveId);
        return {
          hiveId: `hive:${hive.species}`,
          species: hive.species,
          hiveArchetypeId: vis ? archetypeFor(vis.kind, this.biomeKey) : resolveFaunaHiveArchetypeId(this.biomeKey, hive.species),
          bugArchetypeId: resolveFaunaBugArchetypeId(this.biomeKey, hive.species),
          mode: this.mode,
          residents: hive.residentIds.length,
          maxResidents: Math.max(hive.popCap, hive.residentIds.length),
          waveCount: 0,
          position: { x: world.x, y: 0, z: world.z },
          targetColony: this.mode === 'bugs' ? 'colony:0' : null,
          nextWaveTicks: 0,
        };
      });
  }

  private bugStats(): FaunaBugSnapshot[] {
    return this.visuals
      .filter((v) => bugSpecies(v.kind))
      .map((v) => {
        const species = bugSpecies(v.kind)!;
        const hiveId = this.homeHiveId(v.id);
        return {
          bugId: `${species}:${v.id}`,
          species,
          hiveId,
          archetypeId: archetypeFor(v.kind, this.biomeKey),
          x: Number(v.x.toFixed(4)),
          y: 0,
          z: Number(v.z.toFixed(4)),
          yaw: Number(v.yaw.toFixed(4)),
          walkWeight: v.walk,
          workWeight: v.work,
          gesture: deriveCosmeticGesture(this.seed, v.id, this.tick),
          order: this.bugOrder(v),
        };
      });
  }

  private homeHiveId(bugId: number): string {
    const fauna = this.sim ? getFaunaHivesState(this.sim) : null;
    const bug = fauna?.bugsById[bugId];
    const hive = bug ? fauna?.hivesById[bug.homeHiveId] : undefined;
    return hive ? `hive:${hive.species}` : 'hive:blackAnt';
  }

  private bugOrder(v: SimVisual): FaunaBugSnapshot['order'] {
    if (this.mode !== 'bugs') return v.walk > 0 ? 'wander' : 'idle';
    if (v.kind === ENTITY_KIND.greenSpitter) return v.walk > 0 ? 'attack' : 'spit_acid';
    return v.walk > 0 ? 'attack' : 'bite';
  }

  private syncFromSim(snap: boolean): void {
    if (!this.sim) return;
    const cols = this.sim.entities.cols;
    const seen = new Set<number>();
    for (let row = 0; row < this.sim.entities.count; row++) {
      if (cols.hp[row]! <= 0) continue;
      const id = cols.id[row]!;
      seen.add(id);
      this.upsertVisual(row, id, snap);
    }
    this.visuals = this.visuals.filter((v) => {
      if (seen.has(v.id)) return true;
      const arch = archetypeFor(v.kind, this.biomeKey);
      if (!arch.startsWith('fauna.') && v.kind !== ENTITY_KIND.pod) {
        this.pendingWrecks.set(v.id, v);
        return false;
      }
      if (!this.battle.insects.retire(v.id, () => this.dropVisual(v, true), true)) this.dropVisual(v, false);
      return false;
    });
  }

  private flushPendingWrecks(): void {
    for (const v of this.pendingWrecks.values()) this.dropVisual(v, false);
    this.pendingWrecks.clear();
  }

  private upsertVisual(row: number, id: number, snap: boolean): void {
    if (!this.sim) return;
    const cols = this.sim.entities.cols;
    const world = firingRangeWorld(cols.x[row]!, cols.y[row]!);
    let vis = this.visuals.find((v) => v.id === id);
    if (!vis) {
      const archId = archetypeFor(cols.kind[row]!, this.biomeKey);
      const mesh = buildSafeArchetypeMesh(archId, 'robot.builder', this.biomeKey);
      if (!archId.startsWith('fauna.')) attachEntityProjectorRig(mesh, archId);
      this.group.add(mesh);
      vis = { track: new MotionTrack(), id, kind: cols.kind[row]!, mesh, x: world.x, z: world.z, yaw: 0, walk: 0, work: 0 };
      this.visuals.push(vis);
      snap = true;
    }
    const dx = world.x - vis.x;
    const dz = world.z - vis.z;
    vis.x = world.x;
    vis.z = world.z;
    vis.kind = cols.kind[row]!;
    vis.yaw = Math.hypot(dx, dz) > 0.02 ? Math.atan2(dx, dz) : Math.PI / 2 - cols.rot[row]!;
    vis.track.push({ tick: this.sim!.meta.tick, x: vis.x, y: vis.z, rot: vis.yaw });
    vis.walk = cols.state[row] === ENTITY_STATE.moving ? 1 : 0;
    vis.work = cols.state[row] === ENTITY_STATE.working ? 1 : 0;
    this.battle.insects.track(id, vis.mesh, cols.hp[row]!, vis.walk > 0);
    if (snap) {
      vis.mesh.position.set(vis.x, 0, vis.z);
      vis.mesh.rotation.y = vis.yaw;
    }
  }

  private dropVisual(v: SimVisual, preserveCorpse = false): void {
    if (preserveCorpse) this.corpses.preserve(v.mesh, 0);
    (v.mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig?.dispose();
    this.group.remove(v.mesh);
    v.mesh.geometry.dispose();
    (v.mesh.material as THREE.Material).dispose();
  }

  private ingest(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'projectileFired') this.ingestFired(ev.data, ev.atTick);
      else if (ev.kind === 'projectileImpact') this.ingestImpact(ev.data, ev.atTick);
      else if (ev.kind === 'nestDestroyed') {
        const hiveAt = firingRangeWorld(num(ev.data.q), num(ev.data.r), 0.55);
        this.projectiles.clearCratersInRadius(hiveAt.x, hiveAt.z, 2.9);
        this.projectiles.emitInsectDeath({ at: hiveAt, groundY: 0, scale: 1.85 });
      } else if (ev.kind === 'faunaKilled') {
        const bugAt = firingRangeWorld(num(ev.data.q), num(ev.data.r), 0);
        this.projectiles.clearCratersInRadius(bugAt.x, bugAt.z, 1.6);
      } else if (ev.kind === 'unitDestroyed' || ev.kind === 'buildingDestroyed') {
        const deadId = num(ev.data.entityId ?? ev.data.unitId ?? ev.data.buildingId);
        if (this.wrecks.has(deadId)) continue;
        const v = this.visuals.find((x) => x.id === deadId) ?? this.pendingWrecks.get(deadId);
        if (!v) continue;
        const arch = archetypeFor(v.kind, this.biomeKey);
        if (arch.startsWith('fauna.') || v.kind === ENTITY_KIND.pod) continue;
        const mechKind = ev.kind === 'buildingDestroyed' || arch.startsWith('building.') ? 'building' : 'bot';
        this.projectiles.emitMechanicalDeath({
          kind: mechKind,
          at: { x: v.x, y: mechKind === 'building' ? 0.8 : 0.5, z: v.z },
          groundY: 0,
          scale: mechKind === 'building' ? 1.25 : 1.0,
        });
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.yaw;
        this.wrecks.preserve(v.id, v.mesh, { kind: mechKind, archetypeId: arch, groundY: 0 });
      }
    }
  }

  private ingestFired(data: Record<string, unknown>, tick: number): void {
    const from = firingRangeWorld(num(data.fromX), num(data.fromY), 0.65);
    const to = firingRangeWorld(num(data.aimX ?? data.fromX), num(data.aimY ?? data.fromY), 0.55);
    const flight = num(data.flightTicks);
    const attackerId = num(data.attackerId);
    const input = {
      weaponId: typeof data.weaponId === 'string' ? data.weaponId : undefined,
      weaponType: typeof data.weaponType === 'string' ? data.weaponType : undefined,
      arc: (data.arc === 'indirect' ? 'indirect' : 'direct') as 'direct' | 'indirect',
      from,
      to,
      aoe: num(data.aoe),
      durationS: flight > 0 ? flight / 5 : undefined,
      autoImpactOnArrival: false, targetId: num(data.targetId), impactTick: num(data.impactTick ?? tick), firedTick: tick,
    };
    if (!this.shots.isReadyToFire(attackerId, input)) {
      this.queuedShots.push({ attackerId, firedTick: tick, age: 0, input });
      return;
    }
    this.shots.dispatchShot(attackerId, input, { burstSeed: attackerId * 31 + tick });
  }

  private ingestImpact(data: Record<string, unknown>, tick: number): void {
    const attackerId = num(data.attackerId);
    const firedTick = num(data.firedTick ?? tick);
    const alignKey = `${attackerId}:${firedTick}`;
    if (this.queuedShots.some(q => q.attackerId === attackerId && q.firedTick === firedTick)) {
      const list = this.heldImpacts.get(alignKey) ?? [];
      list.push(() => this.ingestImpact(data, tick));
      this.heldImpacts.set(alignKey, list);
      return;
    }
    const at = firingRangeWorld(num(data.aimX ?? data.q), num(data.aimY ?? data.r), 0.45);
    this.projectiles.onProjectileImpact(this.battle.impact(attackerId, {
      weaponId: typeof data.weaponId === 'string' ? data.weaponId : undefined,
      weaponType: typeof data.weaponType === 'string' ? data.weaponType : undefined,
      at,
      aoe: num(data.aoe),
      hit: Boolean(data.hit), targetId: num(data.targetId), impactTick: tick, groundY: 0,
    }));
  }
}
