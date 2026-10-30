import type { FlagSet } from '@terra/contracts';
import { DEPOSIT, PREP, TERRAIN, hexIndex } from '@terra/sim';
import { clientDataFor } from '../../core/flags/data';
import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import type { ClientTiles } from '../../store/replica/viewCodec';

export interface PlacementGhostTile {
  q: number;
  r: number;
  tileIdx: number;
  deposit: number;
  terrain: number;
  prep: number;
  prepOp?: string;
}

export interface PlacementGhostState {
  building: string;
  label: string;
  q: number;
  r: number;
  rotation: number;
  footprintW: number;
  footprintD: number;
  footprintText: string;
  tiles: PlacementGhostTile[];
  prepBill: Record<string, number>;
  prepBillText: string;
  valid: boolean;
  statusColor: 'green' | 'red';
  reason: string;
  requiresDeposit?: string;
  depositCovered: boolean;
  depositTileIndices: number[];
}

export interface EvaluatePlacementGhostOptions {
  building: string;
  q: number;
  r: number;
  rotation: number;
  flags: ReadonlySet<string> | FlagSet;
  view?: GameView;
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
      if (r && (r.building === building || r.id === building)) {
        row = r as Record<string, unknown>;
        break;
      }
    }
    if (row) break;
  }

  const label = typeof row?.label === 'string' ? row.label : (DEFAULT_LABELS[building] ?? building);
  const footprintW = typeof row?.footprintW === 'number' ? row.footprintW : (building === 'commandHub' ? 3 : 2);
  const footprintD = typeof row?.footprintD === 'number' ? row.footprintD : (building === 'commandHub' ? 3 : 2);
  const requiresDeposit = typeof row?.requiresDeposit === 'string'
    ? row.requiresDeposit
    : (building === 'metalsExtractor' ? 'metals' : undefined);

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
  if (terrain === TERRAIN.forest) return 'clear + prepare';
  if (terrain === TERRAIN.rock) return 'break + prepare';
  if (terrain === TERRAIN.slope || terrain === TERRAIN.hole) return 'flatten + prepare';
  return 'prepare';
}

function formatPrepOp(op: string): string {
  if (op === 'prepare') return 'Prepare';
  if (op === 'clear + prepare') return 'Clear + Prepare';
  if (op === 'break + prepare') return 'Break + Prepare';
  if (op === 'flatten + prepare') return 'Flatten + Prepare';
  return op.charAt(0).toUpperCase() + op.slice(1);
}

function formatPrepBillText(bill: Record<string, number>): string {
  const entries = Object.entries(bill);
  if (entries.length === 0) return 'Site prepared';
  const order: Record<string, number> = { 'clear + prepare': 1, 'break + prepare': 2, 'flatten + prepare': 3, prepare: 4 };
  entries.sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  return `Prep: ${entries.map(([op, count]) => `${count}× ${formatPrepOp(op)}`).join(', ')}`;
}

interface FootprintScanResult {
  tiles: PlacementGhostTile[];
  prepBill: Record<string, number>;
  coveredDepositIndices: number[];
  hasOutOfBounds: boolean;
  hasImpassable: boolean;
}

