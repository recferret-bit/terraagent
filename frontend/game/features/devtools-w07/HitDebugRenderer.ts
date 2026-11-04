import * as THREE from 'three';
import { tileXZ } from '@terra/render/planets/hex';
import type { PendingProjectileImpact, ProjectileImpactsBlob } from '@terra/sim';
import type { FeatureContext, GameView, RendererInstance } from '../../core/registry/types';
import '../shared/scene3d';

const MAX_DEBUG_MARKERS = 64;
const SQRT3 = Math.sqrt(3);

export interface HitDebugAimPoint {
  id: string;
  attackerId: number;
  targetId?: number;
  weaponId?: string;
  x: number;
  y: number;
  q: number;
  r: number;
  aoe: number;
  splashRadius: number;
  radiusWorld: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  tick: number;
}

export interface HitDebugCircle {
  id: string;
  attackerId: number;
  targetId?: number;
  weaponId?: string;
  x: number;
  y: number;
  q: number;
  r: number;
  aoe: number;
  splashRadius: number;
  radiusWorld: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  hit: boolean;
  tick: number;
}

export interface HitDebugService extends RendererInstance {
  readonly group: THREE.Group;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): boolean;
  toggle(enabled?: boolean): boolean;
  getAimPoints(): ReadonlyArray<HitDebugAimPoint>;
  getHitCircles(): ReadonlyArray<HitDebugCircle>;
  getDomElement(): HTMLElement | null;
  recordProjectileFired(ev: Record<string, unknown>): void;
  recordProjectileImpact(ev: Record<string, unknown>): void;
  clear(): void;
}

function unwrapEventPayload(raw: Record<string, unknown>): { tick: number; data: Record<string, unknown> } {
  const data =
    raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : raw;
  const tick = Number(raw.atTick ?? raw.tick ?? data.tick ?? data.firedTick ?? data.impactTick ?? 0);
  return { tick: Number.isFinite(tick) ? tick : 0, data };
}

function unwrapImpactsBlob(raw: unknown): ProjectileImpactsBlob | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if ('value' in raw && (raw as { value?: unknown }).value && typeof (raw as { value?: unknown }).value === 'object') {
    return (raw as { value: ProjectileImpactsBlob }).value;
  }
  return raw as ProjectileImpactsBlob;
}

function createCrosshairMesh(point: HitDebugAimPoint): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hit-debug-aim';
  g.position.set(point.worldX, point.worldY + 0.08, point.worldZ);
  g.userData = {
    kind: 'aimPoint',
    id: point.id,
    q: point.q,
    r: point.r,
    x: point.x,
    y: point.y,
    aoe: point.aoe,
    splashRadius: point.splashRadius,
    radius: point.radiusWorld,
    radiusWorld: point.radiusWorld,
  };

  const mat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const barA = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), mat);
  barA.rotation.x = -Math.PI / 2;
  const barB = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.9), mat);
  barB.rotation.x = -Math.PI / 2;
  g.add(barA, barB);
  return g;
}

function createAoeRingMesh(circle: HitDebugCircle): THREE.Mesh {
  const geom = new THREE.RingGeometry(0.9, 1.0, 32);
  geom.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: circle.hit ? 0xff6a13 : 0xfacc15,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'hit-debug-aoe-ring';
  mesh.position.set(circle.worldX, circle.worldY + 0.06, circle.worldZ);
  const r = Math.max(0.25, circle.radiusWorld);
  mesh.scale.set(r, 1, r);
  mesh.userData = {
    kind: 'aoeRing',
    id: circle.id,
    q: circle.q,
    r: circle.r,
    x: circle.x,
    y: circle.y,
    aoe: circle.aoe,
    splashRadius: circle.splashRadius,
    radius: circle.radiusWorld,
    radiusWorld: circle.radiusWorld,
    hit: circle.hit,
  };
  return mesh;
}

