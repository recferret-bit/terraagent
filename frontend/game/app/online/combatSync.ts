import type * as THREE from 'three';
import type { ServerMessage, SimEventWire } from '@terra/contracts';
import type { HexTerrain } from '@terra/render/planets/hex';
import {
  axialToWorldVfxPoint,
  LASER_BEAM_DURATION_S,
  ProjectileVfxSystem,
  resolveVfxWeaponKind,
  type ProjectileVfxPoolConfig,
  type SimProjectileFiredEventLike,
  type SimProjectileFiredPayloadLike,
  type SimProjectileImpactEventLike,
  type SimProjectileImpactPayloadLike,
  type VfxWeaponKind,
} from '@terra/render/visuals/projectiles';
import {
  applyFaunaDirective,
  applyFaunaSparseCorrection,
  FaunaReplicaController,
  type ApplyFaunaDirectiveOptions,
  type ApplyFaunaDirectiveResult,
  type CompiledDataLike,
  type FaunaCheckpoint,
  type FaunaDirective,
  type FaunaSparseCorrection,
  type PendingProjectileImpact,
  type PlanetState,
  type ProjectileImpactsBlob,
} from '@terra/sim';
import { forEachEntity, type ClientView } from '../../store/replica/viewCodec';
import type { WorldStore } from '../../store/WorldStore';

const DEFAULT_WINDOW_SIZE = 2048;
const MAX_HISTORY_ENTRIES = 512;
const SIM_TICKS_PER_SECOND = 5;

export interface RecordedProjectileFired {
  key: string;
  atTick: number;
  attackerId: number;
  targetId?: number;
  weaponKind: VfxWeaponKind;
  weaponId?: string;
  fromQ: number;
  fromR: number;
  targetQ: number;
  targetR: number;
  aoe: number;
  damage: number;
}

export interface RecordedProjectileImpact {
  key: string;
  atTick: number;
  attackerId: number;
  targetId?: number;
  weaponKind: VfxWeaponKind;
  weaponId?: string;
  q: number;
  r: number;
  hit: boolean;
  aoe: number;
  damage: number;
  hitEntityIds: number[];
}

function unwrapPayload<T extends object>(ev: unknown): { atTick?: number; kind?: string; data: T } {
  if (ev && typeof ev === 'object') {
    const obj = ev as { atTick?: number; tick?: number; kind?: string; data?: T };
    const atTick = typeof obj.atTick === 'number' ? obj.atTick : obj.tick;
    if (obj.data && typeof obj.data === 'object') {
      return { atTick, kind: obj.kind, data: obj.data };
    }
    return { atTick, kind: obj.kind, data: obj as unknown as T };
  }
  return { data: {} as T };
}

function resolveFiredTick(atTick: number | undefined, data: SimProjectileFiredPayloadLike & { firedTick?: number }): number {
  if (typeof atTick === 'number' && Number.isFinite(atTick)) return Math.round(atTick);
  if (typeof data.tick === 'number' && Number.isFinite(data.tick)) return Math.round(data.tick);
  if (typeof data.firedTick === 'number' && Number.isFinite(data.firedTick)) return Math.round(data.firedTick);
  if (typeof data.impactTick === 'number' && typeof data.flightTicks === 'number') {
    return Math.round(data.impactTick - data.flightTicks);
  }
  return 0;
}

function resolveImpactTick(atTick: number | undefined, data: SimProjectileImpactPayloadLike): number {
  if (typeof atTick === 'number' && Number.isFinite(atTick)) return Math.round(atTick);
  if (typeof data.tick === 'number' && Number.isFinite(data.tick)) return Math.round(data.tick);
  return 0;
}

/**
 * Canonical deduplication key for a projectile launch (`fired:${attackerId}:${atTick}:${weaponType}:${targetId ?? ''}:${targetQ},${targetR}`).
 */
