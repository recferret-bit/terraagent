import { resolveVfxWeaponKind, type VfxWeaponKind, type SimProjectileFiredEventLike, type SimProjectileFiredPayloadLike,
  type SimProjectileImpactEventLike, type SimProjectileImpactPayloadLike } from '@terra/render/visuals/projectiles';
const DEFAULT_WINDOW_SIZE = 2048;

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

export function unwrapPayload<T extends object>(ev: unknown): { atTick?: number; kind?: string; data: T } {
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

export function resolveFiredTick(atTick: number | undefined, data: SimProjectileFiredPayloadLike & { firedTick?: number }): number {
  if (typeof atTick === 'number' && Number.isFinite(atTick)) return Math.round(atTick);
  if (typeof data.tick === 'number' && Number.isFinite(data.tick)) return Math.round(data.tick);
  if (typeof data.firedTick === 'number' && Number.isFinite(data.firedTick)) return Math.round(data.firedTick);
  if (typeof data.impactTick === 'number' && typeof data.flightTicks === 'number') {
    return Math.round(data.impactTick - data.flightTicks);
  }
  return 0;
}

export function resolveImpactTick(atTick: number | undefined, data: SimProjectileImpactPayloadLike): number {
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
 * Launch identity distinguishes shots that arrive together; older event payloads retain the legacy key.
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
  const launch = data.firedTick === undefined ? '' : `:fired=${data.firedTick}`;
  return `impact:${attackerId}:${tick}:${weaponType}:${q},${r}${launch}`;
}

export class BoundedKeyWindow {
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