export class HitDebugController implements HitDebugService {
  readonly group = new THREE.Group();
  private enabled = false;
  private readonly aimPoints: HitDebugAimPoint[] = [];
  private readonly hitCircles: HitDebugCircle[] = [];
  private readonly seenKeys = new Set<string>();
  private readonly pendingById = new Map<number, PendingProjectileImpact>();
  private readonly disposers: Array<() => void> = [];
  private domEl: HTMLElement | null = null;
  private boundStore: unknown = null;

  constructor(private ctx: FeatureContext) {
    this.group.name = 'hit-debug-overlay';
    this.group.visible = false;
    this.attachToContext(ctx);
  }

  attachToContext(ctx: FeatureContext): void {
    this.ctx = ctx;
    const scene = ctx.services.scene3d?.scene;
    if (scene && !scene.children.includes(this.group)) {
      scene.add(this.group);
    }
    const store = ctx.services.store;
    if (store && store !== this.boundStore) {
      this.boundStore = store;
      if (typeof store.onServerEvents === 'function') {
        this.disposers.push(store.onServerEvents((ev) => this.ingestEvents(ev)));
      }
      if (typeof store.onRenderEvents === 'function') {
        this.disposers.push(store.onRenderEvents((ev) => this.ingestEvents(ev)));
      }
      if (typeof store.onView === 'function') {
        this.disposers.push(store.onView((v) => this.syncViewBlobs(v)));
      }
      if (store.latest) {
        this.syncViewBlobs(store.latest);
      }
    }
    this.syncDomIndicator();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = Boolean(enabled);
    this.group.visible = this.enabled;
    const scene = this.ctx.services.scene3d?.scene;
    if (scene && !scene.children.includes(this.group)) {
      scene.add(this.group);
    }
    if (this.enabled && this.ctx.services.store?.latest) {
      this.syncViewBlobs(this.ctx.services.store.latest);
    }
    this.syncDomIndicator();
    return this.enabled;
  }

  toggle(enabled?: boolean): boolean {
    return this.setEnabled(typeof enabled === 'boolean' ? enabled : !this.enabled);
  }

  getAimPoints(): ReadonlyArray<HitDebugAimPoint> {
    return this.aimPoints;
  }

  getHitCircles(): ReadonlyArray<HitDebugCircle> {
    return this.hitCircles;
  }

  getDomElement(): HTMLElement | null {
    return this.domEl;
  }

  private tileToWorld(x: number, y: number): { x: number; y: number; z: number } {
    const s3d = this.ctx.services.scene3d;
    if (s3d && typeof s3d.tileToWorld === 'function') {
      return s3d.tileToWorld(x, y);
    }
    const [wx, wz] = tileXZ(x, y);
    return { x: wx, y: 0, z: wz };
  }

  recordProjectileFired(ev: Record<string, unknown>): void {
    const { tick, data } = unwrapEventPayload(ev);
    const toObj = data.to && typeof data.to === 'object' ? (data.to as Record<string, unknown>) : undefined;
    const x = Number(data.aimX ?? toObj?.x ?? data.aimQ ?? toObj?.q ?? data.q ?? 0);
    const y = Number(data.aimY ?? toObj?.y ?? data.aimR ?? toObj?.r ?? data.r ?? 0);
    const q = Math.round(Number(data.aimQ ?? toObj?.q ?? x));
    const r = Math.round(Number(data.aimR ?? toObj?.r ?? y));
    const attackerId = Number(data.attackerId ?? 0);
    const targetId = typeof data.targetId === 'number' ? data.targetId : undefined;
    const weaponId = typeof data.weaponId === 'string' ? data.weaponId : undefined;
    const aoe = Math.max(0, Number(data.aoe ?? 0));
    const splashRadius = aoe;
    const radiusWorld = splashRadius * SQRT3;
    const key = `aim:${attackerId}:${tick}:${q},${r}:${x.toFixed(2)},${y.toFixed(2)}`;
    if (this.seenKeys.has(key)) return;
    this.seenKeys.add(key);

    const world = this.tileToWorld(x, y);
    const point: HitDebugAimPoint = {
      id: key,
      attackerId,
      ...(targetId !== undefined ? { targetId } : {}),
      ...(weaponId !== undefined ? { weaponId } : {}),
      x,
      y,
      q,
      r,
      aoe,
      splashRadius,
      radiusWorld,
      worldX: world.x,
      worldY: world.y,
      worldZ: world.z,
      tick,
    };
    this.aimPoints.push(point);
    if (this.aimPoints.length > MAX_DEBUG_MARKERS) this.aimPoints.shift();
    this.group.add(createCrosshairMesh(point));

    if (aoe > 0) {
      this.addHitCircle({
        id: `aoe:${key}`,
        attackerId,
        ...(targetId !== undefined ? { targetId } : {}),
        ...(weaponId !== undefined ? { weaponId } : {}),
        x,
        y,
        q,
        r,
        aoe,
        splashRadius,
        radiusWorld,
        worldX: world.x,
        worldY: world.y,
        worldZ: world.z,
        hit: false,
        tick,
      });
    }
    this.syncDomIndicator();
  }

