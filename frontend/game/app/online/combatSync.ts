import { CombatHealthTracker } from './CombatHealthTracker';
import { FaunaClientSync } from './FaunaClientSync';
export { FaunaClientSync } from './FaunaClientSync';
import { BoundedKeyWindow, canonicalProjectileFiredKey, canonicalProjectileImpactKey, unwrapPayload, resolveFiredTick, resolveImpactTick,
  type RecordedProjectileFired, type RecordedProjectileImpact } from './combatEventKeys';
export { canonicalProjectileFiredKey, canonicalProjectileImpactKey, type RecordedProjectileFired, type RecordedProjectileImpact } from './combatEventKeys';
import { PendingCombatShots } from './pendingCombatShots';
import { BattlePresentation } from '@terra/render/combat/BattlePresentation';
import { CombatShotCoordinator } from '@terra/render/combat/CombatShotCoordinator';
import type * as THREE from 'three';
import type { SimEventWire } from '@terra/contracts';
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
} from '@terra/render/visuals/projectiles';
import {
  type ApplyFaunaDirectiveOptions,
  type ApplyFaunaDirectiveResult,
  type CompiledDataLike,
  type FaunaDirective,
  type FaunaSparseCorrection,
  type PendingProjectileImpact,
  type PlanetState,
  type ProjectileImpactsBlob,
} from '@terra/sim';
import { forEachEntity, type ClientView } from '../../store/replica/viewCodec';

