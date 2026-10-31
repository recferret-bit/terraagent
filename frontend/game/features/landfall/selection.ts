import { ENTITY_KIND, ENTITY_STATE, hexDistance, type HqJob, type ViewColony, type ViewEntity } from '@terra/sim';
import type { GameView } from '../../core/registry/types';
import type { SendCommand } from '../../net/commandBus';
import { ENTITY_STRIDE, type ClientView } from '../../store/replica/viewCodec';

export interface HqStatusView {
  entityId: number;
  owner: number;
  tier: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  cell: number;
  cellMax: number;
  targetQ: number;
  targetR: number;
  currentJob: HqJob;
  queueCount: number;
}

export interface StoreLike {
  readonly latest?: ClientView | GameView | null;
  readonly latestTiles?: ClientView['tiles'] | null;
  onView?(fn: (v: ClientView) => void): () => void;
  onCommandRejected?(fn: (r: { id: string; kind: string; code: string }) => void): () => void;
  sendCommand?(cmdOrKind: unknown, args?: unknown): unknown;
}

export type TilePicker = (clientX: number, clientY: number, target?: EventTarget | null) => { q: number; r: number } | null;

export interface LandfallControllerOptions {
  store?: StoreLike;
  sendCommand?: SendCommand;
  pickTile?: TilePicker;
  canvas?: HTMLElement | null;
  ownerColonyIndex?: number;
  autoSelect?: boolean;
  onTargetMove?: (q: number, r: number) => void;
}

export type LandfallListener = (snapshot: { hq: HqStatusView | null; selectedEntityId: number | null }) => void;

export function hqJobFromStateCode(stateCode: number): HqJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === 3 || stateCode === ENTITY_STATE.constructing) return 'constructing';
  return 'idle';
}

interface RawHqCandidate {
  id: number;
  owner: number;
  tier?: number;
  q: number;
  r: number;
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  state: number;
  cell?: number;
  cellMax?: number;
  targetQ?: number;
  targetR?: number;
}

function findHqInEntities(view: { entities?: Float32Array | ViewEntity[]; count?: number }, owner?: number): RawHqCandidate | null {
  const ents = view.entities;
  if (!ents) return null;
  if (ents instanceof Float32Array) {
    const count = view.count ?? Math.floor(ents.length / ENTITY_STRIDE);
    for (let i = 0; i < count; i++) {
      const o = i * ENTITY_STRIDE;
      if (ents[o + 1] !== ENTITY_KIND.hq) continue;
      if (owner !== undefined && ents[o + 2] !== owner) continue;
      return {
        id: ents[o],
        owner: ents[o + 2],
        q: ents[o + 3],
        r: ents[o + 4],
        x: ents[o + 5],
        y: ents[o + 6],
        hp: ents[o + 8],
        hpMax: ents[o + 9],
        state: ents[o + 10],
      };
    }
    return null;
  }
  if (Array.isArray(ents)) {
    for (const e of ents) {
      if (e.kind !== ENTITY_KIND.hq) continue;
      if (owner !== undefined && e.owner !== owner) continue;
      return {
        id: e.id,
        owner: e.owner,
        tier: e.tier,
        q: e.q,
        r: e.r,
        x: e.x,
        y: e.y,
        hp: e.hp,
        hpMax: e.hpMax,
        state: e.state,
        cell: e.cell,
        cellMax: e.cellMax,
        targetQ: e.targetQ,
        targetR: e.targetR,
      };
    }
  }
  return null;
}