export function canonicalProjectileFiredKey(
  ev: SimProjectileFiredEventLike | { atTick?: number; kind?: string; data: SimProjectileFiredPayloadLike },
): string {
  const { atTick, data } = unwrapPayload<SimProjectileFiredPayloadLike & { firedTick?: number }>(ev);
  const attackerId = Number(data.attackerId ?? 0);
  const tick = resolveFiredTick(atTick, data);
  const weaponType = resolveVfxWeaponKind({
    weaponKind: data.weaponKind,
    weaponType: data.weaponType,
    weaponId: data.weaponId,
    arc: data.arc,
  });
  const targetId = data.targetId !== undefined && data.targetId !== null ? String(data.targetId) : '';
  const targetQ = Math.round(Number(data.aimQ ?? data.to?.q ?? data.aimX ?? data.to?.x ?? data.q ?? 0));
  const targetR = Math.round(Number(data.aimR ?? data.to?.r ?? data.aimY ?? data.to?.y ?? data.r ?? 0));
  return `fired:${attackerId}:${tick}:${weaponType}:${targetId}:${targetQ},${targetR}`;
}

/**
 * Canonical deduplication key for a projectile impact (`impact:${attackerId ?? 0}:${atTick}:${weaponType}:${q},${r}`).
 */
export function canonicalProjectileImpactKey(
  ev: SimProjectileImpactEventLike | { atTick?: number; kind?: string; data: SimProjectileImpactPayloadLike },
): string {
  const { atTick, data } = unwrapPayload<SimProjectileImpactPayloadLike>(ev);
  const attackerId = Number(data.attackerId ?? 0);
  const tick = resolveImpactTick(atTick, data);
  const weaponType = resolveVfxWeaponKind({
    weaponKind: data.weaponKind,
    weaponType: data.weaponType,
    weaponId: data.weaponId,
  });
  const q = Math.round(Number(data.q ?? data.at?.q ?? data.to?.q ?? data.aimX ?? data.at?.x ?? data.to?.x ?? 0));
  const r = Math.round(Number(data.r ?? data.at?.r ?? data.to?.r ?? data.aimY ?? data.at?.y ?? data.to?.y ?? 0));
  return `impact:${attackerId}:${tick}:${weaponType}:${q},${r}`;
}

class BoundedKeyWindow {
  private readonly set = new Set<string>();
  private readonly queue: string[] = [];

  constructor(private readonly maxSize = DEFAULT_WINDOW_SIZE) {}

  has(key: string): boolean { return this.set.has(key); }

  add(key: string): boolean {
    if (this.set.has(key)) return false;
    this.set.add(key);
    this.queue.push(key);
    if (this.queue.length > this.maxSize) {
      const oldest = this.queue.shift();
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return true;
  }

  get size(): number { return this.set.size; }

  clear(): void {
    this.set.clear();
    this.queue.length = 0;
  }
}

/**
 * Client-side fauna directive replay and 5-second sparse correction wrapper (`W07-17`, `W07-33`).
 * Ensures duplicate directive or sparse correction deliveries are idempotent and never duplicate cohorts or bugs.
 */
export class FaunaClientSync {
  readonly replica: FaunaReplicaController;
  readonly appliedDirectiveSeqs = new Set<number>();
  readonly appliedCorrectionKeys = new Set<string>();
  duplicateDirectivesIgnored = 0;
  duplicateCorrectionsIgnored = 0;
  reconciledBugsCount = 0;
  lastCorrectionTick = -1;

  constructor(maxCheckpoints = 32) {
    this.replica = new FaunaReplicaController(maxCheckpoints);
  }

  checkpoint(state: PlanetState): FaunaCheckpoint { return this.replica.checkpoint(state); }

  restore(state: PlanetState, checkpoint: FaunaCheckpoint): void { this.replica.restore(state, checkpoint); }

