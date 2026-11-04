import {
  getTerraformJobCost,
  listTerraformMenuOps,
  type CompiledDataLike,
  type TerraformOpKind,
  type TerraformOpSpec,
} from '@terra/sim';
import { makeBtn, makeDiv, makeSpan } from '../shared/dom';
import type { TileCoord } from '../shared/pointer';
import { formatCost } from '../shared/resources';
import type { TerraformButtonOp } from './planner';

export type BrushShape = 'single' | 'hex1' | 'hex2' | 'rect';

export interface W05OpDisplayInfo {
  readonly label: string;
  readonly icon: string;
  readonly transition: string;
}

export const W05_OP_DISPLAY: Readonly<Record<string, W05OpDisplayInfo>> = {
  grade: { label: 'Grade', icon: '⬡', transition: 'Flat → Prepared' },
  clear: { label: 'Clear', icon: '♣', transition: 'Forest → Flat' },
  break: { label: 'Break', icon: '◆', transition: 'Rock → Flat' },
  level: { label: 'Level', icon: '◢', transition: 'Slope → Flat' },
  fill: { label: 'Fill', icon: '▣', transition: 'Hole → Flat' },
  reclaim: { label: 'Reclaim', icon: '≈', transition: 'Shallow → Flat' },
  deepReclaim: { label: 'Deep Reclaim', icon: '≋', transition: 'Deep Water → Flat' },
  irrigate: { label: 'Irrigate', icon: '◈', transition: 'Prepared → Irrigated' },
  seed: { label: 'Seed', icon: '✦', transition: 'Irrigated → Living' },
};

/** Returns all axial hex coordinates within hex distance `radius` of `(centerQ, centerR)`. */
export function hexRadiusTiles(centerQ: number, centerR: number, radius: number): TileCoord[] {
  const rMax = Math.max(0, Math.trunc(radius));
  const cq = Math.trunc(centerQ);
  const cr = Math.trunc(centerR);
  const out: TileCoord[] = [];
  for (let dr = -rMax; dr <= rMax; dr++) {
    for (let dq = Math.max(-rMax, -dr - rMax); dq <= Math.min(rMax, -dr + rMax); dq++) {
      out.push({ q: cq + dq, r: cr + dr });
    }
  }
  return out;
}

/** Returns all axial hex coordinates in the bounding rectangle `(q1, r1)..(q2, r2)`. */
export function rectTiles(q1: number, r1: number, q2: number, r2: number): TileCoord[] {
  const minQ = Math.min(Math.trunc(q1), Math.trunc(q2));
  const maxQ = Math.max(Math.trunc(q1), Math.trunc(q2));
  const minR = Math.min(Math.trunc(r1), Math.trunc(r2));
  const maxR = Math.max(Math.trunc(r1), Math.trunc(r2));
  const out: TileCoord[] = [];
  for (let r = minR; r <= maxR; r++) {
    for (let q = minQ; q <= maxQ; q++) {
      out.push({ q, r });
    }
  }
  return out;
}

export function resolveBrushAreaTiles(
  shape: BrushShape,
  start: TileCoord,
  end: TileCoord,
  cancelMode = false,
): TileCoord[] {
  if (shape === 'hex1') return hexRadiusTiles(end.q, end.r, 1);
  if (shape === 'hex2') return hexRadiusTiles(end.q, end.r, 2);
  if (shape === 'rect') return rectTiles(start.q, start.r, end.q, end.r);
  if (cancelMode && (start.q !== end.q || start.r !== end.r)) {
    return rectTiles(start.q, start.r, end.q, end.r);
  }
  return [{ q: end.q, r: end.r }];
}

export function formatW05OpSubtitle(
  spec: TerraformOpSpec,
  data?: CompiledDataLike,
  planetType?: string,
): string {
  const info = W05_OP_DISPLAY[spec.op] ?? { label: spec.op, icon: '⬡', transition: '' };
  const cost = getTerraformJobCost(spec.op, data, planetType) as Record<string, number>;
  const costStr = formatCost(cost);
  const yieldStr = formatCost((spec.yields ?? {}) as Record<string, number>);
  const extra = costStr ? ` · ${costStr}` : yieldStr ? ` · +${yieldStr}` : '';
  return `${info.transition} · ${spec.energyCostE} E · ${spec.baseTimeS}s${extra}`;
}

export interface RenderW05OpsOptions {
  container: HTMLElement;
  data?: CompiledDataLike;
  planetType?: string;
  maxWorkerTier: number;
  selectedOp: TerraformButtonOp;
  armed: boolean;
  omitOps?: ReadonlySet<string>;
  onSelectOp: (op: TerraformOpKind) => void;
}