/** Extracts the HQ status view from a `ClientView` or `SimView`. */
export function extractHqFromView(rawView: unknown, ownerColonyIndex?: number): HqStatusView | null {
  if (!rawView || typeof rawView !== 'object') return null;
  const view = rawView as {
    entities?: Float32Array | ViewEntity[];
    count?: number;
    colonies?: ViewColony[];
    blobs?: Record<string, unknown>;
  };

  const entityHq = findHqInEntities(view, ownerColonyIndex);
  const owner = entityHq?.owner ?? ownerColonyIndex ?? 0;
  const col = view.colonies?.find((c) => c.index === owner) ?? view.colonies?.[owner];
  const colHq = col?.hq as Partial<HqStatusView> | undefined;
  const rawBlob = view.blobs?.hq as (Partial<HqStatusView> & { byColony?: Record<number, Partial<HqStatusView>> }) | undefined;
  const blobHq = rawBlob?.byColony?.[owner] ?? (rawBlob?.entityId !== undefined ? rawBlob : undefined);
  const meta = colHq ?? blobHq;

  if (!entityHq && !meta) return null;

  const stateJob = entityHq ? hqJobFromStateCode(entityHq.state) : undefined;
  const currentJob: HqJob =
    stateJob ??
    (colHq?.currentJob as HqJob | undefined) ??
    (col?.currentJob as HqJob | undefined) ??
    (blobHq?.currentJob as HqJob | undefined) ??
    'idle';

  const queueCount =
    typeof colHq?.queueCount === 'number'
      ? colHq.queueCount
      : typeof col?.queueCount === 'number'
        ? col.queueCount
        : typeof blobHq?.queueCount === 'number'
          ? blobHq.queueCount
          : currentJob === 'idle'
            ? 0
            : 1;

  const q = entityHq?.q ?? meta?.q ?? 0;
  const r = entityHq?.r ?? meta?.r ?? 0;
  const hpMax = entityHq?.hpMax ?? meta?.hpMax ?? 900;
  const hp = entityHq?.hp ?? meta?.hp ?? hpMax;
  const cellMax = entityHq?.cellMax ?? meta?.cellMax ?? 800;
  const cell = entityHq?.cell ?? meta?.cell ?? cellMax;

  return {
    entityId: entityHq?.id ?? meta?.entityId ?? 1,
    owner,
    tier: entityHq?.tier ?? meta?.tier ?? 1,
    q,
    r,
    x: entityHq?.x ?? meta?.x ?? q,
    y: entityHq?.y ?? meta?.y ?? r,
    hp,
    hpMax,
    cell,
    cellMax,
    targetQ: entityHq?.targetQ ?? meta?.targetQ ?? q,
    targetR: entityHq?.targetR ?? meta?.targetR ?? r,
    currentJob,
    queueCount,
  };
}

export function isTileNearHq(hq: HqStatusView, q: number, r: number, maxDist = 1): boolean {
  return (
    hexDistance(q, r, hq.q, hq.r) <= maxDist ||
    hexDistance(q, r, Math.round(hq.x), Math.round(hq.y)) <= maxDist
  );
}

/**
 * Manages HQ selection state and right-click / programmatic `moveUnit` orders.
 */
export class LandfallController {
  private selectedEntityId: number | null = null;
  private autoSelect: boolean;
  private ownerColonyIndex?: number;
  private latestHq: HqStatusView | null = null;
  private readonly listeners = new Set<LandfallListener>();
  private readonly cleanups: Array<() => void> = [];
  private pickTile?: TilePicker;

  constructor(private readonly opts: LandfallControllerOptions = {}) {
    this.autoSelect = opts.autoSelect !== false;
    this.ownerColonyIndex = opts.ownerColonyIndex;
    this.pickTile = opts.pickTile;
    if (opts.store?.latest) {
      this.onView(opts.store.latest);
    }
    if (opts.store?.onView) {
      this.cleanups.push(opts.store.onView((v) => this.onView(v)));
    }
    if (opts.canvas) {
      this.cleanups.push(this.bindCanvas(opts.canvas, opts.pickTile));
    }
  }

  onChange(fn: LandfallListener): () => void {
    this.listeners.add(fn);
    fn({ hq: this.latestHq, selectedEntityId: this.selectedEntityId });
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = { hq: this.latestHq, selectedEntityId: this.selectedEntityId };
    for (const fn of this.listeners) fn(snap);
  }

  getOwnerColonyIndex(): number | undefined {
    return this.ownerColonyIndex;
  }

  setOwnerColonyIndex(colonyIndex: number | undefined): void {
    this.ownerColonyIndex = colonyIndex;
    if (this.opts.store?.latest) {
      this.onView(this.opts.store.latest);
    }
  }

