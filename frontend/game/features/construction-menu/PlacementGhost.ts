import type { FlagSet } from '@terra/contracts';
import { DEPOSIT, ENTITY_KIND, GEO_BLOCK_TEXT, PREP, TERRAIN, geoBuildBlock, hexDistance, hexIndex, type GeoBlock, type ViewEntity } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { forEachEntity, type ClientTiles } from '../../store/replica/viewCodec';
import { isHotkeyPress } from '../shared/hotkeys';
import { bindExclusivePointer, resolvePointerTile } from '../shared/pointer';
import { evaluateSiteWithSim, ownColonyIndex } from './sitePlacement';

export interface PlacementGhostTile {
  q: number; r: number; tileIdx: number; deposit: number; terrain: number; prep: number; prepOp?: string;
}

export interface PlacementGhostState {
  building: string; label: string; q: number; r: number; rotation: number;
  footprintW: number; footprintD: number; footprintText: string;
  tiles: PlacementGhostTile[]; prepBill: Record<string, number>; prepBillText: string;
  valid: boolean; statusColor: 'green' | 'red'; reason: string;
  requiresDeposit?: string; depositCovered: boolean; depositTileIndices: number[];
}

export interface EvaluatePlacementGhostOptions {
  building: string; q: number; r: number; rotation: number; flags: ReadonlySet<string> | FlagSet; view?: GameView; colonyId?: number;
}

function toFlagSet(flags: ReadonlySet<string> | FlagSet): FlagSet {
  if ('spec' in flags && 'list' in flags && typeof flags.has === 'function') return flags as FlagSet;
  const set = flags as ReadonlySet<string>;
  const list = Array.from(set);
  return { has: (w: string) => set.has(w), list, spec: list.join(',') };
}

interface BuildingRowMeta {
  label: string;
  footprintW: number;
  footprintD: number;
  requiresDeposit?: string;
}

const DEFAULT_LABELS: Record<string, string> = {
  commandHub: 'Command Hub',
  metalsExtractor: 'Metals Extractor',
  solar: 'Solar Collector Array',
};

function resolveBuildingMeta(flags: ReadonlySet<string> | FlagSet, building: string): BuildingRowMeta {
  const data = clientDataFor(toFlagSet(flags));
  let row: Record<string, unknown> | undefined;
  for (const table of Object.values(data.tables)) {
    if (!table) continue;
    for (const r of Object.values(table)) {
      if (r && (r.building === building || r.id === building)) { row = r as Record<string, unknown>; break; }
    }
    if (row) break;
  }
  const label = typeof row?.label === 'string' ? row.label : (DEFAULT_LABELS[building] ?? building);
  const defFp = building === 'commandHub' ? 3 : 2;
  const footprintW = typeof row?.footprintW === 'number' ? row.footprintW : defFp;
  const footprintD = typeof row?.footprintD === 'number' ? row.footprintD : defFp;
  const requiresDeposit = typeof row?.requiresDeposit === 'string' ? row.requiresDeposit : (building === 'metalsExtractor' ? 'metals' : undefined);
  return { label, footprintW, footprintD, requiresDeposit };
}

function getPlanetRadius(view?: GameView): number {
  if (!view) return 56;
  const v = view as { planet?: { radius?: number }; tiles?: { count?: number } };
  if (typeof v.planet?.radius === 'number' && v.planet.radius > 0) return v.planet.radius;
  if (typeof v.tiles?.count === 'number' && v.tiles.count > 0) {
    return Math.round((-3 + Math.sqrt(Math.max(0, 12 * v.tiles.count - 3))) / 6);
  }
  return 56;
}

function getTilePrepOp(terrain: number, prep: number): string | undefined {
  if (prep === PREP.prepared || prep === PREP.living) return undefined;
  return 'prepare';
}

const PREP_LABELS: Record<string, string> = {
  prepare: 'Prepare',
  'clear + prepare': 'Clear + Prepare',
  'break + prepare': 'Break + Prepare',
  'flatten + prepare': 'Flatten + Prepare',
};

