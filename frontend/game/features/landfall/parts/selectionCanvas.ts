import { entityFootprint, getBuildingFootprintTiles, occupiesGround, type CompiledDataLike, type ViewEntity } from '@terra/sim';
import { forEachEntity } from '../../../store/replica/viewCodec';
import { resolvePointerTile, type TilePickerFn } from '../../shared/pointer';
import { isBuildingCoveringTile } from '../selectionHelpers';
import type { SelectedEntityView } from '../selection';

export function checkTileBlockedByBuilding(
  entities: Iterable<SelectedEntityView>,
  rawView: unknown,
  simData: CompiledDataLike | undefined,
  q: number,
  r: number,
): boolean {
  for (const e of entities) {
    if (!e.isUnit && isBuildingCoveringTile(e, q, r)) return true;
  }
  const latest = rawView as { entities?: Float32Array | ViewEntity[]; count?: number } | null | undefined;
  if (!latest?.entities || (!(latest.entities instanceof Float32Array) && !Array.isArray(latest.entities))) return false;
  let hit = false;
  forEachEntity(latest.entities, latest.count, (e) => {
    if (hit || !occupiesGround(e)) return;
    hit = getBuildingFootprintTiles(e.q, e.r, entityFootprint(e.kind, simData)).some((p) => p.q === q && p.r === r);
  });
  return hit;
}

export function pickSelectableEntityOnTile(
  entities: Iterable<SelectedEntityView>,
  selectedEntityId: number | null,
  q: number,
  r: number,
  pickedEntityId?: number,
): SelectedEntityView | null {
  const list = Array.isArray(entities) ? (entities as readonly SelectedEntityView[]) : [...entities];
  if (typeof pickedEntityId === 'number') {
    const directUnit = list.find((e) => e.isUnit && e.entityId === pickedEntityId);
    if (directUnit) return directUnit;
  }

  let bestUnit: SelectedEntityView | null = null;
  let bestDist = Infinity;
  for (const e of list) {
    if (!e.isUnit) continue;
    const rx = Math.round(e.x);
    const ry = Math.round(e.y);
    const euclid = Math.hypot(e.x - q, e.y - r);
    const onRounded = (rx === q && ry === r) || (e.q === q && e.r === r);
    if (!onRounded && euclid > 0.75) continue;
    const d = onRounded ? Math.min(euclid, 0.25) : euclid;
    const preferOverCurrent = Math.abs(d - bestDist) < 1e-4 && bestUnit?.entityId === selectedEntityId && e.entityId !== selectedEntityId;
    if (d < bestDist || preferOverCurrent) {
      bestDist = d;
      bestUnit = e;
    }
  }
  if (bestUnit) return bestUnit;

  if (typeof pickedEntityId === 'number') {
    const directBuilding = list.find((e) => !e.isUnit && e.entityId === pickedEntityId);
    if (directBuilding) return directBuilding;
  }
  for (const e of list) {
    if (e.isUnit) continue;
    if (isBuildingCoveringTile(e, q, r)) return e;
  }
  return null;
}

export function resolveShiftUnitToggle(
  currentIds: readonly number[],
  entitiesById: ReadonlyMap<number, SelectedEntityView>,
  hitUnitId: number,
): number[] {
  const unitIds = currentIds.filter((id) => entitiesById.get(id)?.isUnit);
  return unitIds.includes(hitUnitId)
    ? unitIds.filter((id) => id !== hitUnitId)
    : [...unitIds, hitUnitId];
}

export function bindLandfallCanvasEvents(
  canvas: HTMLElement,
  getPickTile: () => TilePickerFn | undefined,
  dedupeMs: number,
  onLeftClick: (q: number, r: number, shiftKey: boolean, pickedEntityId?: number) => void,
  onRightClick: (q: number, r: number) => void,
): () => void {
  let down = { x: 0, y: 0, button: -1 };
  let lastRight = { at: -1000, q: NaN, r: NaN };
  const orderRight = (q: number, r: number) => {
    const now = Date.now();
    if (now - lastRight.at < dedupeMs && lastRight.q === q && lastRight.r === r) return;
    lastRight = { at: now, q, r };
    onRightClick(q, r);
  };
  const resolveTile = (e: MouseEvent) => resolvePointerTile(e, getPickTile());
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX ?? 0, y: e.clientY ?? 0, button: e.button ?? 0 };
  };
  const onUp = (e: PointerEvent) => {
    if (Math.hypot((e.clientX ?? 0) - down.x, (e.clientY ?? 0) - down.y) > 5) return;
    const pick = resolveTile(e);
    if (!pick) return;
    if (e.button === 0) onLeftClick(pick.q, pick.r, Boolean(e.shiftKey), pick.entityId);
    else if (e.button === 2) orderRight(pick.q, pick.r);
  };
  const onContext = (e: MouseEvent) => {
    e.preventDefault?.();
    const pick = resolveTile(e);
    if (pick) orderRight(pick.q, pick.r);
  };
  canvas.addEventListener('pointerdown', onDown as EventListener);
  canvas.addEventListener('pointerup', onUp as EventListener);
  canvas.addEventListener('contextmenu', onContext as EventListener);
  return () => {
    canvas.removeEventListener('pointerdown', onDown as EventListener);
    canvas.removeEventListener('pointerup', onUp as EventListener);
    canvas.removeEventListener('contextmenu', onContext as EventListener);
  };
}
