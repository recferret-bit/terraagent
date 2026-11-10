import { MAP_LAYER_META } from '@terra/contracts';
import type { FeatureContext } from '../../core/registry/types';
import { resolveCssToken } from '../../maps/entityDots';
import type { MapLayer, MapLayerDrawView } from '../../maps/types';
import { forEachEntity } from '../../store/replica/viewCodec';

const LIVE = new Set(['open', 'claimed', 'pending']);

export interface BountyMapMarker {
  readonly nestId: string;
  readonly reward: string;
  readonly q: number | null;
  readonly r: number | null;
}

export interface BountyLayerRegistry {
  register(layer: MapLayer): () => void;
}

interface Spot {
  readonly q: number;
  readonly r: number;
}

/** Live clear_nest rows (and defend tiles) become markers. An empty list produces none. */
export function bountyMapMarkers(
  source: unknown,
  nests: ReadonlyMap<string, Spot> = new Map(),
): BountyMapMarker[] {
  const out: BountyMapMarker[] = [];
  for (const row of rowsOf(source)) {
    const marker = markerOf(row, nests);
    if (marker) out.push(marker);
  }
  return out;
}

/** Canvas reward tags. Markers without a tile are skipped. Text is the amount only. */
export function drawBountyMarkers(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  markers: readonly BountyMapMarker[],
): void {
  const placed = markers.filter((marker) => marker.q !== null && marker.r !== null);
  if (placed.length === 0) return;
  ctx.save();
  ctx.font = '600 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = resolveCssToken('--ta-void', '#07080A');
  ctx.fillStyle = resolveCssToken('--ta-orange', '#FF6A13');
  const used = new Map<string, number>();
  for (const marker of placed) paintTag(ctx, view, marker, used);
  ctx.restore();
}

export function bountyMarkersForView(view: MapLayerDrawView, source?: unknown): BountyMapMarker[] {
  return bountyMapMarkers(source ?? bountyBlob(view), nestsInView(view));
}

/**
 * Registers the Bounties layer on the W04 registry.
 * W22 off, or a missing registry: returns a no-op and does not throw.
 */
export function registerBountyMapLayer(
  registry: BountyLayerRegistry | null | undefined,
  flags: ReadonlySet<string>,
): () => void {
  if (!flags.has('W22') || !registry || typeof registry.register !== 'function') return () => undefined;
  const meta = MAP_LAYER_META.bounties;
  return registry.register({
    id: meta.id,
    label: meta.label,
    wave: meta.wave,
    defaultOn: meta.defaultOn,
    order: meta.order,
    draw(ctx, view) {
      drawBountyMarkers(ctx, view, bountyMarkersForView(view));
    },
  });
}

/** Binds the layer once `services.maps` exists. A missing host registry does not throw. */
export function attachBountyMapLayer(ctx: FeatureContext): { sync(): void; dispose(): void } {
  let bound: BountyLayerRegistry | null = null;
  let unregister: (() => void) | null = null;
  let seen = false;
  const sync = (): void => {
    const next = ctx.flags.has('W22') ? (ctx.services.maps?.layerRegistry ?? null) : null;
    if (seen && next === bound) return;
    seen = true;
    unregister?.();
    unregister = null;
    bound = next;
    if (!next) return;
    unregister = registerBountyMapLayer(next, ctx.flags);
    ctx.services.maps?.controller.syncOverlayChips();
  };
  return {
    sync,
    dispose() {
      unregister?.();
      unregister = null;
      bound = null;
      seen = false;
    },
  };
}

function paintTag(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  marker: BountyMapMarker,
  used: Map<string, number>,
): void {
  const q = marker.q;
  const r = marker.r;
  if (q === null || r === null) return;
  const key = `${q},${r}`;
  const slot = used.get(key) ?? 0;
  used.set(key, slot + 1);
  const { x, y } = view.axialToPixel(q, r);
  const ty = y - 6 - slot * 12;
  ctx.strokeText(marker.reward, x, ty);
  ctx.fillText(marker.reward, x, ty);
}

function bountyBlob(view: MapLayerDrawView): unknown {
  return view.clientView?.blobs?.bounty;
}

function nestsInView(view: MapLayerDrawView): Map<string, Spot> {
  const nests = new Map<string, Spot>();
  const cv = view.clientView;
  if (cv?.entities) {
    forEachEntity(cv.entities, cv.count, (row) => {
      if (row.hp > 0) addSpot(nests, String(Math.round(row.id)), row.q, row.r);
    });
  }
  collectHives(cv?.blobs?.faunaHives, nests);
  return nests;
}

function collectHives(raw: unknown, nests: Map<string, Spot>): void {
  if (!raw || typeof raw !== 'object') return;
  const blob = raw as Record<string, unknown>;
  for (const key of ['hivesById', 'hives', 'byEntityId']) {
    const map = blob[key];
    if (!map || typeof map !== 'object') continue;
    for (const [id, hive] of Object.entries(map as Record<string, unknown>)) readHive(id, hive, nests);
  }
}

function readHive(id: string, hive: unknown, nests: Map<string, Spot>): void {
  if (!hive || typeof hive !== 'object') return;
  const row = hive as Record<string, unknown>;
  if (row.destroyed === true || (typeof row.hp === 'number' && row.hp <= 0)) return;
  if (typeof row.q !== 'number' || typeof row.r !== 'number') return;
  addSpot(nests, id, row.q, row.r);
  if (typeof row.hiveId === 'number') addSpot(nests, String(row.hiveId), row.q, row.r);
}

function addSpot(nests: Map<string, Spot>, id: string, q: number, r: number): void {
  if (!id || !Number.isFinite(q) || !Number.isFinite(r)) return;
  nests.set(id, { q, r });
}

function rowsOf(source: unknown): Record<string, unknown>[] {
  if (Array.isArray(source)) return source.filter(isRec);
  if (!isRec(source)) return [];
  if (Array.isArray(source.bounties)) return source.bounties.filter(isRec);
  const value = source.value;
  if (isRec(value) && Array.isArray(value.bounties)) return value.bounties.filter(isRec);
  return [];
}

function markerOf(row: Record<string, unknown>, nests: ReadonlyMap<string, Spot>): BountyMapMarker | null {
  const state = typeof row.state === 'string' ? row.state : 'open';
  if (!LIVE.has(state)) return null;
  const reward = rewardText(row.reward);
  if (!reward || !isRec(row.target)) return null;
  return clearNestMarker(row.target, reward, nests) ?? defendMarker(row.target, reward);
}

function clearNestMarker(
  target: Record<string, unknown>,
  reward: string,
  nests: ReadonlyMap<string, Spot>,
): BountyMapMarker | null {
  if (target.kind !== 'clear_nest') return null;
  const nestId = idText(target.nestId);
  if (!nestId) return null;
  const spot = nests.get(nestId);
  return { nestId, reward, q: spot?.q ?? null, r: spot?.r ?? null };
}

function defendMarker(target: Record<string, unknown>, reward: string): BountyMapMarker | null {
  if (target.kind !== 'defend_area' || !isTile(target.q) || !isTile(target.r)) return null;
  return { nestId: `${target.q},${target.r}`, reward, q: target.q, r: target.r };
}

function rewardText(reward: unknown): string | null {
  if (!isRec(reward) || typeof reward.amount !== 'number' || !Number.isFinite(reward.amount)) return null;
  return reward.amount > 0 ? String(reward.amount) : null;
}

function idText(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;
}

function isTile(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRec(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