  applyDirective(
    state: PlanetState,
    directive: FaunaDirective,
    opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult {
    const res = applyFaunaDirective(state, directive, { ...opts, checkpoints: this.replica.checkpoints });
    if (res.status === 'duplicate_ignored') {
      this.duplicateDirectivesIgnored++;
    } else if (res.appliedSeqs) {
      for (const s of res.appliedSeqs) this.appliedDirectiveSeqs.add(s);
    }
    return res;
  }

  applyDirectives(
    state: PlanetState,
    directives: readonly FaunaDirective[],
    opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult[] {
    return directives.map((d) => this.applyDirective(state, d, opts));
  }

  applySparseCorrection(
    state: PlanetState,
    correction: FaunaSparseCorrection,
    data?: CompiledDataLike,
  ): { reconciledCount: number; spawnedCount: number; duplicate: boolean } {
    const key = `${correction.tick}:${correction.seq}`;
    if (this.appliedCorrectionKeys.has(key)) {
      this.duplicateCorrectionsIgnored++;
      return { reconciledCount: 0, spawnedCount: 0, duplicate: true };
    }
    this.appliedCorrectionKeys.add(key);
    this.lastCorrectionTick = Math.max(this.lastCorrectionTick, correction.tick);
    const res = applyFaunaSparseCorrection(state, correction, data);
    this.reconciledBugsCount += res.reconciledCount;
    return { ...res, duplicate: false };
  }

  reset(): void {
    this.appliedDirectiveSeqs.clear();
    this.appliedCorrectionKeys.clear();
    this.duplicateDirectivesIgnored = 0;
    this.duplicateCorrectionsIgnored = 0;
    this.reconciledBugsCount = 0;
    this.lastCorrectionTick = -1;
  }
}

function unwrapImpactsBlob(raw: unknown): ProjectileImpactsBlob | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if ('value' in raw && (raw as { value?: unknown }).value && typeof (raw as { value?: unknown }).value === 'object') {
    return (raw as { value: ProjectileImpactsBlob }).value;
  }
  return raw as ProjectileImpactsBlob;
}

/**
 * Coordinates online combat VFX (`ProjectileVfxSystem`), deduplicates `projectileFired` and `projectileImpact`
 * across prediction (`onRenderEvents`), server (`onServerEvents`), and snapshot/delta `projectileImpacts` blobs,
 * tracks authoritative HP/deaths, and provides `FaunaClientSync` (`W07-17`).
 */
export class CombatSyncController {
  readonly projectiles: ProjectileVfxSystem;
  readonly fauna: FaunaClientSync;
  readonly firedHistory: RecordedProjectileFired[] = [];
  readonly impactHistory: RecordedProjectileImpact[] = [];
  readonly hpByEntityId = new Map<number, number>();
  readonly confirmedDeaths = new Set<number>();
  duplicateFiredIgnored = 0;
  duplicateImpactIgnored = 0;
  vfxFiredSpawnCount = 0;
  vfxImpactSpawnCount = 0;

  private readonly seenFired: BoundedKeyWindow;
  private readonly seenImpacts: BoundedKeyWindow;
  private knownEntityIds = new Set<number>();

  constructor(
    parent?: THREE.Object3D,
    config: ProjectileVfxPoolConfig & { maxWindowSize?: number; maxCheckpoints?: number } = {},
  ) {
    this.projectiles = new ProjectileVfxSystem(parent, config);
    this.fauna = new FaunaClientSync(config.maxCheckpoints ?? 32);
    this.seenFired = new BoundedKeyWindow(config.maxWindowSize ?? DEFAULT_WINDOW_SIZE);
    this.seenImpacts = new BoundedKeyWindow(config.maxWindowSize ?? DEFAULT_WINDOW_SIZE);
  }

  get vfxSpawnCount(): number { return this.vfxFiredSpawnCount + this.vfxImpactSpawnCount; }
  hasSeenFiredKey(key: string): boolean { return this.seenFired.has(key); }
  hasSeenImpactKey(key: string): boolean { return this.seenImpacts.has(key); }