const MAX_HISTORY_ENTRIES = 512;
const SIM_TICKS_PER_SECOND = 5;

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
  readonly battle = new BattlePresentation(id => this.meshForEntity?.(id));
  readonly shots: CombatShotCoordinator;
  private readonly pendingShots = new PendingCombatShots();
  private readonly heldImpacts = new Map<string, Array<() => void>>();
  meshForEntity?: (id: number) => THREE.Object3D | undefined;
  readonly firedHistory: RecordedProjectileFired[] = [];
  readonly impactHistory: RecordedProjectileImpact[] = [];
  private readonly health = new CombatHealthTracker(id => this.battle.insects.die(id), id => this.battle.insects.revive(id));
  readonly hpByEntityId = this.health.hp;
  readonly confirmedDeaths = this.health.deaths;
  duplicateFiredIgnored = 0;
  duplicateImpactIgnored = 0;
  vfxFiredSpawnCount = 0;
  vfxImpactSpawnCount = 0;

  private readonly seenFired: BoundedKeyWindow;
  private readonly seenImpacts: BoundedKeyWindow;

  constructor(
    parent?: THREE.Object3D,
    config: ProjectileVfxPoolConfig & { maxWindowSize?: number; maxCheckpoints?: number } = {},
  ) {
    this.projectiles = new ProjectileVfxSystem(parent, config);
    this.shots = new CombatShotCoordinator(this.battle, this.projectiles, id => this.meshForEntity?.(id));
    this.fauna = new FaunaClientSync(config.maxCheckpoints ?? 32);
    this.seenFired = new BoundedKeyWindow(config.maxWindowSize);
    this.seenImpacts = new BoundedKeyWindow(config.maxWindowSize);
  }

  get vfxSpawnCount(): number { return this.vfxFiredSpawnCount + this.vfxImpactSpawnCount; }
  hasSeenFiredKey(key: string): boolean { return this.seenFired.has(key); }
  hasSeenImpactKey(key: string): boolean { return this.seenImpacts.has(key); }

  private buildShotInput(ev: SimProjectileFiredEventLike | { atTick?: number; kind?: string; data: SimProjectileFiredPayloadLike }, terrain: HexTerrain | null) {
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
    const input = {
      weaponKind, weaponType: data.weaponType, weaponId: data.weaponId,
      arc: (data.arc === 'indirect' ? 'indirect' : 'direct') as 'direct' | 'indirect',
      from: fromPt, to: toPt, speed: speedMps, durationS, aoe: data.aoe ?? 0,
      autoImpactOnArrival: false, firedTick: tick, targetId: data.targetId, impactTick: data.impactTick ?? tick,
    };
    return { data, tick, weaponKind, fromQ, fromR, toQ, toR, fromPt, toPt, input };
  }

  ingestProjectileFired(
    ev: SimProjectileFiredEventLike | { atTick?: number; kind?: string; data: SimProjectileFiredPayloadLike },
    terrain: HexTerrain | null = null,
    countDuplicate = true,
  ): boolean {
    const key = canonicalProjectileFiredKey(ev);
    const rawData = unwrapPayload<SimProjectileFiredPayloadLike & { firedTick?: number }>(ev);
    const shooter = Number(rawData.data.attackerId ?? 0);
    const shotTick = resolveFiredTick(rawData.atTick, rawData.data);
    const alignKey = `${shooter}:${shotTick}`;

    if (this.seenFired.has(key) || this.pendingShots.has(key)) {
      if (countDuplicate) this.duplicateFiredIgnored++;
      return false;
    }

    if (this.meshForEntity && !this.meshForEntity(shooter)) {
      this.heldFiredKeys.add(key);
      this.pendingShots.hold(key, (waitedS) => {
        if (!this.meshForEntity?.(shooter)) {
          if (waitedS > 1.8) {
            this.heldFiredKeys.delete(key);
            this.heldImpacts.delete(alignKey);
            return true;
          }
          return false;
        }
        const parsed = this.buildShotInput(ev, terrain);
        if (waitedS > 3.5 || (parsed.input.targetId !== undefined && this.confirmedDeaths.has(parsed.input.targetId))) {
          this.heldFiredKeys.delete(key);
          this.heldImpacts.delete(alignKey);
          return true;
        }
        if (!this.shots.isReadyToFire(shooter, parsed.input)) return false;
        this.emitPreparedFiredShot(key, alignKey, shooter, ev, parsed, terrain, countDuplicate);
        return true;
      });
      return false;
    }

    const parsed = this.buildShotInput(ev, terrain);
    if (!this.shots.isReadyToFire(shooter, parsed.input)) {
      this.heldFiredKeys.add(key);
      this.pendingShots.hold(key, (waitedS) => {
        if (this.meshForEntity && !this.meshForEntity(shooter)) {
          this.heldFiredKeys.delete(key);
          this.heldImpacts.delete(alignKey);
          return true;
        }
        if (waitedS > 3.5 || (parsed.input.targetId !== undefined && this.confirmedDeaths.has(parsed.input.targetId))) {
          this.heldFiredKeys.delete(key);
          this.heldImpacts.delete(alignKey);
          return true;
        }
        if (!this.shots.isReadyToFire(shooter, parsed.input)) return false;
        this.emitPreparedFiredShot(key, alignKey, shooter, ev, parsed, terrain, countDuplicate);
        return true;
      });
      return false;
    }

    return this.emitPreparedFiredShot(key, alignKey, shooter, ev, parsed, terrain, countDuplicate);
  }

  private emitPreparedFiredShot(
    key: string,
    alignKey: string,
    shooter: number,
    _ev: SimProjectileFiredEventLike | { atTick?: number; kind?: string; data: SimProjectileFiredPayloadLike },
    parsed: ReturnType<CombatSyncController['buildShotInput']>,
    terrain: HexTerrain | null,
    countDuplicate: boolean,
  ): boolean {
    this.heldFiredKeys.delete(key);
    if (!this.seenFired.add(key)) {
      if (countDuplicate) this.duplicateFiredIgnored++;
      return false;
    }
    const { data, tick, weaponKind, fromQ, fromR, toQ, toR, fromPt, toPt, input } = parsed;
    this.shots.dispatchShot(shooter, input, { burstSeed: shooter * 31 + tick });
    terrain?.biosphere.noteBattleAt(fromPt.x, fromPt.z);
    terrain?.biosphere.noteBattleAt(toPt.x, toPt.z);
    this.vfxFiredSpawnCount++;

    this.firedHistory.push({
      key, atTick: tick, attackerId: shooter,
      ...(typeof data.targetId === 'number' ? { targetId: data.targetId } : {}),
      weaponKind, ...(typeof data.weaponId === 'string' ? { weaponId: data.weaponId } : {}),
      fromQ: Math.round(fromQ), fromR: Math.round(fromR),
      targetQ: Math.round(Number(data.aimQ ?? data.to?.q ?? toQ)),
      targetR: Math.round(Number(data.aimR ?? data.to?.r ?? toR)),
      aoe: Number(data.aoe ?? 0), damage: Number(data.damage ?? 0),
    });
    if (this.firedHistory.length > MAX_HISTORY_ENTRIES) this.firedHistory.shift();

    const deferredImpacts = this.heldImpacts.get(alignKey);
    if (deferredImpacts) {
      this.heldImpacts.delete(alignKey);
      for (const runImpact of deferredImpacts) runImpact();
    }
    return true;
  }

  ingestProjectileImpact(
    ev: SimProjectileImpactEventLike | { atTick?: number; kind?: string; data: SimProjectileImpactPayloadLike },
    terrain: HexTerrain | null = null,
    countDuplicate = true,
  ): boolean {
    const { atTick, data } = unwrapPayload<SimProjectileImpactPayloadLike>(ev);
    const tick = resolveImpactTick(atTick, data);
    const shooter = Number(data.attackerId ?? 0);
    const firedTick = Number(data.firedTick ?? tick);
    const alignKey = `${shooter}:${firedTick}`;
    if (this.hasPendingShotForAttacker(shooter, firedTick)) {
      const queue = this.heldImpacts.get(alignKey) ?? [];
      queue.push(() => this.ingestProjectileImpact(ev, terrain, countDuplicate));
      this.heldImpacts.set(alignKey, queue);
      return false;
    }

    const key = canonicalProjectileImpactKey(ev);
    if (!this.seenImpacts.add(key)) {
      if (countDuplicate) this.duplicateImpactIgnored++;
      return false;
    }

    const weaponKind = resolveVfxWeaponKind({
      weaponKind: data.weaponKind, weaponType: data.weaponType, weaponId: data.weaponId,
    });
    const heightLookup = terrain ? (wx: number, wz: number) => terrain.heightAt(wx, wz) : undefined;
    this.projectiles.spawnFromSimImpactEvent(ev, heightLookup, this.projectiles.tileSizeM,
      input => this.battle.impact(shooter, { ...input, targetId: data.targetId, impactTick: tick }));
    this.vfxImpactSpawnCount++;

    const hitIds = Array.isArray(data.hitEntityIds)
      ? data.hitEntityIds.map(Number)
      : Array.isArray(data.hitIds) ? data.hitIds.map(Number) : [];
    const q = Math.round(Number(data.q ?? data.at?.q ?? data.to?.q ?? data.aimX ?? data.at?.x ?? data.to?.x ?? 0));
    const r = Math.round(Number(data.r ?? data.at?.r ?? data.to?.r ?? data.aimY ?? data.at?.y ?? data.to?.y ?? 0));
    if (terrain) {
      const impPt = axialToWorldVfxPoint(q, r, 0, this.projectiles.tileSizeM);
      terrain.biosphere.noteBattleAt(impPt.x, impPt.z);
    }

    this.impactHistory.push({
      key, atTick: tick, attackerId: shooter,
      ...(typeof data.targetId === 'number' ? { targetId: data.targetId } : {}),
      weaponKind, ...(typeof data.weaponId === 'string' ? { weaponId: data.weaponId } : {}),
      q, r, hit: Boolean(data.hit), aoe: Number(data.aoe ?? 0), damage: Number(data.damage ?? 0), hitEntityIds: hitIds,
    });
    if (this.impactHistory.length > MAX_HISTORY_ENTRIES) this.impactHistory.shift();
    return true;
  }

  private hasPendingShotForAttacker(attackerId: number, firedTick: number): boolean {
    const prefix = `fired:${attackerId}:${firedTick}:`;
    // Pending keys use canonical fired format
    for (const k of this.heldFiredKeys) {
      if (k.startsWith(prefix) && this.pendingShots.has(k)) return true;
    }
    return false;
  }
  private readonly heldFiredKeys = new Set<string>();

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
          this.health.dead(deadId, Number(ev.atTick ?? ('tick' in ev ? ev.tick : 0) ?? 0));
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
    this.battle.sync(view.blobs?.battle);
    this.battle.insects.sync(view.blobs?.insectActions, view.tick);
    this.health.sync(view.tick, accept => forEachEntity(view.entities, view.count, e => accept(e.id, e.hp)));
    this.syncPendingImpactsQueue(unwrapImpactsBlob(view.blobs?.projectileImpacts)?.queue, terrain);
  }

  syncPlanetState(state: PlanetState, terrain: HexTerrain | null = null): void {
    this.battle.sync(state.blobs.battle);
    this.battle.insects.sync(state.blobs.insectActions, state.meta.tick);
    const cols = state.entities.cols;
    this.health.sync(state.meta.tick, accept => {
      for (let row = 0; row < state.entities.count; row++) accept(cols.id[row]!, cols.hp[row]!);
    });
    for (const removed of state.entities.removed) this.health.dead(removed.id, state.meta.tick);
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

  update(dtSeconds: number): void {
    this.battle.update(dtSeconds);
    this.pendingShots.update(dtSeconds);
    this.shots.update(dtSeconds);
    this.projectiles.update(dtSeconds);
  }

  reset(): void {
    this.battle.clear();
    this.pendingShots.clear();
    this.heldImpacts.clear();
    this.heldFiredKeys.clear();
    this.shots.clear();
    this.seenFired.clear();
    this.seenImpacts.clear();
    this.firedHistory.length = 0;
    this.impactHistory.length = 0;
    this.health.clear();
    this.duplicateFiredIgnored = 0;
    this.duplicateImpactIgnored = 0;
    this.vfxFiredSpawnCount = 0;
    this.vfxImpactSpawnCount = 0;
    this.fauna.reset();
    this.projectiles.clear();
  }

  dispose(): void { this.reset(); this.projectiles.dispose(); }
}

export { bindStoreCombatEvents, ingestHostMessageCombatEvents } from './combatEventBindings';
