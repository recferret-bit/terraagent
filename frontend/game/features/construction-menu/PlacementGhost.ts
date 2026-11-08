import type { FlagSet } from '@terra/contracts';
import { DEPOSIT, GEO_BLOCK_TEXT, PREP, TERRAIN, geoBuildBlock, geoBuildOptionsFor, hexDistance, type GeoBlock, type GeoBuildOptions } from '@terra/sim';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { extractHqFromView } from '../shared/hqView';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { isHotkeyPress } from '../shared/hotkeys';
import { bindExclusivePointer, resolvePointerTile } from '../shared/pointer';
import { buildGhostContext, resolveBuildingMeta, type GhostContext } from './ghostContext';
import { getTilePrepOp, isW05LinkedPrepActive, resolveGhostPrepBill } from './prepBillFormat';
import { depositReasonText, evaluateSiteWithSim, ownColonyIndex } from './sitePlacement';

export interface PlacementGhostTile {
  q: number; r: number; tileIdx: number; deposit: number; terrain: number; prep: number; prepOp?: string;
}

export interface PlacementGhostState {
  building: string; label: string; q: number; r: number; rotation: number;
  footprintW: number; footprintD: number; footprintText: string;
  tiles: PlacementGhostTile[]; prepBill: Record<string, number>; prepBillText: string;
  prepEnergyE?: number; prepTimeS?: number; prepCost?: Record<string, number>;
  valid: boolean; statusColor: 'green' | 'red'; reason: string;
  requiresDeposit?: string; depositCovered: boolean; depositTileIndices: number[];
}

function depositCodeForRequired(requiresDeposit?: string): number | undefined {
  if (requiresDeposit === 'metals') return DEPOSIT.metals;
  if (requiresDeposit === 'minerals') return DEPOSIT.minerals;
  if (requiresDeposit === 'oil') return DEPOSIT.oil;
  return undefined;
}

function matchesDeposit(deposit: number | undefined, reqCode: number | undefined): boolean {
  return reqCode !== undefined && (deposit === reqCode || (reqCode === DEPOSIT.metals && deposit === DEPOSIT.minerals));
}

export interface EvaluatePlacementGhostOptions {
  building: string; q: number; r: number; rotation: number; flags: ReadonlySet<string> | FlagSet; view?: GameView; colonyId?: number;
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
  geo: GeoBuildOptions = { linkedPrep: false },
): FootprintScanResult {
  const w05Active = geo.linkedPrep === true;
  const tiles: PlacementGhostTile[] = [];
  const prepBill: Record<string, number> = {};
  const coveredDepositIndices: number[] = [];
  let hasOutOfBounds = false, hasImpassable = false, hasOccupied = false, terrainBlock: GeoBlock | null = null;

  const reqDepCode = depositCodeForRequired(requiresDeposit);
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
        // One rule with the host (D-37): trees, rock, slope, hole, water, ridge: terraform first (unless W05 linkedPrep).
        terrainBlock ??= geoBuildBlock(terrain, prep, DEPOSIT.none, 'any', geo);
        if ((!w05Active && terrain === TERRAIN.deep) || prep === PREP.ridge || prep === PREP.moat) hasImpassable = true;
        if (matchesDeposit(deposit, reqDepCode)) coveredDepositIndices.push(tileIdx);
      }
      const prepOp = tilesData ? getTilePrepOp(terrain, prep, w05Active) : undefined;
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
  if (requiresDeposit === 'metals' || requiresDeposit === 'minerals' || requiresDeposit === 'oil') {
    if (depositCount === 0) return { valid: false, statusColor: 'red', reason: depositReasonText('', requiresDeposit), depositCovered: false };
    return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: true };
  }
  return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: false };
}

/**
 * The construction ghost's verdict on one site. `ctx` (`buildGhostContext`) carries the site-independent inputs; a
 * caller judging many sites on one view (the auto-site search, the Extractor anchor nudge) builds it once.
 */