  ingestProjectileFired(
    ev: SimProjectileFiredEventLike | { atTick?: number; kind?: string; data: SimProjectileFiredPayloadLike },
    terrain: HexTerrain | null = null,
    countDuplicate = true,
  ): boolean {
    const key = canonicalProjectileFiredKey(ev);
    if (!this.seenFired.add(key)) {
      if (countDuplicate) this.duplicateFiredIgnored++;
      return false;
    }

    const { atTick, data } = unwrapPayload<SimProjectileFiredPayloadLike & { firedTick?: number }>(ev);
    const tick = resolveFiredTick(atTick, data);
    const weaponKind = resolveVfxWeaponKind({
      weaponKind: data.weaponKind, weaponType: data.weaponType, weaponId: data.weaponId, arc: data.arc,
    });
    const fromQ = Number(data.fromX ?? data.from?.x ?? data.from?.q ?? data.q ?? 0);
    const fromR = Number(data.fromY ?? data.from?.y ?? data.from?.r ?? data.r ?? 0);
    const toQ = Number(data.aimX ?? data.to?.x ?? data.to?.q ?? data.aimQ ?? fromQ);
    const toR = Number(data.aimY ?? data.to?.y ?? data.to?.r ?? data.aimR ?? fromR);

    const tileSizeM = this.projectiles.tileSizeM;
    const fromPt = axialToWorldVfxPoint(fromQ, fromR, 0, tileSizeM);
    fromPt.y = (terrain ? terrain.heightAt(fromPt.x, fromPt.z) : 0) + 0.6;
    const toPt = axialToWorldVfxPoint(toQ, toR, 0, tileSizeM);
    toPt.y = (terrain ? terrain.heightAt(toPt.x, toPt.z) : 0) + 0.6;

    const durationS = weaponKind === 'laser'
      ? LASER_BEAM_DURATION_S
      : data.flightTicks && data.flightTicks > 0 ? data.flightTicks / SIM_TICKS_PER_SECOND : undefined;
    const speedMps = data.speed && data.speed > 0 ? data.speed * tileSizeM : undefined;

    this.projectiles.onProjectileFired({
      weaponKind, weaponType: data.weaponType, weaponId: data.weaponId,
      arc: data.arc === 'indirect' ? 'indirect' : 'direct',
      from: fromPt, to: toPt, speed: speedMps, durationS, aoe: data.aoe ?? 0,
      autoImpactOnArrival: false,
    });
    this.vfxFiredSpawnCount++;

    this.firedHistory.push({
      key, atTick: tick, attackerId: Number(data.attackerId ?? 0),
      ...(typeof data.targetId === 'number' ? { targetId: data.targetId } : {}),
      weaponKind, ...(typeof data.weaponId === 'string' ? { weaponId: data.weaponId } : {}),
      fromQ: Math.round(fromQ), fromR: Math.round(fromR),
      targetQ: Math.round(Number(data.aimQ ?? data.to?.q ?? toQ)),
      targetR: Math.round(Number(data.aimR ?? data.to?.r ?? toR)),
      aoe: Number(data.aoe ?? 0), damage: Number(data.damage ?? 0),
    });
    if (this.firedHistory.length > MAX_HISTORY_ENTRIES) this.firedHistory.shift();
    return true;
  }