function scanFootprintTiles(
  q: number,
  r: number,
  w: number,
  d: number,
  hIndex: { indexOf(q: number, r: number): number },
  tilesData?: ClientTiles,
  requiresDeposit?: string,
): FootprintScanResult {
  const tiles: PlacementGhostTile[] = [];
  const prepBill: Record<string, number> = {};
  const coveredDepositIndices: number[] = [];
  let hasOutOfBounds = false;
  let hasImpassable = false;

  for (let dr = 0; dr < d; dr++) {
    for (let dq = 0; dq < w; dq++) {
      const tq = q + dq, tr = r + dr;
      const tileIdx = hIndex.indexOf(tq, tr);
      if (tileIdx < 0) {
        hasOutOfBounds = true;
        tiles.push({ q: tq, r: tr, tileIdx: -1, deposit: 0, terrain: 0, prep: 0 });
        continue;
      }

      const terrain = tilesData?.terrain ? (tilesData.terrain[tileIdx] ?? TERRAIN.flat) : TERRAIN.flat;
      const prep = tilesData?.prep ? (tilesData.prep[tileIdx] ?? PREP.wild) : PREP.wild;
      const deposit = tilesData?.deposit ? (tilesData.deposit[tileIdx] ?? DEPOSIT.none) : DEPOSIT.none;

      if (tilesData) {
        if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) hasImpassable = true;
        if (requiresDeposit === 'metals' && deposit === DEPOSIT.metals) coveredDepositIndices.push(tileIdx);
      }

      const prepOp = tilesData ? getTilePrepOp(terrain, prep) : undefined;
      if (prepOp) prepBill[prepOp] = (prepBill[prepOp] ?? 0) + 1;
      tiles.push({ q: tq, r: tr, tileIdx, deposit, terrain, prep, prepOp });
    }
  }

  return { tiles, prepBill, coveredDepositIndices, hasOutOfBounds, hasImpassable };
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
  requiresDeposit: string | undefined,
  depositCount: number,
): ValidityResult {
  if (!hasTiles) return { valid: true, statusColor: 'green', reason: 'valid site', depositCovered: false };
  if (hasOutOfBounds) return { valid: false, statusColor: 'red', reason: 'out of bounds', depositCovered: false };
  if (hasImpassable) return { valid: false, statusColor: 'red', reason: 'impassable terrain', depositCovered: false };
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

  const radius = getPlanetRadius(opts.view);
  const hIndex = hexIndex(radius);
  const tilesData = (opts.view as { tiles?: ClientTiles } | undefined)?.tiles;

  const scan = scanFootprintTiles(opts.q, opts.r, footprintW, footprintD, hIndex, tilesData, meta.requiresDeposit);
  const val = evaluateValidity(
    Boolean(tilesData),
    scan.hasOutOfBounds,
    scan.hasImpassable,
    meta.requiresDeposit,
    scan.coveredDepositIndices.length,
  );

  return {
    building: opts.building,
    label: meta.label,
    q: opts.q,
    r: opts.r,
    rotation: rot,
    footprintW,
    footprintD,
    footprintText: `${footprintW}×${footprintD}`,
    tiles: scan.tiles,
    prepBill: scan.prepBill,
    prepBillText: formatPrepBillText(scan.prepBill),
    valid: val.valid,
    statusColor: val.statusColor,
    reason: val.reason,
    requiresDeposit: meta.requiresDeposit,
    depositCovered: val.depositCovered,
    depositTileIndices: scan.coveredDepositIndices,
  };
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
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onContextMenu: (e: MouseEvent) => void;

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

    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.activeBuilding) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault?.();
        this.rotate();
      } else if (e.key === 'Escape') {
        e.preventDefault?.();
        this.cancel();
      }
    };
    this.onContextMenu = (e: MouseEvent) => {
      if (!this.activeBuilding) return;
      e.preventDefault?.();
      this.cancel();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('contextmenu', this.onContextMenu);
    }
  }

  start(building: string): void {
    this.activeBuilding = building;
    this.rotation = 0;
    if (this.opts.container && !this.element.parentElement) {
      this.opts.container.appendChild(this.element);
    }
    if (this.element.style) this.element.style.display = '';
    this.evaluate();
  }

  setHoverTile(q: number, r: number): void {
    this.hoverQ = q;
    this.hoverR = r;
    if (this.activeBuilding) this.evaluate();
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
    const { building, q, r, rotation } = this.state;
    this.opts.ctx.services.sendCommand?.('enqueueTask', {
      task: { kind: 'build', building, q, r, rotation },
    });
    this.cancel();
    this.opts.onConfirm?.();
    return true;
  }

  updateView(view: GameView): void {
    this.view = view;
    if (this.activeBuilding) this.evaluate();
  }

  getState(): PlacementGhostState | null {
    return this.state;
  }

  private evaluate(): void {
    if (!this.activeBuilding) {
      this.state = null;
      return;
    }
    this.state = evaluatePlacementGhost({
      building: this.activeBuilding,
      q: this.hoverQ,
      r: this.hoverR,
      rotation: this.rotation,
      flags: this.opts.ctx.flags,
      view: this.view,
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
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.element.remove();
  }
}