  recordProjectileImpact(ev: Record<string, unknown>): void {
    const { tick, data } = unwrapEventPayload(ev);
    const atObj =
      (data.at && typeof data.at === 'object' ? (data.at as Record<string, unknown>) : undefined) ??
      (data.to && typeof data.to === 'object' ? (data.to as Record<string, unknown>) : undefined);
    const x = Number(data.aimX ?? atObj?.x ?? data.q ?? atObj?.q ?? 0);
    const y = Number(data.aimY ?? atObj?.y ?? data.r ?? atObj?.r ?? 0);
    const q = Math.round(Number(data.q ?? atObj?.q ?? x));
    const r = Math.round(Number(data.r ?? atObj?.r ?? y));
    const attackerId = Number(data.attackerId ?? 0);
    const targetId = typeof data.targetId === 'number' ? data.targetId : undefined;
    const weaponId = typeof data.weaponId === 'string' ? data.weaponId : undefined;
    const aoe = Math.max(0, Number(data.aoe ?? 0));
    const splashRadius = aoe > 0 ? aoe : 0.5;
    const radiusWorld = splashRadius * SQRT3;
    const hit = Boolean(data.hit);
    const key = `impact:${attackerId}:${tick}:${q},${r}:${x.toFixed(2)},${y.toFixed(2)}`;
    if (this.seenKeys.has(key)) return;
    this.seenKeys.add(key);

    this.recordProjectileFired({
      atTick: tick,
      data: { attackerId, targetId, weaponId, aimX: x, aimY: y, aimQ: q, aimR: r, aoe },
    });

    const world = this.tileToWorld(x, y);
    this.addHitCircle({
      id: key,
      attackerId,
      ...(targetId !== undefined ? { targetId } : {}),
      ...(weaponId !== undefined ? { weaponId } : {}),
      x,
      y,
      q,
      r,
      aoe,
      splashRadius,
      radiusWorld,
      worldX: world.x,
      worldY: world.y,
      worldZ: world.z,
      hit,
      tick,
    });
    this.syncDomIndicator();
  }

  private addHitCircle(circle: HitDebugCircle): void {
    if (this.hitCircles.some((c) => c.id === circle.id)) return;
    this.hitCircles.push(circle);
    if (this.hitCircles.length > MAX_DEBUG_MARKERS) this.hitCircles.shift();
    this.group.add(createAoeRingMesh(circle));
  }

  private ingestEvents(events: ReadonlyArray< unknown > | undefined): void {
    if (!Array.isArray(events)) return;
    for (const raw of events) {
      if (!raw || typeof raw !== 'object') continue;
      const ev = raw as Record<string, unknown>;
      if (ev.kind === 'projectileFired') {
        this.recordProjectileFired(ev);
      } else if (ev.kind === 'projectileImpact') {
        this.recordProjectileImpact(ev);
      }
    }
  }