  onView(view: unknown): void {
    const hq = extractHqFromView(view, this.ownerColonyIndex);
    if (!hq && view && typeof view === 'object' && !('entities' in view) && !('colonies' in view)) {
      return;
    }
    this.latestHq = hq;
    if (hq && this.selectedEntityId === null && this.autoSelect) {
      this.selectedEntityId = hq.entityId;
    } else if (hq && this.selectedEntityId !== null && this.selectedEntityId !== hq.entityId && this.autoSelect) {
      this.selectedEntityId = hq.entityId;
    } else if (!hq && this.selectedEntityId !== null) {
      this.selectedEntityId = null;
    }
    this.emit();
  }

  selectHq(): number | null {
    this.autoSelect = true;
    if (this.latestHq) {
      this.selectedEntityId = this.latestHq.entityId;
    }
    this.emit();
    return this.selectedEntityId;
  }

  toggleSelectHq(): number | null {
    if (this.selectedEntityId !== null) {
      this.deselect();
      return null;
    }
    return this.selectHq();
  }

  deselect(): void {
    this.autoSelect = false;
    this.selectedEntityId = null;
    this.emit();
  }

  isSelected(): boolean {
    return this.selectedEntityId !== null && this.latestHq !== null && this.selectedEntityId === this.latestHq.entityId;
  }

  getSelectedEntityId(): number | null {
    return this.selectedEntityId;
  }

  getHq(): HqStatusView | null {
    return this.latestHq;
  }

  orderMove(q: number, r: number): boolean {
    if (!Number.isInteger(q) || !Number.isInteger(r)) return false;
    const hq = this.latestHq;
    if (!hq || this.selectedEntityId !== hq.entityId) return false;
    const payload = { type: 'moveUnit' as const, entityId: hq.entityId, q, r };
    if (this.opts.store?.sendCommand) {
      this.opts.store.sendCommand(payload);
    } else if (this.opts.sendCommand) {
      void this.opts.sendCommand('moveUnit', { entityId: hq.entityId, q, r });
    }
    this.opts.onTargetMove?.(q, r);
    return true;
  }

  handleLeftClick(q: number, r: number, shiftKey = false): boolean {
    if (shiftKey && this.isSelected()) {
      return this.orderMove(q, r);
    }
    if (this.latestHq && isTileNearHq(this.latestHq, q, r)) {
      this.selectHq();
      return true;
    }
    return false;
  }

  handleRightClick(q: number, r: number): boolean {
    return this.orderMove(q, r);
  }

  bindCanvas(canvas: HTMLElement, pickTile: TilePicker | undefined = this.pickTile): () => void {
    if (pickTile) this.pickTile = pickTile;
    let down = { x: 0, y: 0, button: -1 };
    let lastRightOrderAt = -1000;

    const resolveTile = (e: { clientX?: number; clientY?: number; detail?: unknown }): { q: number; r: number } | null => {
      const det = e.detail as { q?: number; r?: number } | undefined;
      if (det && typeof det.q === 'number' && typeof det.r === 'number') {
        return { q: det.q, r: det.r };
      }
      return this.pickTile ? this.pickTile(e.clientX ?? 0, e.clientY ?? 0) : null;
    };

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX ?? 0, y: e.clientY ?? 0, button: e.button ?? 0 };
    };

    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot((e.clientX ?? 0) - down.x, (e.clientY ?? 0) - down.y);
      if (moved > 5) return;
      const pick = resolveTile(e);
      if (!pick) return;
      if (e.button === 0) {
        this.handleLeftClick(pick.q, pick.r, Boolean(e.shiftKey));
      } else if (e.button === 2) {
        lastRightOrderAt = Date.now();
        this.handleRightClick(pick.q, pick.r);
      }
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault?.();
      if (Date.now() - lastRightOrderAt < 50) return;
      const pick = resolveTile(e);
      if (pick) this.handleRightClick(pick.q, pick.r);
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

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.listeners.clear();
  }
}