export function evaluatePlacementGhost(opts: EvaluatePlacementGhostOptions, ctx: GhostContext = buildGhostContext(opts.flags, opts.view)): PlacementGhostState {
  const meta = resolveBuildingMeta(ctx.data, opts.building);
  const rot = ((opts.rotation % 6) + 6) % 6;
  const isSwapped = rot % 2 !== 0;
  const footprintW = isSwapped ? meta.footprintD : meta.footprintW;
  const footprintD = isSwapped ? meta.footprintW : meta.footprintD;
  const tilesData = (opts.view as { tiles?: ClientTiles } | undefined)?.tiles;
  const w05Active = isW05LinkedPrepActive(opts.flags, ctx.data);
  // The host's geo options (D-37): linked prep, and deep water once the colony has a worker of `deepReclaim`'s tier.
  const geo = { ...geoBuildOptionsFor(ctx.world, opts.colonyId ?? 0, ctx.data), linkedPrep: w05Active };
  const scan = scanFootprintTiles(opts.q, opts.r, footprintW, footprintD, ctx.hIndex, ctx.occupied, tilesData, meta.requiresDeposit, geo);
  const sim = scan.hasOccupied ? null : evaluateSiteWithSim(opts.view, { building: opts.building, q: opts.q, r: opts.r, colonyId: opts.colonyId ?? 0, data: ctx.data, world: ctx.world });
  const val = sim ? { valid: sim.valid, statusColor: sim.valid ? 'green' as const : 'red' as const, reason: sim.reason, depositCovered: sim.valid && scan.coveredDepositIndices.length > 0 }
    : evaluateValidity(Boolean(tilesData), scan.hasOutOfBounds, scan.hasImpassable, scan.hasOccupied, scan.terrainBlock, meta.requiresDeposit, scan.coveredDepositIndices.length);
  const billSummary = resolveGhostPrepBill(scan.tiles, scan.prepBill, sim?.bill, ctx.data, w05Active);

  return {
    building: opts.building, label: meta.label, q: opts.q, r: opts.r, rotation: rot,
    footprintW, footprintD, footprintText: `${footprintW}×${footprintD}`,
    tiles: scan.tiles, prepBill: billSummary.prepBill, prepBillText: billSummary.prepBillText,
    ...(billSummary.prepEnergyE !== undefined ? { prepEnergyE: billSummary.prepEnergyE } : {}),
    ...(billSummary.prepTimeS !== undefined ? { prepTimeS: billSummary.prepTimeS } : {}),
    ...(billSummary.prepCost !== undefined ? { prepCost: billSummary.prepCost } : {}),
    valid: val.valid, statusColor: val.statusColor, reason: val.reason,
    requiresDeposit: meta.requiresDeposit, depositCovered: val.depositCovered, depositTileIndices: scan.coveredDepositIndices,
  };
}