  ingestProjectileImpact(
    ev: SimProjectileImpactEventLike | { atTick?: number; kind?: string; data: SimProjectileImpactPayloadLike },
    terrain: HexTerrain | null = null,
    countDuplicate = true,
  ): boolean {
    const key = canonicalProjectileImpactKey(ev);
    if (!this.seenImpacts.add(key)) {
      if (countDuplicate) this.duplicateImpactIgnored++;
      return false;
    }

    const { atTick, data } = unwrapPayload<SimProjectileImpactPayloadLike>(ev);
    const tick = resolveImpactTick(atTick, data);
    const weaponKind = resolveVfxWeaponKind({
      weaponKind: data.weaponKind, weaponType: data.weaponType, weaponId: data.weaponId,
    });
    const heightLookup = terrain ? (wx: number, wz: number) => terrain.heightAt(wx, wz) : undefined;
    this.projectiles.spawnFromSimImpactEvent(ev, heightLookup);
    this.vfxImpactSpawnCount++;

    const hitIds = Array.isArray(data.hitEntityIds)
      ? data.hitEntityIds.map(Number)
      : Array.isArray(data.hitIds) ? data.hitIds.map(Number) : [];
    const q = Math.round(Number(data.q ?? data.at?.q ?? data.to?.q ?? data.aimX ?? data.at?.x ?? data.to?.x ?? 0));
    const r = Math.round(Number(data.r ?? data.at?.r ?? data.to?.r ?? data.aimY ?? data.at?.y ?? data.to?.y ?? 0));

    this.impactHistory.push({
      key, atTick: tick, attackerId: Number(data.attackerId ?? 0),
      ...(typeof data.targetId === 'number' ? { targetId: data.targetId } : {}),
      weaponKind, ...(typeof data.weaponId === 'string' ? { weaponId: data.weaponId } : {}),
      q, r, hit: Boolean(data.hit), aoe: Number(data.aoe ?? 0), damage: Number(data.damage ?? 0), hitEntityIds: hitIds,
    });
    if (this.impactHistory.length > MAX_HISTORY_ENTRIES) this.impactHistory.shift();
    return true;
  }

  ingestCombatEvents(
    events: readonly (SimEventWire | { kind?: string; atTick?: number; tick?: number; data?: Record<string, unknown> })[],
    terrain: HexTerrain | null = null,
  ): void {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      if (ev.kind === 'projectileFired') {
        this.ingestProjectileFired(ev as SimProjectileFiredEventLike, terrain, true);
      } else if (ev.kind === 'projectileImpact') {
        this.ingestProjectileImpact(ev as SimProjectileImpactEventLike, terrain, true);
      } else if (
        ev.kind === 'unitDestroyed' || ev.kind === 'buildingDestroyed' ||
        ev.kind === 'nestDestroyed' || ev.kind === 'faunaKilled'
      ) {
        const d = (ev.data ?? ev) as Record<string, unknown>;
        const deadId = Number(d.entityId ?? d.unitId ?? d.buildingId ?? d.hiveId ?? d.bugId ?? 0);
        if (deadId > 0) {
          this.confirmedDeaths.add(deadId);
          this.hpByEntityId.set(deadId, 0);
        }
      }
    }
  }

  private syncPendingImpactsQueue(queue: readonly PendingProjectileImpact[] | undefined, terrain: HexTerrain | null): void {
    if (!Array.isArray(queue)) return;
    for (const item of queue) {
      if (!item || typeof item !== 'object') continue;
      const payload: SimProjectileFiredPayloadLike & { firedTick: number } = {
        attackerId: item.attackerId, targetId: item.targetId, weaponId: item.weaponId, weaponKind: item.weaponKind,
        fromX: item.from?.x ?? 0, fromY: item.from?.y ?? 0, aimX: item.to?.x ?? 0, aimY: item.to?.y ?? 0,
        q: Math.round(item.from?.q ?? item.from?.x ?? 0), r: Math.round(item.from?.r ?? item.from?.y ?? 0),
        aimQ: Math.round(item.to?.q ?? item.to?.x ?? 0), aimR: Math.round(item.to?.r ?? item.to?.y ?? 0),
        speed: item.speed, flightTicks: Math.max(1, (item.impactTick ?? 0) - (item.firedTick ?? 0)),
        impactTick: item.impactTick, firedTick: item.firedTick, aoe: item.aoe, damage: item.damage, tick: item.firedTick,
      };
      const key = canonicalProjectileFiredKey({ atTick: item.firedTick, data: payload });
      if (!this.seenFired.has(key)) {
        this.ingestProjectileFired({ atTick: item.firedTick, data: payload }, terrain, false);
      }
    }
  }

