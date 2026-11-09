import * as THREE from 'three';
import { tileXZ } from '../planets/hex';
import { makeBroadleafGeo, makePineGeo } from '../visuals/terrain/Scatter';
import {
  buildVictimInstance,
  createSharedTwisterResources,
  createVortexDebrisParticle,
  type ActiveTwisterInstance,
  type FunnelLayerBinding,
  type SharedTwisterResources,
} from './parts/twisterBuilders';
import { readWeatherParams } from './ScreenWeatherOverlay';
import { createTwisterDustSkirtMaterial, createTwisterFunnelMaterial, spineOffsetAt } from './twisterShaders';

const VORTEX_PARTICLE_COUNT = 72;
const RISE_DURATION = 2.6;
const DISSIPATE_DURATION = 2.4;
const SUCTION_END = 1.6;
const VICTIM_TOTAL_END = 3.0;

export interface TwisterTreeVictimSpec { q: number; r: number; tick?: number }
export interface TwisterUnitVictimSpec {
  id?: number; entityId?: number; kind?: number; q?: number; r?: number; x?: number; y?: number; tick?: number;
}
export interface ActiveTwisterSnapshot {
  id?: number; twisterId?: number; q?: number; r?: number; x?: number; y?: number;
  dirRad?: number; dirDeg?: number; ageTicks?: number; durationTicks?: number;
  uprootedTrees?: ReadonlyArray<TwisterTreeVictimSpec>;
  suckedUnits?: ReadonlyArray<TwisterUnitVictimSpec | number>;
}
export interface SpawnTwisterOpts {
  id?: number; q?: number; r?: number; x?: number; y?: number; wx?: number; wz?: number;
  dirRad?: number; dirDeg?: number; durationS?: number; previewVictims?: boolean;
  heightAt?: (x: number, z: number) => number;
}

/**
 * 3D Volumetric Twister Hazard VFX (`weather-twister-fx`):
 * - 3 nested shader funnel layers (`outer`, `mid`, `inner`) + boiling ground dust skirt & swirl disc.
 * - 72 swirling 3D debris chunks in a 60/30/10 material hierarchy following the S-curved vortex spine.
 * - Curving S-wave trajectory across terrain, uprooting storm-tinted forest trees and colony units.
 */
