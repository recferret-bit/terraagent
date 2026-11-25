import { tileXZ } from '@terra/render/planets/hex';
import type { RangeRingInput } from '@terra/render/visuals/rings';
import { ENTITY_STATE, type CompiledDataLike, type ViewEntity } from '@terra/sim';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { forEachEntity } from '../../store/replica/viewCodec';
import type { PlacementGhostState } from '../construction-menu/PlacementGhost';
import { computeEntityWorldPos } from './ringPosition';
import { normalizeRingEntityKind, resolveEntityRingSpec } from './ringSpecs';

export interface NormalizedRingEntity {
  id: number;
  kindOrName: number | string;
  kind: number;
  owner: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  state: number;
  weaponId?: string;
}

function readWeaponOverridesFromView(rawView: unknown): Record<number, string> {
  const blobs = (rawView as { blobs?: Record<string, unknown> } | null)?.blobs;
  const cw = blobs?.combatWeapons as { byEntityId?: Record<number, string> } | undefined;
  return cw?.byEntityId ?? {};
}

export function extractRingEntities(view: GameView | undefined): NormalizedRingEntity[] {
  if (!view || typeof view !== 'object') return [];
  const v = view as {
    entities?: Float32Array | ViewEntity[] | Array<Record<string, unknown>>;
    count?: number;
    sim?: { view?: { entities?: Float32Array | ViewEntity[]; count?: number; blobs?: Record<string, unknown> } };
  };
  const ents = v.entities ?? v.sim?.view?.entities;
  const count = v.count ?? v.sim?.view?.count;
  const weaponOverrides = {
    ...readWeaponOverridesFromView(v.sim?.view),
    ...readWeaponOverridesFromView(v),
  };
  const out: NormalizedRingEntity[] = [];

  if (ents instanceof Float32Array) {
    forEachEntity(ents, count, (row) => {
      const ax = row.x === 0 && row.y === 0 && (row.q !== 0 || row.r !== 0) ? row.q : row.x;
      const ay = row.x === 0 && row.y === 0 && (row.q !== 0 || row.r !== 0) ? row.r : row.y;
      out.push({
        id: row.id,
        kindOrName: row.kind,
        kind: row.kind,
        owner: row.owner,
        q: row.q,
        r: row.r,
        x: ax,
        y: ay,
        hp: row.hp,
        state: row.state,
        weaponId: weaponOverrides[row.id],
      });
    });
    return out;
  }

  if (Array.isArray(ents)) {
    const n = count !== undefined ? Math.min(count, ents.length) : ents.length;
    for (let i = 0; i < n; i++) {
      const raw = ents[i] as Record<string, unknown> | undefined;
      if (!raw) continue;
      const id = Number(raw.id ?? raw.entityId ?? i + 1);
      const kindOrName = (raw.unit ?? raw.building ?? raw.species ?? raw.kind ?? 0) as number | string;
      const { kind } = normalizeRingEntityKind(kindOrName);
      const q = Number(raw.q ?? raw.x ?? 0);
      const r = Number(raw.r ?? raw.y ?? 0);
      const rx = Number(raw.x ?? q);
      const ry = Number(raw.y ?? r);
      const ax = rx === 0 && ry === 0 && (q !== 0 || r !== 0) ? q : rx;
      const ay = rx === 0 && ry === 0 && (q !== 0 || r !== 0) ? r : ry;
      const hp = Number(raw.hp ?? raw.hpMax ?? 100);
      const state = Number(raw.state ?? ENTITY_STATE.idle);
      const weaponId = typeof raw.weaponId === 'string' ? raw.weaponId : weaponOverrides[id];
      out.push({
        id,
        kindOrName,
        kind,
        owner: Number(raw.owner ?? 0),
        q,
        r,
        x: ax,
        y: ay,
        hp,
        state,
        weaponId,
      });
    }
  }
  return out;
}

export function computeGhostWorldPos(
  ctx: FeatureContext,
  ghost: PlacementGhostState,
): { worldX: number; groundY: number; worldZ: number } {
  const s3 = ctx.services.scene3d;
  if (ghost.tiles && ghost.tiles.length > 0) {
    let sumX = 0;
    let sumZ = 0;
    let maxY = -Infinity;
    for (const t of ghost.tiles) {
      const p = s3 ? s3.tileToWorld(t.q, t.r) : (() => { const [wx, wz] = tileXZ(t.q, t.r); return { x: wx, y: 0, z: wz }; })();
      sumX += p.x;
      sumZ += p.z;
      if (p.y > maxY) maxY = p.y;
    }
    const n = ghost.tiles.length;
    return { worldX: sumX / n, groundY: Number.isFinite(maxY) ? maxY : 0, worldZ: sumZ / n };
  }
  const p = s3 ? s3.tileToWorld(ghost.q, ghost.r) : (() => { const [wx, wz] = tileXZ(ghost.q, ghost.r); return { x: wx, y: 0, z: wz }; })();
  return { worldX: p.x, groundY: p.y, worldZ: p.z };
}

/**
 * Emits at most 2 rings per owned unit or structure:
 * - firing range (`weapon`) when armed/combat-capable
 * - sight radius (`viewRange`) when spotting > 0
 */
export function pushOwnEntityRings(
  out: RangeRingInput[],
  ctx: FeatureContext,
  ent: NormalizedRingEntity,
  data: CompiledDataLike,
): void {
  const spec = resolveEntityRingSpec(ent.kindOrName, data, ent.weaponId);
  const { worldX, groundY, worldZ } = computeEntityWorldPos(ctx, ent.id, spec.kind, ent.x, ent.y);
  if (spec.weaponRangeTiles > 0) {
    out.push({
      entityId: ent.id,
      kind: 'weapon',
      radiusTiles: spec.weaponRangeTiles,
      worldX,
      groundY,
      worldZ,
    });
  }
  if (spec.viewRangeTiles > 0) {
    out.push({
      entityId: ent.id,
      kind: 'viewRange',
      radiusTiles: spec.viewRangeTiles,
      worldX,
      groundY,
      worldZ,
    });
  }
}