function formatPrepBillText(bill: Record<string, number>): string {
  const entries = Object.entries(bill);
  if (entries.length === 0) return 'Site prepared';
  const order: Record<string, number> = { 'clear + prepare': 1, 'break + prepare': 2, 'flatten + prepare': 3, prepare: 4 };
  entries.sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  return `Prep: ${entries.map(([op, count]) => `${count}× ${PREP_LABELS[op] ?? (op.charAt(0).toUpperCase() + op.slice(1))}`).join(', ')}`;
}

function markFootprintIndices(occupied: Set<number>, hIndex: { indexOf(q: number, r: number): number }, q: number, r: number, w: number, d: number, rot = 0): void {
  const swap = (((Math.round(rot) % 6) + 6) % 2) !== 0;
  const fw = swap ? d : w, fd = swap ? w : d;
  const minQ = -Math.floor((fw - 1) / 2);
  const minR = -Math.floor((fd - 1) / 2);
  for (let dr = 0; dr < fd; dr++) {
    for (let dq = 0; dq < fw; dq++) {
      const idx = hIndex.indexOf(q + minQ + dq, r + minR + dr);
      if (idx >= 0) occupied.add(idx);
    }
  }
}

interface QueuedBuildLike {
  state?: string;
  task?: { kind?: string; building?: string; q?: number; r?: number; rotation?: number };
}

function collectOccupiedTileIndices(view: GameView | undefined, hIndex: { indexOf(q: number, r: number): number }): Set<number> {
  const occupied = new Set<number>();
  if (!view) return occupied;
  const v = view as {
    entities?: Float32Array | readonly ViewEntity[];
    count?: number;
    colonies?: Array<{ queue?: QueuedBuildLike[]; constructionQueue?: QueuedBuildLike[] }>;
    blobs?: { queue?: { entries?: QueuedBuildLike[]; value?: { entries?: QueuedBuildLike[] } } };
  };
  // Occupancy comes from the buildings themselves; the `anchors` tile layer is the territory claim count, not "occupied".
  if (v.entities) {
    forEachEntity(v.entities, v.count, (e) => {
      if (e.hpMax > 0 && e.hp <= 0) return;
      const size = e.kind === ENTITY_KIND.commandHub
        ? 3
        : (e.kind === ENTITY_KIND.metalsExtractor || e.kind === ENTITY_KIND.solar ? 2 : (e.kind === ENTITY_KIND.pod ? 1 : 0));
      if (size > 0) markFootprintIndices(occupied, hIndex, e.q, e.r, size, size, e.rot);
    });
  }
  const fromColonies = (v.colonies ?? []).flatMap((c) => c?.constructionQueue ?? c?.queue ?? []); // every seat's pending site, not colony 0's
  const qList = fromColonies.length > 0 ? fromColonies : v.blobs?.queue?.entries ?? v.blobs?.queue?.value?.entries ?? [];
  for (const entry of qList) {
    if (!entry || entry.state === 'done' || entry.state === 'cancelled') continue;
    const t = entry.task;
    if (t?.kind === 'build' && typeof t.q === 'number' && typeof t.r === 'number') {
      const sz = t.building === 'commandHub' ? 3 : 2;
      markFootprintIndices(occupied, hIndex, t.q, t.r, sz, sz, t.rotation ?? 0);
    }
  }
  return occupied;
}

interface FootprintScanResult {
  tiles: PlacementGhostTile[];
  prepBill: Record<string, number>;
  coveredDepositIndices: number[];
  hasOutOfBounds: boolean;
  hasImpassable: boolean;
  hasOccupied: boolean;
  terrainBlock: GeoBlock | null;
}