export function renderW05MenuOpChips(opts: RenderW05OpsOptions): Map<TerraformOpKind, HTMLButtonElement> {
  const { container, data, planetType, maxWorkerTier, selectedOp, armed, omitOps, onSelectOp } = opts;
  const specs = listTerraformMenuOps(data);
  const buttons = new Map<TerraformOpKind, HTMLButtonElement>();
  container.replaceChildren();

  for (const spec of specs) {
    if (omitOps?.has(spec.op)) continue;
    const info = W05_OP_DISPLAY[spec.op] ?? { label: spec.op, icon: '⬡', transition: '' };
    const tierLocked = spec.minWorkerTier > maxWorkerTier;
    const isSelected = armed && !tierLocked && selectedOp === spec.op;
    const baseCls = isSelected
      ? 'btn btn-sm btn-primary ta-tf-menu__op-btn ta-tf-menu__w05-chip'
      : 'btn btn-sm btn-ghost ta-tf-menu__op-btn ta-tf-menu__w05-chip';
    const cls = tierLocked ? `${baseCls} is-stage-locked is-tier-locked` : baseCls;

    const btn = makeBtn(cls, `tf-op-${spec.op}`, '', () => {
      if (!tierLocked) onSelectOp(spec.op);
    });
    btn.setAttribute('data-terraform-op', spec.op);
    btn.setAttribute('data-w05-op', spec.op);
    btn.setAttribute('data-icon', info.icon);
    btn.setAttribute('data-energy-e', String(spec.energyCostE));
    btn.setAttribute('data-time-s', String(spec.baseTimeS));
    btn.setAttribute('aria-pressed', String(isSelected));
    btn.setAttribute('data-disabled', String(tierLocked));
    btn.disabled = tierLocked;

    const headRow = makeDiv('ta-tf-menu__chip-head');
    const iconSpan = makeSpan('ta-tf-menu__op-icon', `tf-op-icon-${spec.op}`, info.icon);
    const titleSpan = makeSpan('ta-tf-menu__op-title', undefined, info.label);
    const metaSpan = makeSpan('ta-tf-menu__op-meta mono', undefined, `${spec.energyCostE} E · ${spec.baseTimeS}s`);
    headRow.append(iconSpan, titleSpan, metaSpan);

    const descSpan = makeSpan('ta-tf-menu__op-desc', undefined, formatW05OpSubtitle(spec, data, planetType));
    btn.append(headRow, descSpan);

    if (tierLocked) {
      const lockText = `needs T${spec.minWorkerTier} worker`;
      btn.setAttribute('data-tier-locked', 'true');
      btn.setAttribute('title', lockText);
      btn.setAttribute('aria-label', `${info.label} — ${lockText}`);
      const reasonSpan = makeSpan('ta-tf-menu__reason', `tf-op-lock-${spec.op}`, lockText);
      btn.appendChild(reasonSpan);
    }

    buttons.set(spec.op, btn);
    container.appendChild(btn);
  }
  return buttons;
}

export interface BrushBarRefs {
  readonly root: HTMLElement;
  readonly shapeButtons: ReadonlyMap<BrushShape, HTMLButtonElement>;
  readonly cancelAreaBtn: HTMLButtonElement;
}

const BRUSH_SHAPES: ReadonlyArray<{ shape: BrushShape; label: string; testid: string }> = [
  { shape: 'single', label: '1×1', testid: 'tf-brush-single' },
  { shape: 'hex1', label: 'Hex r=1', testid: 'tf-brush-hex-1' },
  { shape: 'hex2', label: 'Hex r=2', testid: 'tf-brush-hex-2' },
  { shape: 'rect', label: 'Rect', testid: 'tf-brush-rect' },
];

export function createBrushBarDom(
  onSelectShape: (shape: BrushShape) => void,
  onCancelArea: () => void,
): BrushBarRefs {
  const root = makeDiv('ta-tf-menu__brush-bar', 'tf-area-brush');
  const shapeButtons = new Map<BrushShape, HTMLButtonElement>();
  for (const def of BRUSH_SHAPES) {
    const btn = makeBtn('btn btn-sm btn-ghost ta-tf-menu__brush-btn', def.testid, def.label, () => onSelectShape(def.shape));
    btn.setAttribute('data-brush-shape', def.shape);
    shapeButtons.set(def.shape, btn);
    root.appendChild(btn);
  }
  const cancelAreaBtn = makeBtn(
    'btn btn-sm btn-ghost ta-tf-menu__brush-btn ta-tf-menu__cancel-area-btn',
    'tf-brush-cancel-area',
    'Cancel Area',
    onCancelArea,
  );
  cancelAreaBtn.setAttribute('data-action', 'cancel-area');
  root.appendChild(cancelAreaBtn);
  return { root, shapeButtons, cancelAreaBtn };
}

export function syncBrushBarDom(refs: BrushBarRefs, activeShape: BrushShape, cancelMode: boolean): void {
  for (const [shape, btn] of refs.shapeButtons) {
    const active = !cancelMode && shape === activeShape;
    btn.setAttribute('aria-pressed', String(active));
    btn.className = active
      ? 'btn btn-sm btn-primary ta-tf-menu__brush-btn'
      : 'btn btn-sm btn-ghost ta-tf-menu__brush-btn';
  }
  refs.cancelAreaBtn.setAttribute('aria-pressed', String(cancelMode));
  refs.cancelAreaBtn.className = cancelMode
    ? 'btn btn-sm btn-primary ta-tf-menu__brush-btn ta-tf-menu__cancel-area-btn'
    : 'btn btn-sm btn-ghost ta-tf-menu__brush-btn ta-tf-menu__cancel-area-btn';
}
