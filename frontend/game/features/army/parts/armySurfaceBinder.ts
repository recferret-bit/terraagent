import { ENTITY_KIND } from '@terra/sim';
import type { EntityRow } from '../../../store/replica/viewCodec';
import type { LandfallController } from '../../landfall/selection';
import { isArmyCombatUnitKind } from '../../landfall/selectionHelpers';
import { resolvePointerTile, type TilePickerFn } from '../../shared/pointer';
import { isStationaryArmedKind, resolveSelectedArmedIssuers } from './armyEntityQueries';

export interface ArmySurfaceBinderHost {
  now(): number;
  isBlocked(): boolean;
  getPickTile(): TilePickerFn | undefined;
  getSelectedEntityIds(): readonly number[];
  isAttackMoveArmed(): boolean;
  getLandfall(): LandfallController | undefined;
  findOwnCombatUnitsAt(q: number, r: number, pickedEntityId?: number): EntityRow[];
  findNonOwnTargetAt(q: number, r: number, pickedEntityId?: number): EntityRow | null;
  clickTile(q: number, r: number, shiftKey: boolean, pickedEntityId?: number): boolean;
  rightClickTile(q: number, r: number, pickedEntityId?: number): boolean;
  clearSquadSelection(): void;
}

export function bindArmySurfaceEvents(surface: HTMLElement, host: ArmySurfaceBinderHost): () => void {
  let down = { x: 0, y: 0, button: -1 };
  let suppressClick: { at: number; q: number; r: number } | null = null;
  let suppressContext: { at: number; q: number; r: number } | null = null;
  let lastDragAt = -Infinity;

  const onDown = (ev: Event) => {
    const e = ev as PointerEvent;
    down = { x: e.clientX ?? 0, y: e.clientY ?? 0, button: e.button ?? 0 };
  };

  const handleLeft = (e: MouseEvent, fromPointerUp: boolean) => {
    if (host.isBlocked()) return;
    if (!fromPointerUp && host.now() - lastDragAt < 120) return;
    const pick = resolvePointerTile(e, host.getPickTile());
    if (!pick) return;
    if (!fromPointerUp && suppressClick && host.now() - suppressClick.at < 150 && suppressClick.q === pick.q && suppressClick.r === pick.r) {
      suppressClick = null;
      return;
    }
    if (fromPointerUp) suppressClick = { at: host.now(), q: pick.q, r: pick.r };
    const shift = Boolean(e.shiftKey);
    const selectedIds = host.getSelectedEntityIds();
    const landfall = host.getLandfall();
    const hits = host.findOwnCombatUnitsAt(pick.q, pick.r, pick.entityId);
    const ownArmyHit = hits.some((u) => isArmyCombatUnitKind(u.kind));
    const issuers = !shift ? resolveSelectedArmedIssuers(selectedIds, landfall?.getSelectedEntity()) : [];
    const hostile = issuers.length > 0 ? host.findNonOwnTargetAt(pick.q, pick.r, pick.entityId) : null;
    const ownDirectPick = typeof pick.entityId === 'number' && hits.some((h) => h.id === pick.entityId);
    const shouldAttackHostile = Boolean(hostile && !ownDirectPick && (hostile.id === pick.entityId || hits.length === 0));
    if ((host.isAttackMoveArmed() && selectedIds.length > 0) || ownArmyHit || shouldAttackHostile) {
      e.stopImmediatePropagation?.();
      host.clickTile(pick.q, pick.r, shift, pick.entityId);
    } else if (shift && selectedIds.length > 0 && !landfall?.pickEntityAt(pick.q, pick.r, pick.entityId)?.isUnit) {
      e.stopImmediatePropagation?.();
    } else if (!shift && selectedIds.length > 0) {
      host.clearSquadSelection();
    }
  };

  const handleRight = (e: MouseEvent, fromPointerUp: boolean) => {
    if (host.isBlocked()) return;
    const pick = resolvePointerTile(e, host.getPickTile());
    if (!pick) return;
    const selectedIds = host.getSelectedEntityIds();
    const landfallSel = host.getLandfall()?.getSelectedEntity();
    const canHandleHqOrTurretAttack =
      selectedIds.length === 0 &&
      landfallSel &&
      (landfallSel.kind === ENTITY_KIND.hq || isStationaryArmedKind(landfallSel.kind)) &&
      host.findNonOwnTargetAt(pick.q, pick.r, pick.entityId) !== null;
    if (selectedIds.length === 0 && !(landfallSel && isArmyCombatUnitKind(landfallSel.kind)) && !canHandleHqOrTurretAttack) return;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    if (!fromPointerUp && suppressContext && host.now() - suppressContext.at < 400 && suppressContext.q === pick.q && suppressContext.r === pick.r) {
      suppressContext = null;
      return;
    }
    if (fromPointerUp) suppressContext = { at: host.now(), q: pick.q, r: pick.r };
    host.rightClickTile(pick.q, pick.r, pick.entityId);
  };

  const onUp = (ev: Event) => {
    const e = ev as PointerEvent;
    if (Math.hypot((e.clientX ?? 0) - down.x, (e.clientY ?? 0) - down.y) > 5) {
      lastDragAt = host.now();
      return;
    }
    if (e.button === 0) handleLeft(e, true);
    else if (e.button === 2) handleRight(e, true);
  };
  const onClick = (ev: Event) => handleLeft(ev as MouseEvent, false);
  const onContext = (ev: Event) => handleRight(ev as MouseEvent, false);

  const opts = { capture: true };
  surface.addEventListener('pointerdown', onDown, opts);
  surface.addEventListener('pointerup', onUp, opts);
  surface.addEventListener('click', onClick, opts);
  surface.addEventListener('contextmenu', onContext, opts);
  return () => {
    surface.removeEventListener('pointerdown', onDown, opts);
    surface.removeEventListener('pointerup', onUp, opts);
    surface.removeEventListener('click', onClick, opts);
    surface.removeEventListener('contextmenu', onContext, opts);
  };
}