  private syncViewBlobs(rawView: unknown): void {
    if (!rawView || typeof rawView !== 'object') return;
    const v = rawView as {
      tick?: number;
      blobs?: Record<string, unknown>;
      events?: ReadonlyArray<unknown>;
      sim?: { view?: { tick?: number; blobs?: Record<string, unknown> } };
    };
    if (Array.isArray(v.events)) {
      this.ingestEvents(v.events);
    }
    const tick = Number(v.tick ?? v.sim?.view?.tick ?? 0);
    const blob =
      unwrapImpactsBlob(v.blobs?.projectileImpacts) ??
      unwrapImpactsBlob(v.sim?.view?.blobs?.projectileImpacts);
    const queue = blob?.queue ?? [];
    const activeIds = new Set<number>();

    for (const item of queue) {
      if (!item || typeof item !== 'object') continue;
      activeIds.add(item.id);
      this.pendingById.set(item.id, item);
      this.recordProjectileFired({
        atTick: item.firedTick,
        data: {
          attackerId: item.attackerId,
          targetId: item.targetId,
          weaponId: item.weaponId,
          aimX: item.to?.x ?? 0,
          aimY: item.to?.y ?? 0,
          aimQ: item.to?.q ?? 0,
          aimR: item.to?.r ?? 0,
          aoe: item.aoe ?? 0,
        },
      });
    }

    for (const [id, item] of this.pendingById.entries()) {
      if (!activeIds.has(id) && tick >= item.impactTick) {
        this.pendingById.delete(id);
        this.recordProjectileImpact({
          atTick: item.impactTick,
          data: {
            attackerId: item.attackerId,
            targetId: item.targetId,
            weaponId: item.weaponId,
            aimX: item.to?.x ?? 0,
            aimY: item.to?.y ?? 0,
            q: item.to?.q ?? 0,
            r: item.to?.r ?? 0,
            aoe: item.aoe ?? 0,
            hit: false,
          },
        });
      }
    }
  }

  private syncDomIndicator(): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (!this.domEl || !this.domEl.isConnected) {
      const existing = document.querySelector('[data-testid="hit-debug-overlay"]') as HTMLElement | null;
      this.domEl = existing ?? document.createElement('div');
      this.domEl.setAttribute('data-testid', 'hit-debug-overlay');
      this.domEl.style.pointerEvents = 'none';
      if (!this.domEl.isConnected) {
        document.body.appendChild(this.domEl);
      }
    }
    this.domEl.hidden = !this.enabled;
    this.domEl.setAttribute('data-enabled', this.enabled ? 'true' : 'false');
    this.domEl.setAttribute('data-aim-count', String(this.aimPoints.length));
    this.domEl.setAttribute('data-aoe-count', String(this.hitCircles.length));
    this.domEl.setAttribute('data-impact-count', String(this.hitCircles.length));
  }

  clear(): void {
    this.aimPoints.length = 0;
    this.hitCircles.length = 0;
    this.seenKeys.clear();
    this.pendingById.clear();
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]!);
    }
    this.syncDomIndicator();
  }

  update(view?: GameView, _dt = 0): void {
    if (view) this.syncViewBlobs(view);
    if (this.ctx.services.store?.latest) this.syncViewBlobs(this.ctx.services.store.latest);
  }

  dispose(): void {
    for (const off of this.disposers.splice(0)) off();
    this.group.parent?.remove(this.group);
    this.domEl?.remove();
    this.domEl = null;
  }
}

export function ensureHitDebugService(ctx: FeatureContext): HitDebugController {
  const existing = (ctx.services as { hitDebug?: HitDebugService }).hitDebug;
  if (existing instanceof HitDebugController) {
    existing.attachToContext(ctx);
    return existing;
  }
  const ctl = new HitDebugController(ctx);
  (ctx.services as { hitDebug?: HitDebugService }).hitDebug = ctl;
  return ctl;
}

export function createHitDebugRenderer(ctx: FeatureContext): HitDebugService {
  return ensureHitDebugService(ctx);
}