  syncView(view: ClientView, terrain: HexTerrain | null = null): void {
    const aliveIds = new Set<number>();
    forEachEntity(view.entities, view.count, (e) => {
      if (e.hp > 0) { aliveIds.add(e.id); this.hpByEntityId.set(e.id, e.hp); }
      else { this.confirmedDeaths.add(e.id); this.hpByEntityId.set(e.id, 0); }
    });
    for (const prevId of this.knownEntityIds) {
      if (!aliveIds.has(prevId)) { this.confirmedDeaths.add(prevId); this.hpByEntityId.set(prevId, 0); }
    }
    this.knownEntityIds = aliveIds;
    this.syncPendingImpactsQueue(unwrapImpactsBlob(view.blobs?.projectileImpacts)?.queue, terrain);
  }

  syncPlanetState(state: PlanetState, terrain: HexTerrain | null = null): void {
    const aliveIds = new Set<number>();
    const cols = state.entities.cols;
    for (let r = 0; r < state.entities.count; r++) {
      const id = cols.id[r]!, hp = cols.hp[r]!;
      if (hp > 0) { aliveIds.add(id); this.hpByEntityId.set(id, hp); }
      else { this.confirmedDeaths.add(id); this.hpByEntityId.set(id, 0); }
    }
    for (const prevId of this.knownEntityIds) {
      if (!aliveIds.has(prevId)) { this.confirmedDeaths.add(prevId); this.hpByEntityId.set(prevId, 0); }
    }
    for (const rem of state.entities.removed) {
      this.confirmedDeaths.add(rem.id);
      this.hpByEntityId.set(rem.id, 0);
    }
    this.knownEntityIds = aliveIds;
    this.syncPendingImpactsQueue(unwrapImpactsBlob(state.blobs.projectileImpacts)?.queue, terrain);
  }

  applyFaunaDirective(
    state: PlanetState, directive: FaunaDirective, opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult {
    return this.fauna.applyDirective(state, directive, opts);
  }

  applyFaunaDirectives(
    state: PlanetState, directives: readonly FaunaDirective[], opts?: Omit<ApplyFaunaDirectiveOptions, 'checkpoints'>,
  ): ApplyFaunaDirectiveResult[] {
    return this.fauna.applyDirectives(state, directives, opts);
  }

  applyFaunaSparseCorrection(
    state: PlanetState, correction: FaunaSparseCorrection, data?: CompiledDataLike,
  ): { reconciledCount: number; spawnedCount: number; duplicate: boolean } {
    return this.fauna.applySparseCorrection(state, correction, data);
  }

  update(dtSeconds: number): void { this.projectiles.update(dtSeconds); }

  reset(): void {
    this.seenFired.clear();
    this.seenImpacts.clear();
    this.firedHistory.length = 0;
    this.impactHistory.length = 0;
    this.hpByEntityId.clear();
    this.confirmedDeaths.clear();
    this.knownEntityIds.clear();
    this.duplicateFiredIgnored = 0;
    this.duplicateImpactIgnored = 0;
    this.vfxFiredSpawnCount = 0;
    this.vfxImpactSpawnCount = 0;
    this.fauna.reset();
    this.projectiles.clear();
  }

  dispose(): void { this.projectiles.dispose(); }
}

export function bindStoreCombatEvents(
  store: Pick<WorldStore, 'onServerEvents' | 'onRenderEvents'>,
  combatSync: CombatSyncController,
  getTerrain: () => HexTerrain | null,
): () => void {
  const offServer = store.onServerEvents((events) => combatSync.ingestCombatEvents(events, getTerrain()));
  const offRender = store.onRenderEvents((events) => combatSync.ingestCombatEvents(events, getTerrain()));
  return () => { offServer(); offRender(); };
}

export function ingestHostMessageCombatEvents(
  msg: ServerMessage,
  combatSync: CombatSyncController,
  terrain: HexTerrain | null,
): void {
  if (msg.t === 'delta' && msg.d.events?.length) combatSync.ingestCombatEvents(msg.d.events, terrain);
  else if (msg.t === 'event') combatSync.ingestCombatEvents([msg.d], terrain);
}