export class TwisterFx {
  public readonly group = new THREE.Group();
  private readonly pineTreeGeo: THREE.BufferGeometry;
  private readonly broadleafTreeGeo: THREE.BufferGeometry;
  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly res: SharedTwisterResources;
  private readonly instances = new Map<number, ActiveTwisterInstance>();
  private nextLocalId = 9000;
  private heightAt: (x: number, z: number) => number = () => 0;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'weather-twister-fx';
    this.scene.add(this.group);
    this.pineTreeGeo = makePineGeo(new THREE.Color(0x265430), new THREE.Color(0x34663a));
    this.broadleafTreeGeo = makeBroadleafGeo(new THREE.Color(0x285832), new THREE.Color(0x36693c), 17);
    this.treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true, color: new THREE.Color(0x7d9180), roughness: 0.88, metalness: 0.04,
    });
    this.res = createSharedTwisterResources(this.pineTreeGeo, this.broadleafTreeGeo, this.treeMat);
  }

  public setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightAt = fn;
  }

  public spawnTwister(opts: SpawnTwisterOpts = {}): number {
    if (opts.heightAt) this.heightAt = opts.heightAt;
    const id = opts.id ?? this.nextLocalId++;
    if (this.instances.has(id)) return id;

    const q = opts.q ?? opts.x ?? 0;
    const r = opts.r ?? opts.y ?? 0;
    const [defaultWx, defaultWz] = tileXZ(q, r);
    const wx = opts.wx ?? defaultWx;
    const wz = opts.wz ?? defaultWz;
    const dirRad = opts.dirRad ?? (opts.dirDeg !== undefined ? (opts.dirDeg * Math.PI) / 180 : Math.random() * Math.PI * 2);

    if (opts.id !== undefined) {
      for (const [oldId, preview] of this.instances) {
        if (!preview.syncedFromSim && !preview.dissipating && preview.age < 2.5) {
          this.instances.delete(oldId);
          preview.id = id; preview.syncedFromSim = true;
          preview.targetWx = wx; preview.targetWz = wz; preview.dirRad = dirRad;
          if (opts.durationS !== undefined) preview.durationS = opts.durationS;
          preview.root.name = `twister-instance-${id}`;
          this.instances.set(id, preview);
          return id;
        }
      }
    }

    const wy = this.heightAt(wx, wz);
    const root = new THREE.Group();
    root.name = `twister-instance-${id}`;
    root.position.set(wx, wy, wz);
    this.group.add(root);

    const layerSpecs: Array<{ layer: 'outer' | 'mid' | 'inner'; radiusScale: number; heightScale: number }> = [
      { layer: 'outer', radiusScale: 1.08, heightScale: 1.0 },
      { layer: 'mid', radiusScale: 0.82, heightScale: 0.98 },
      { layer: 'inner', radiusScale: 0.56, heightScale: 0.95 },
    ];
    const funnelLayers: FunnelLayerBinding[] = layerSpecs.map((spec) => {
      const mat = createTwisterFunnelMaterial({ layer: spec.layer });
      const mesh = new THREE.Mesh(this.res.funnelGeo, mat);
      root.add(mesh);
      return { mesh, mat, radiusScale: spec.radiusScale, heightScale: spec.heightScale };
    });

    const dustSkirtMat = createTwisterDustSkirtMaterial();
    const dustSkirtMesh = new THREE.Mesh(this.res.dustSkirtGeo, dustSkirtMat);
    const dustDiscMesh = new THREE.Mesh(this.res.dustDiscGeo, dustSkirtMat);
    root.add(dustSkirtMesh, dustDiscMesh);

    const vortexParticles: THREE.Mesh[] = [];
    for (let i = 0; i < VORTEX_PARTICLE_COUNT; i++) {
      const particle = createVortexDebrisParticle(this.res, i);
      root.add(particle);
      vortexParticles.push(particle);
    }

    const inst: ActiveTwisterInstance = {
      id, root, funnelLayers, dustSkirtMesh, dustDiscMesh, dustSkirtMat, vortexParticles,
      baseWx: wx, baseWz: wz, wx, wy, wz, targetWx: wx, targetWz: wz,
      dirRad, speedMps: 3.1, age: 0, elapsed: 0, bendX: 0, bendZ: 0,
      durationS: opts.durationS ?? 14.0, syncedFromSim: opts.id !== undefined,
      dissipating: false, dissipateAge: 0, seenTrees: new Set(), seenUnits: new Set(), victims: [],
    };
    this.instances.set(id, inst);
    this.updateTwisterMotion(inst, 0, Math.max(8, readWeatherParams().twisterHeight || 18));

    if (opts.previewVictims !== false) {
      this.suckTree(id, q + 1, r);
      this.suckUnit(id, { q: q - 1, r: r + 1 });
    }
    return id;
  }

  public suckTree(twisterId: number, q: number, r: number): void {
    const inst = this.instances.get(twisterId);
    const key = `${q},${r}`;
    if (!inst || inst.seenTrees.has(key)) return;
    inst.seenTrees.add(key);
    const { group, victim } = buildVictimInstance(this.res, 'tree', inst.seenTrees.size * 1.7);
    inst.root.add(group);
    inst.victims.push(victim);
  }

  public suckUnit(twisterId: number, unit: TwisterUnitVictimSpec | number): void {
    const inst = this.instances.get(twisterId);
    if (!inst) return;
    const spec: TwisterUnitVictimSpec = typeof unit === 'number' ? { entityId: unit } : unit;
    const entityId = spec.entityId ?? spec.id;
    const key = entityId !== undefined ? `id:${entityId}` : `pos:${spec.q ?? spec.x ?? 0},${spec.r ?? spec.y ?? 0}`;
    if (inst.seenUnits.has(key)) return;
    inst.seenUnits.add(key);
    const { group, victim } = buildVictimInstance(this.res, 'unit', inst.seenUnits.size * 2.3 + 0.8, entityId);
    inst.root.add(group);
    inst.victims.push(victim);
  }

  public syncTwisters(
    activeTwisters: ReadonlyArray<ActiveTwisterSnapshot> | undefined,
    heightAt?: (x: number, z: number) => number,
    _currentTick = 0,
  ): void {
    if (heightAt) this.heightAt = heightAt;
    if (!activeTwisters) return;

    const activeIds = new Set<number>();
    for (const snap of activeTwisters) {
      const id = snap.id ?? snap.twisterId ?? 1;
      activeIds.add(id);
      const [wx, wz] = tileXZ(snap.x ?? snap.q ?? 0, snap.y ?? snap.r ?? 0);
      const dirRad = snap.dirRad ?? (snap.dirDeg !== undefined ? (snap.dirDeg * Math.PI) / 180 : 0.6);

      if (!this.instances.has(id)) {
        this.spawnTwister({
          id, wx, wz, dirRad,
          durationS: snap.durationTicks ? snap.durationTicks * 0.1 + 3.0 : 16.0,
          previewVictims: false, heightAt: this.heightAt,
        });
      }
      const inst = this.instances.get(id)!;
      inst.syncedFromSim = true;
      inst.targetWx = wx;
      inst.targetWz = wz;
      inst.dirRad = dirRad;
      if (snap.ageTicks !== undefined && snap.durationTicks !== undefined) {
        if ((snap.durationTicks - snap.ageTicks) * 0.1 <= DISSIPATE_DURATION) inst.dissipating = true;
      }
      for (const tree of snap.uprootedTrees ?? []) this.suckTree(id, tree.q, tree.r);
      for (const u of snap.suckedUnits ?? []) this.suckUnit(id, u);
    }

    for (const [id, inst] of this.instances) {
      if (inst.syncedFromSim && !activeIds.has(id)) inst.dissipating = true;
    }
  }

  private removeInstance(id: number, inst: ActiveTwisterInstance): void {
    this.group.remove(inst.root);
    for (const layer of inst.funnelLayers) layer.mat.dispose();
    inst.dustSkirtMat.dispose();
    this.instances.delete(id);
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    const maxHeight = Math.max(8, readWeatherParams().twisterHeight || 18);
    for (const [id, inst] of [...this.instances]) {
      inst.age += step;
      inst.elapsed += step;
      if (!inst.syncedFromSim && inst.age >= Math.max(RISE_DURATION, inst.durationS - DISSIPATE_DURATION)) {
        inst.dissipating = true;
      }
      if (inst.dissipating) {
        inst.dissipateAge += step;
        if (inst.dissipateAge >= DISSIPATE_DURATION && inst.victims.every((v) => v.age >= VICTIM_TOTAL_END)) {
          this.removeInstance(id, inst);
          continue;
        }
      }
      this.updateTwisterMotion(inst, step, maxHeight);
      this.updateTwisterVictims(inst, step);
    }
  }

  private updateTwisterMotion(inst: ActiveTwisterInstance, dt: number, maxHeight: number): void {
    const prevWx = inst.wx;
    const prevWz = inst.wz;

    if (inst.syncedFromSim) {
      const follow = Math.min(1, dt * 6.5);
      inst.baseWx += (inst.targetWx - inst.baseWx) * follow;
      inst.baseWz += (inst.targetWz - inst.baseWz) * follow;
      const weave = Math.sin(inst.elapsed * 1.45 + inst.id * 1.7) * 1.65 + Math.cos(inst.elapsed * 0.78 + inst.id * 0.9) * 0.95;
      inst.wx = inst.baseWx - Math.sin(inst.dirRad) * weave;
      inst.wz = inst.baseWz + Math.cos(inst.dirRad) * weave;
    } else {
      inst.dirRad += (Math.sin(inst.elapsed * 0.85 + inst.id * 1.7) * 0.55 + Math.cos(inst.elapsed * 0.43 + inst.id * 0.9) * 0.35) * dt;
      inst.baseWx += Math.cos(inst.dirRad) * inst.speedMps * dt;
      inst.baseWz += Math.sin(inst.dirRad) * inst.speedMps * dt;
      const lateralWave = Math.sin(inst.elapsed * 1.6 + inst.id * 1.3) * 0.95;
      inst.wx = inst.baseWx - Math.sin(inst.dirRad) * lateralWave;
      inst.wz = inst.baseWz + Math.cos(inst.dirRad) * lateralWave;
    }

    inst.wy = this.heightAt(inst.wx, inst.wz);
    inst.root.position.set(inst.wx, inst.wy, inst.wz);

    const vx = dt > 1e-4 ? (inst.wx - prevWx) / dt : 0;
    const vz = dt > 1e-4 ? (inst.wz - prevWz) / dt : 0;
    const targetBendX = -vx * 0.32 + Math.sin(inst.elapsed * 1.5 + inst.id) * 1.15;
    const targetBendZ = -vz * 0.32 + Math.cos(inst.elapsed * 1.2 + inst.id * 0.7) * 1.15;
    const bendFollow = Math.min(1, dt * 4.5);
    inst.bendX += (targetBendX - inst.bendX) * bendFollow;
    inst.bendZ += (targetBendZ - inst.bendZ) * bendFollow;

    const appearProgress = Math.min(1, inst.age / RISE_DURATION);
    const appearEase = appearProgress * appearProgress * (3 - 2 * appearProgress);
    const dissolveProgress = inst.dissipating ? Math.min(1, inst.dissipateAge / DISSIPATE_DURATION) : 0;
    const dissolveEase = dissolveProgress * dissolveProgress * (3 - 2 * dissolveProgress);
    const currentTopY = 0.5 + (maxHeight - 0.5) * appearEase;

    for (const layer of inst.funnelLayers) {
      const radiusEnv = layer.radiusScale * (1 - dissolveEase * 0.35);
      layer.mesh.scale.set(radiusEnv, currentTopY * layer.heightScale, radiusEnv);
      layer.mat.uniforms.uTime.value = inst.elapsed;
      layer.mat.uniforms.uFormProgress.value = appearEase;
      layer.mat.uniforms.uDissolve.value = dissolveEase;
      layer.mat.uniforms.uBendX.value = inst.bendX;
      layer.mat.uniforms.uBendZ.value = inst.bendZ;
    }

    const skirtScale = (0.15 + 0.85 * appearEase) * (1 + dissolveEase * 0.25);
    inst.dustSkirtMesh.scale.set(skirtScale, Math.max(0.3, currentTopY * 0.22 * (1 - dissolveEase * 0.55)), skirtScale);
    inst.dustDiscMesh.scale.set(skirtScale * 1.15, 1 - dissolveEase * 0.5, skirtScale * 1.15);
    inst.dustSkirtMat.uniforms.uTime.value = inst.elapsed;
    inst.dustSkirtMat.uniforms.uFormProgress.value = appearEase;
    inst.dustSkirtMat.uniforms.uDissolve.value = dissolveEase;

    const envelope = appearEase * (1 - dissolveEase);
    const midRadiusScale = inst.funnelLayers[1]?.radiusScale ?? 0.82;
    for (let i = 0; i < inst.vortexParticles.length; i++) {
      const p = inst.vortexParticles[i]!;
      const hRatio = ((i / inst.vortexParticles.length) + inst.elapsed * (0.28 + (i % 5) * 0.05)) % 1.0;
      const y = (0.18 + hRatio * currentTopY * 0.92) * appearEase;
      const flare = 0.58 + Math.pow(hRatio, 1.45) * 3.85 + (i % 7) * 0.22 * (0.35 + hRatio);
      const rad = flare * (0.2 + 0.8 * appearEase) * (1 + dissolveEase * 0.85);
      const ang = inst.elapsed * (10.2 - hRatio * 4.0 + (i % 4) * 0.75) + i * 2.39996;
      const [spineX, spineZ] = spineOffsetAt(hRatio, inst.elapsed, inst.bendX, inst.bendZ);
      p.position.set(spineX * midRadiusScale + Math.cos(ang) * rad, y, spineZ * midRadiusScale + Math.sin(ang) * rad);
      p.rotation.set(inst.elapsed * (4.8 + (i % 3)) + i, ang, i * 0.7);
      p.scale.setScalar(Math.max(0.001, (0.55 + (i % 5) * 0.16) * envelope * Math.sin(hRatio * Math.PI)));
    }
  }

  private updateTwisterVictims(inst: ActiveTwisterInstance, dt: number): void {
    const entitiesGroup = this.scene.getObjectByName('online-entities');
    for (const v of inst.victims) {
      v.age += dt;
      if (v.age > VICTIM_TOTAL_END) {
        v.bodyGroup.visible = false;
        v.shatterGroup.visible = false;
        continue;
      }
      if (v.age < SUCTION_END) {
        const u = v.age / SUCTION_END;
        v.angle += 9.0 * dt;
        const r = 0.65 + u * 2.3;
        v.height = u * 14.2;
        const [spineX, spineZ] = spineOffsetAt(u * 0.82, inst.elapsed, inst.bendX, inst.bendZ);
        const lx = spineX + Math.cos(v.angle) * r;
        const lz = spineZ + Math.sin(v.angle) * r;
        v.bodyGroup.position.set(lx, v.height, lz);
        v.bodyGroup.rotation.set(v.age * 6.5, v.angle, v.age * 4.8);
        this.syncOnlineEntityVictim(entitiesGroup, v.entityId, inst.wx + lx, inst.wy + v.height, inst.wz + lz, v.age * 6.5);
      } else if (!v.shattered) {
        v.vy -= 22.0 * dt;
        v.height += v.vy * dt;
        const nextX = v.bodyGroup.position.x + v.flungVx * dt;
        const nextZ = v.bodyGroup.position.z + v.flungVz * dt;
        v.bodyGroup.position.set(nextX, Math.max(0, v.height), nextZ);
        v.bodyGroup.rotation.x += 8.5 * dt;
        v.bodyGroup.rotation.z += 7.2 * dt;
        this.syncOnlineEntityVictim(entitiesGroup, v.entityId, inst.wx + nextX, inst.wy + Math.max(0, v.height), inst.wz + nextZ, v.age * 8);
        if (v.height <= 0.15) {
          v.shattered = true; v.shatterAge = 0; v.bodyGroup.visible = false;
          v.shatterGroup.visible = true; v.shatterGroup.position.set(nextX, 0.15, nextZ);
        }
      } else {
        v.shatterAge += dt;
        const fade = Math.max(0, 1 - v.shatterAge / 0.65);
        v.sparkFlash.scale.setScalar(Math.max(0.01, 2.6 * (1 - v.shatterAge * 2.5)));
        for (const p of v.shatterPieces) {
          p.vel.y -= 18.0 * dt;
          p.pos.addScaledVector(p.vel, dt);
          if (p.pos.y < 0.08 && p.vel.y < 0) { p.pos.y = 0.08; p.vel.y = -p.vel.y * 0.3; }
          p.mesh.position.copy(p.pos);
          p.mesh.scale.setScalar(Math.max(0.01, fade));
        }
      }
    }
  }

  private syncOnlineEntityVictim(
    entitiesGroup: THREE.Object3D | undefined, entityId: number | undefined, wx: number, wy: number, wz: number, spin: number,
  ): void {
    if (!entitiesGroup || entityId === undefined) return;
    for (const child of entitiesGroup.children) {
      if (child.userData?.entityId === entityId) {
        child.position.set(wx, wy, wz);
        child.rotation.x = spin;
        child.rotation.z = spin * 0.7;
        break;
      }
    }
  }

  public getActiveCount(): number { return this.instances.size; }
  public getTotalVictimCount(): number {
    let total = 0;
    for (const inst of this.instances.values()) total += inst.victims.length;
    return total;
  }

  public dispose(): void {
    for (const [id, inst] of [...this.instances]) this.removeInstance(id, inst);
    this.scene.remove(this.group);
    for (const g of this.res.geos) g.dispose();
    for (const m of this.res.mats) m.dispose();
    this.res.geos.length = 0;
    this.res.mats.length = 0;
  }
}