function scanFootprintTiles(
  q: number,
  r: number,
  w: number,
  d: number,
  hIndex: { indexOf(q: number, r: number): number },
  occupied: ReadonlySet<number>,
  tilesData?: ClientTiles,
  requiresDeposit?: string,
): FootprintScanResult {
  const tiles: PlacementGhostTile[] = [];
  const prepBill: Record<string, number> = {};
  const coveredDepositIndices: number[] = [];
  let hasOutOfBounds = false, hasImpassable = false, hasOccupied = false, terrainBlock: GeoBlock | null = null;

  const minQ = -Math.floor((w - 1) / 2), minR = -Math.floor((d - 1) / 2);
  for (let dr = 0; dr < d; dr++) {
    for (let dq = 0; dq < w; dq++) {
      const tq = q + minQ + dq, tr = r + minR + dr;
      const tileIdx = hIndex.indexOf(tq, tr);
      if (tileIdx < 0) { hasOutOfBounds = true; tiles.push({ q: tq, r: tr, tileIdx: -1, deposit: 0, terrain: 0, prep: 0 }); continue; }
      if (occupied.has(tileIdx)) hasOccupied = true;
      const terrain = tilesData?.terrain ? (tilesData.terrain[tileIdx] ?? TERRAIN.flat) : TERRAIN.flat;
      const prep = tilesData?.prep ? (tilesData.prep[tileIdx] ?? PREP.wild) : PREP.wild;
      const deposit = tilesData?.deposit ? (tilesData.deposit[tileIdx] ?? DEPOSIT.none) : DEPOSIT.none;
      if (tilesData) {
        // One rule with the host (D-37): trees, rock, slope, hole, water, ridge: terraform first.
        terrainBlock ??= geoBuildBlock(terrain, prep, DEPOSIT.none, 'any');
        if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) hasImpassable = true;
        if (requiresDeposit === 'metals' && deposit === DEPOSIT.metals) coveredDepositIndices.push(tileIdx);
      }
      const prepOp = tilesData ? getTilePrepOp(terrain, prep) : undefined;
      if (prepOp) prepBill[prepOp] = (prepBill[prepOp] ?? 0) + 1;
      tiles.push({ q: tq, r: tr, tileIdx, deposit, terrain, prep, prepOp });
    }
  }
  return { tiles, prepBill, coveredDepositIndices, hasOutOfBounds, hasImpassable, hasOccupied, terrainBlock };
}

interface ValidityResult {
  valid: boolean;
  statusColor: 'green' | 'red';
  reason: string;
  depositCovered: boolean;
}

function evaluateValidity(
  hasTiles: boolean,
  hasOutOfBounds: boolean,
  hasImpassable: boolean,
  hasOccupied: boolean,
  terrainBlock: GeoBlock | null,
  requiresDeposit: string | undefined,
  depositCount: number,
): ValidityResult {
  if (!hasTiles && !hasOccupied) return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: false };
  if (hasOutOfBounds) return { valid: false, statusColor: 'red', reason: 'out of bounds', depositCovered: false };
  if (hasImpassable) return { valid: false, statusColor: 'red', reason: 'impassable terrain', depositCovered: false };
  if (hasOccupied) return { valid: false, statusColor: 'red', reason: 'tile occupied', depositCovered: false };
  if (terrainBlock) return { valid: false, statusColor: 'red', reason: GEO_BLOCK_TEXT[terrainBlock], depositCovered: false };
  if (requiresDeposit === 'metals') {
    if (depositCount === 0) return { valid: false, statusColor: 'red', reason: 'must cover a metals deposit', depositCovered: false };
    return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: true };
  }
  return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: false };
}

export function evaluatePlacementGhost(opts: EvaluatePlacementGhostOptions): PlacementGhostState {
  const meta = resolveBuildingMeta(opts.flags, opts.building);
  const rot = ((opts.rotation % 6) + 6) % 6;
  const isSwapped = rot % 2 !== 0;
  const footprintW = isSwapped ? meta.footprintD : meta.footprintW;
  const footprintD = isSwapped ? meta.footprintW : meta.footprintD;
  const hIndex = hexIndex(getPlanetRadius(opts.view));
  const tilesData = (opts.view as { tiles?: ClientTiles } | undefined)?.tiles;
  const occupied = collectOccupiedTileIndices(opts.view, hIndex);
  const scan = scanFootprintTiles(opts.q, opts.r, footprintW, footprintD, hIndex, occupied, tilesData, meta.requiresDeposit);
  const sim = scan.hasOccupied ? null : evaluateSiteWithSim(opts.view, { building: opts.building, q: opts.q, r: opts.r, colonyId: opts.colonyId ?? 0, data: clientDataFor(toFlagSet(opts.flags)) });
  const val = sim ? { valid: sim.valid, statusColor: sim.valid ? 'green' as const : 'red' as const, reason: sim.reason, depositCovered: sim.valid && scan.coveredDepositIndices.length > 0 }
    : evaluateValidity(Boolean(tilesData), scan.hasOutOfBounds, scan.hasImpassable, scan.hasOccupied, scan.terrainBlock, meta.requiresDeposit, scan.coveredDepositIndices.length);

  return {
    building: opts.building, label: meta.label, q: opts.q, r: opts.r, rotation: rot,
    footprintW, footprintD, footprintText: `${footprintW}×${footprintD}`,
    tiles: scan.tiles, prepBill: scan.prepBill, prepBillText: formatPrepBillText(scan.prepBill),
    valid: val.valid, statusColor: val.statusColor, reason: val.reason,
    requiresDeposit: meta.requiresDeposit, depositCovered: val.depositCovered, depositTileIndices: scan.coveredDepositIndices,
  };
}