/** Best valid site within 10 hexes of the own HQ (else the planet origin): deposits scored per building, then distance. */
function findValidPlacementSite(
  base: Omit<EvaluatePlacementGhostOptions, 'q' | 'r'> & { view: GameView },
  avoidIndices: ReadonlySet<number>,
  ctx: GhostContext,
): { q: number; r: number } | null {
  const searchR = Math.min(ctx.radius, 10);
  const hq = extractHqFromView(base.view, base.colonyId ?? 0);
  const cq = Math.round(hq?.q ?? 0), cr = Math.round(hq?.r ?? 0);
  let best: { q: number; r: number; score: number } | null = null;
  for (let dr = -searchR; dr <= searchR; dr++) {
    for (let dq = -searchR; dq <= searchR; dq++) {
      const dist = hexDistance(0, 0, dq, dr);
      if (dist > searchR) continue;
      const st = evaluatePlacementGhost({ ...base, q: cq + dq, r: cr + dr }, ctx);
      if (!st.valid || st.tiles.some((t) => avoidIndices.has(t.tileIdx))) continue;
      const reqCode = depositCodeForRequired(st.requiresDeposit);
      const anchorDep = matchesDeposit(st.tiles[0]?.deposit, reqCode) ? 0 : 1;
      const depPenalty = reqCode !== undefined
        ? anchorDep * 20 - st.depositTileIndices.length * 4
        : st.tiles.filter((t) => t.deposit !== DEPOSIT.none).length * 50;
      const score = depPenalty + dist * 4 + Math.abs(dr) * 0.1 + Math.abs(dq) * 0.05;
      if (!best || score < best.score) best = { q: cq + dq, r: cr + dr, score };
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
      this.confirm();
    };

    this.onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    this.onContextMenu = (e: MouseEvent) => { if (this.activeBuilding && !isGameInputBlocked()) { e.preventDefault?.(); this.cancel(); } };
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
          this.confirm();
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

  /** The site-independent ghost inputs on `view` for `building` (one build per user action, shared by its evaluations). */
  private ghostInputs(building: string, view: GameView | undefined) {
    const base = { building, rotation: this.rotation, flags: this.opts.ctx.flags, view, colonyId: ownColonyIndex(this.opts.ctx.services) };
    return { base, ctx: buildGhostContext(base.flags, view, this.opts.ctx.services.store) };
  }

  start(building: string): void {
    this.activeBuilding = building;
    this.rotation = 0;
    if (this.opts.container && !this.element.parentElement) this.opts.container.appendChild(this.element);
    if (this.element.style) this.element.style.display = '';
    const effView = this.resolveEffectiveView();
    if (effView && (effView as { tiles?: ClientTiles }).tiles) {
      const { base, ctx } = this.ghostInputs(building, effView);
      const cur = evaluatePlacementGhost({ ...base, q: this.hoverQ, r: this.hoverR }, ctx);
      if (!cur.valid || cur.tiles.some((t) => this.pendingIndices.has(t.tileIdx))) {
        const site = findValidPlacementSite({ ...base, view: effView }, this.pendingIndices, ctx);
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
      const { base, ctx } = this.ghostInputs(this.activeBuilding, effView);
      const direct = evaluatePlacementGhost({ ...base, q, r }, ctx);
      const hoverIdx = ctx.hIndex.indexOf(q, r);
      const reqCode = depositCodeForRequired(direct.requiresDeposit);
      if (!direct.valid && hoverIdx >= 0 && matchesDeposit(tilesData.deposit[hoverIdx], reqCode)) {
        for (const [aq, ar] of [[q - 1, r], [q, r - 1], [q - 1, r - 1]]) {
          if (evaluatePlacementGhost({ ...base, q: aq, r: ar }, ctx).valid) {
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
    if (!this.activeBuilding || !this.state) return false;
    if (!this.state.valid) {
      this.opts.ctx.services.hudMin?.showToast(`Cannot build here: ${this.state.reason}`, 'warning', 5000, 'placement-invalid');
      return false;
    }
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
    const effView = this.resolveEffectiveView();
    const { base, ctx } = this.ghostInputs(this.activeBuilding, effView);
    this.state = evaluatePlacementGhost({ ...base, q: this.hoverQ, r: this.hoverR }, ctx);
    this.renderState(this.state);
  }

  private renderState(state: PlacementGhostState): void {
    this.element.setAttribute('data-valid', String(state.valid));
    this.element.setAttribute('data-color', state.statusColor);
    this.element.setAttribute('data-deposit-covered', String(state.depositCovered));
    this.element.setAttribute('data-building', state.building);
    this.headTitle.textContent = state.label;
    this.headFootprint.textContent = `${state.footprintText} · rot ${state.rotation} [R]`;

    if (state.requiresDeposit === 'metals' || state.requiresDeposit === 'minerals' || state.requiresDeposit === 'oil') {
      if (this.depositBadge.style) this.depositBadge.style.display = '';
      this.depositBadge.textContent = state.depositCovered ? 'Deposit covered ✔' : depositReasonText(state.building, state.requiresDeposit);
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
