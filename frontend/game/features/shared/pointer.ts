/** Map pointer input shared by the features that act on the canvas (Hub placement, terraform brush, HQ selection). */

export interface TileCoord {
  q: number;
  r: number;
}

/** Screen point → tile under it (the session's terrain pick), or `null` off the planet. */
export type TilePickerFn = (clientX: number, clientY: number, target?: EventTarget | null) => TileCoord | null;

interface PointerLike {
  clientX?: number;
  clientY?: number;
  target?: EventTarget | null;
  detail?: unknown;
}

function tileFromDetail(detail: unknown): TileCoord | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as { q?: unknown; r?: unknown };
  return typeof d.q === 'number' && typeof d.r === 'number' ? { q: d.q, r: d.r } : null;
}

function tileFromDataAttrs(target: EventTarget | null | undefined): TileCoord | null {
  const el = target as Element | null | undefined;
  if (!el || typeof el.getAttribute !== 'function') return null;
  const qAttr = el.getAttribute('data-q');
  const rAttr = el.getAttribute('data-r');
  if (qAttr === null || rAttr === null) return null;
  const q = Number(qAttr);
  const r = Number(rAttr);
  return Number.isFinite(q) && Number.isFinite(r) ? { q, r } : null;
}

/**
 * The tile a pointer event points at: an explicit `detail: { q, r }` (synthetic events), else the terrain picker,
 * else the `data-q` / `data-r` attributes of the event target (DOM tiles).
 */
export function resolvePointerTile(ev: PointerLike, pickTile?: TilePickerFn): TileCoord | null {
  const fromDetail = tileFromDetail(ev.detail);
  if (fromDetail) return fromDetail;
  if (pickTile) {
    const picked = pickTile(ev.clientX ?? 0, ev.clientY ?? 0, ev.target ?? null);
    if (picked) return { q: picked.q, r: picked.r };
  }
  return tileFromDataAttrs(ev.target);
}

/** Handlers of one exclusive map mode (placement, armed brush). */
export interface ExclusivePointerHandlers {
  down?(e: MouseEvent): void;
  move?(e: MouseEvent): void;
  up?(e: MouseEvent): void;
  context?(e: MouseEvent): void;
}

/** Buttons a mode can own: primary (0) and secondary (2). The middle button stays with the camera. */
const OWNED_BUTTONS: ReadonlySet<number> = new Set([0, 2]);

/**
 * Input arbiter for one map mode. The handlers listen on `surface` in the capture phase, so they run before the
 * ordinary (bubble) listeners on the same element (HQ selection and orders). While `isActive()` is true, or while a
 * press that began in this mode is still down, its left / right clicks and the context menu go to this mode only
 * (`stopImmediatePropagation`): one click has one owner (FF-06, FF-10). A right press that cancels the mode still ends
 * in it, whatever order the browser fires `contextmenu` and `pointerup` in. Pointer moves are shared (not consumed).
 */
export function bindExclusivePointer(
  surface: EventTarget,
  isActive: () => boolean,
  handlers: ExclusivePointerHandlers,
): () => void {
  const owned = new Set<number>();
  let ownsContextMenu = false;

  const onDown = (ev: Event) => {
    const e = ev as MouseEvent;
    if (!OWNED_BUTTONS.has(e.button)) return;
    if (e.button === 2) ownsContextMenu = false;
    if (!isActive()) return;
    owned.add(e.button);
    if (e.button === 2) ownsContextMenu = true;
    // The release must come back here even when it happens off the surface (else the press would stay owned)
    const pointerId = (e as PointerEvent).pointerId;
    if (typeof pointerId === 'number') (surface as Partial<Element>).setPointerCapture?.(pointerId);
    e.stopImmediatePropagation();
    handlers.down?.(e);
  };
  const onMove = (ev: Event) => {
    if (isActive() || owned.size > 0) handlers.move?.(ev as MouseEvent);
  };
  const onUp = (ev: Event) => {
    const e = ev as MouseEvent;
    if (!OWNED_BUTTONS.has(e.button)) return;
    if (!owned.delete(e.button) && !isActive()) return;
    e.stopImmediatePropagation();
    handlers.up?.(e);
  };
  /** A press that ends without a pointerup on the surface (cancelled, capture lost) is no longer owned. */
  const onLost = () => owned.clear();
  const onContext = (ev: Event) => {
    const e = ev as MouseEvent;
    if (!ownsContextMenu && !isActive()) return;
    ownsContextMenu = false;
    e.preventDefault();
    e.stopImmediatePropagation();
    handlers.context?.(e);
  };

  const opts = { capture: true };
  surface.addEventListener('pointerdown', onDown, opts);
  surface.addEventListener('pointermove', onMove, opts);
  surface.addEventListener('pointerup', onUp, opts);
  surface.addEventListener('contextmenu', onContext, opts);
  surface.addEventListener('pointercancel', onLost, opts);
  surface.addEventListener('lostpointercapture', onLost, opts);
  return () => {
    surface.removeEventListener('pointercancel', onLost, opts);
    surface.removeEventListener('lostpointercapture', onLost, opts);
    surface.removeEventListener('pointerdown', onDown, opts);
    surface.removeEventListener('pointermove', onMove, opts);
    surface.removeEventListener('pointerup', onUp, opts);
    surface.removeEventListener('contextmenu', onContext, opts);
  };
}