function findValidPlacementSite(
  building: string,
  rotation: number,
  flags: ReadonlySet<string> | FlagSet,
  view: GameView,
  avoidIndices: ReadonlySet<number>, colonyId = 0,
): { q: number; r: number } | null {
  const searchR = Math.min(getPlanetRadius(view), 10);
  let best: { q: number; r: number; score: number } | null = null;
  for (let dr = -searchR; dr <= searchR; dr++) {
    for (let dq = -searchR; dq <= searchR; dq++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist > searchR) continue;
      const st = evaluatePlacementGhost({ building, q: dq, r: dr, rotation, flags, view, colonyId });
      if (!st.valid || st.tiles.some((t) => avoidIndices.has(t.tileIdx))) continue;
      const anchorDep = st.tiles[0]?.deposit === DEPOSIT.metals ? 0 : 1;
      const depPenalty = st.requiresDeposit === 'metals'
        ? anchorDep * 20 - st.depositTileIndices.length * 4
        : st.tiles.filter((t) => t.deposit !== DEPOSIT.none).length * 50;
      const score = depPenalty + dist * 4 + Math.abs(dr) * 0.1 + Math.abs(dq) * 0.05;
      if (!best || score < best.score) best = { q: dq, r: dr, score };
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

export interface PlacementGhostControllerOptions {
  container?: HTMLElement;
  ctx: FeatureContext;
  initialView?: GameView;
  onCancel?: () => void;
  onConfirm?: () => void;
}

export class PlacementGhostController implements Disposable {
  readonly element: HTMLElement;
  private readonly headTitle: HTMLElement;
  private readonly headFootprint: HTMLElement;
  private readonly depositBadge: HTMLElement;
  private readonly prepReadout: HTMLElement;
  private readonly reasonText: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private activeBuilding: string | null = null;
  private hoverQ = 0;
  private hoverR = 0;
  private rotation = 0;
  private state: PlacementGhostState | null = null;
  private view?: GameView;
  private readonly pendingIndices = new Set<number>();
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onContextMenu: (e: MouseEvent) => void;
  private readonly unbindSurface?: () => void;

  constructor(private readonly opts: PlacementGhostControllerOptions) {
    this.view = opts.initialView;
    this.element = document.createElement('div');
    this.element.className = 'ta-placement-ghost plate-sm';
    if (this.element.style) this.element.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'ta-placement-ghost__header';
    this.headTitle = document.createElement('span');
    this.headTitle.className = 'ta-placement-ghost__title';
    this.headFootprint = document.createElement('span');
    this.headFootprint.className = 'ta-placement-ghost__footprint';
    header.append(this.headTitle, this.headFootprint);

    this.depositBadge = document.createElement('div');
    this.depositBadge.className = 'ta-placement-ghost__deposit';
    this.prepReadout = document.createElement('div');
    this.prepReadout.className = 'ta-placement-ghost__prep';
    this.reasonText = document.createElement('div');
    this.reasonText.className = 'ta-placement-ghost__reason';

    const actions = document.createElement('div');
    actions.className = 'ta-placement-ghost__actions';
    this.confirmBtn = document.createElement('button');
    this.confirmBtn.type = 'button';
    this.confirmBtn.className = 'ta-placement-ghost__confirm btn-sm';
    this.confirmBtn.textContent = 'Build';
    this.confirmBtn.onclick = (e) => { e?.stopPropagation?.(); this.confirm(); };

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'ta-placement-ghost__cancel btn-sm';
    this.cancelBtn.textContent = 'Cancel [Esc]';
    this.cancelBtn.onclick = (e) => { e?.stopPropagation?.(); this.cancel(); };
    actions.append(this.confirmBtn, this.cancelBtn);

    this.element.append(header, this.depositBadge, this.prepReadout, this.reasonText, actions);
    this.element.onclick = (e) => {
      const target = e?.target as HTMLElement | null;
      if (target?.closest?.('.ta-placement-ghost__cancel')) return;
      if (this.state?.valid) this.confirm();
    };

    this.onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.onContextMenu = (e: MouseEvent) => { if (this.activeBuilding) { e.preventDefault?.(); this.cancel(); } };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown, { capture: true });
      window.addEventListener('contextmenu', this.onContextMenu);
    }
    this.unbindSurface = this.bindCanvasSurface();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.activeBuilding) return;
    if (!isHotkeyPress(e)) return; // typing, auto-repeat and Ctrl/Cmd+R (page reload) are not a rotate
    if (e.key === 'r' || e.key === 'R') { e.preventDefault?.(); this.rotate(); }
    else if (e.key === 'Escape') { e.preventDefault?.(); e.stopImmediatePropagation?.(); this.cancel(); }
  }

  private bindCanvasSurface(): (() => void) | undefined {
    const surface = (this.opts.ctx.services.surface ?? this.opts.ctx.services.canvas) as HTMLElement | undefined;
    if (!surface || typeof surface.addEventListener !== 'function') return undefined;
    return bindExclusivePointer(surface, () => this.activeBuilding !== null, {
      move: (e) => {
        if (this.opts.ctx.services.scene3d) return;
        const coord = resolvePointerTile(e, this.opts.ctx.services.pickTile);
        if (coord && (coord.q !== this.hoverQ || coord.r !== this.hoverR)) this.setHoverTile(coord.q, coord.r);
      },
      up: (e) => {
        if (e.button === 2) { if (this.activeBuilding) this.cancel(); return; }
        if (e.button === 0 && this.activeBuilding) {
          const coord = resolvePointerTile(e, this.opts.ctx.services.pickTile);
          if (coord) this.setHoverTile(coord.q, coord.r);
          if (this.state?.valid) this.confirm();
        }
      },
      context: () => { if (this.activeBuilding) this.cancel(); },
    });
  }

  private resolveEffectiveView(): GameView | undefined {
    const store = (this.opts.ctx.services.store as { latest?: GameView | null; latestTiles?: ClientTiles | null } | undefined);
    const base = this.view ?? this.opts.ctx.services.getView?.() ?? store?.latest ?? undefined;
    const hasTiles = Boolean((base as { tiles?: ClientTiles } | undefined)?.tiles);
    return !hasTiles && store?.latestTiles ? ({ ...(base ?? {}), tiles: store.latestTiles } as GameView) : base;
  }

  start(building: string): void {
    this.activeBuilding = building;
    this.rotation = 0;
    if (this.opts.container && !this.element.parentElement) this.opts.container.appendChild(this.element);
    if (this.element.style) this.element.style.display = '';
    const effView = this.resolveEffectiveView();
    if (effView && (effView as { tiles?: ClientTiles }).tiles) {
      const cur = evaluatePlacementGhost({ building, q: this.hoverQ, r: this.hoverR, rotation: this.rotation, flags: this.opts.ctx.flags, view: effView, colonyId: ownColonyIndex(this.opts.ctx.services) });
      if (!cur.valid || cur.tiles.some((t) => this.pendingIndices.has(t.tileIdx))) {
        const site = findValidPlacementSite(building, this.rotation, this.opts.ctx.flags, effView, this.pendingIndices, ownColonyIndex(this.opts.ctx.services));
        if (site) { this.hoverQ = site.q; this.hoverR = site.r; }
      }
    }
    this.evaluate();
  }

  setHoverTile(q: number, r: number): void {
    this.hoverQ = q;
    this.hoverR = r;
    if (!this.activeBuilding) return;
    const effView = this.resolveEffectiveView();
    const tilesData = (effView as { tiles?: ClientTiles } | undefined)?.tiles;
    if (effView && tilesData?.deposit) {
      const direct = evaluatePlacementGhost({ building: this.activeBuilding, q, r, rotation: this.rotation, flags: this.opts.ctx.flags, view: effView, colonyId: ownColonyIndex(this.opts.ctx.services) });
      const hoverIdx = hexIndex(getPlanetRadius(effView)).indexOf(q, r);
      if (!direct.valid && direct.requiresDeposit === 'metals' && hoverIdx >= 0 && tilesData.deposit[hoverIdx] === DEPOSIT.metals) {
        for (const [aq, ar] of [[q - 1, r], [q, r - 1], [q - 1, r - 1]]) {
          if (evaluatePlacementGhost({ building: this.activeBuilding, q: aq, r: ar, rotation: this.rotation, flags: this.opts.ctx.flags, view: effView, colonyId: ownColonyIndex(this.opts.ctx.services) }).valid) {
            this.hoverQ = aq;
            this.hoverR = ar;
            break;
          }
        }
      }
    }
    this.evaluate();
  }

  rotate(): void {
    this.rotation = (this.rotation + 1) % 6;
    if (this.activeBuilding) this.evaluate();
  }

  cancel(): void {
    this.activeBuilding = null;
    this.state = null;
    if (this.element.style) this.element.style.display = 'none';
    this.element.remove();
    this.opts.onCancel?.();
  }

  confirm(): boolean {
    if (!this.activeBuilding || !this.state || !this.state.valid) return false;
    const { building, q, r, rotation, tiles } = this.state;
    for (const t of tiles) if (t.tileIdx >= 0) this.pendingIndices.add(t.tileIdx);
    this.opts.ctx.services.sendCommand?.('enqueueTask', { task: { kind: 'build', building, q, r, rotation } });
    this.cancel();
    this.opts.onConfirm?.();
    return true;
  }

  updateView(view: GameView): void {
    const prevTiles = (this.view as { tiles?: ClientTiles } | undefined)?.tiles;
    const nextTiles = (view as { tiles?: ClientTiles } | undefined)?.tiles;
    this.view = nextTiles || !prevTiles ? view : ({ ...view, tiles: prevTiles } as GameView);
    if (this.activeBuilding) this.evaluate();
  }

  getState(): PlacementGhostState | null { return this.state; }

  private evaluate(): void {
    if (!this.activeBuilding) { this.state = null; return; }
    this.state = evaluatePlacementGhost({
      building: this.activeBuilding,
      q: this.hoverQ,
      r: this.hoverR,
      rotation: this.rotation,
      flags: this.opts.ctx.flags,
      view: this.resolveEffectiveView(), colonyId: ownColonyIndex(this.opts.ctx.services),
    });
    this.renderState(this.state);
  }

  private renderState(state: PlacementGhostState): void {
    this.element.setAttribute('data-valid', String(state.valid));
    this.element.setAttribute('data-color', state.statusColor);
    this.element.setAttribute('data-deposit-covered', String(state.depositCovered));
    this.element.setAttribute('data-building', state.building);
    this.headTitle.textContent = state.label;
    this.headFootprint.textContent = `${state.footprintText} · rot ${state.rotation} [R]`;

    if (state.requiresDeposit === 'metals') {
      if (this.depositBadge.style) this.depositBadge.style.display = '';
      this.depositBadge.textContent = state.depositCovered ? 'Deposit covered ✔' : 'must cover a metals deposit';
      this.depositBadge.setAttribute('data-covered', String(state.depositCovered));
    } else {
      if (this.depositBadge.style) this.depositBadge.style.display = 'none';
      this.depositBadge.textContent = '';
      this.depositBadge.removeAttribute('data-covered');
    }

    this.prepReadout.textContent = state.prepBillText;
    this.reasonText.textContent = state.reason;
    this.confirmBtn.disabled = !state.valid;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, { capture: true });
      window.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.unbindSurface?.();
    this.element.remove();
  }
}
