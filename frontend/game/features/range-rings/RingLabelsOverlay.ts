import * as THREE from 'three';
import {
  RING_Y_OFFSET,
  type RangeRingDescriptor,
  type RangeRingKind,
  type RingHeightSampler,
} from '@terra/render/visuals/rings';
import type { FeatureContext } from '../../core/registry/types';
import './rangeRings.css';

interface OverlayServices {
  hudOverlay?: HTMLElement | null;
  surface?: HTMLElement | null;
  canvas?: HTMLElement | null;
  camera?: THREE.Camera | null;
  rtsCamera?: { camera?: THREE.Camera | null } | null;
}

interface PlacedLabel {
  kind: RangeRingKind;
  text: string;
  x: number;
  y: number;
}

const ARC_SAMPLE_COUNT = 32;
const VIEWPORT_PAD_X = 82;
const VIEWPORT_PAD_Y = 38;

function labelPrefix(kind: RangeRingKind): string {
  if (kind === 'viewRange') return 'SIGHT';
  if (kind === 'enemyWeapon') return 'ENEMY RANGE';
  return 'FIRING RANGE';
}

function isSingleSubject(rings: readonly RangeRingDescriptor[]): boolean {
  if (rings.length === 0 || rings.length > 2) return false;
  let entityId: number | undefined;
  let hasGhost = false;
  let hasEntity = false;
  for (const r of rings) {
    if (r.kind === 'ghostWeapon') hasGhost = true;
    if (r.entityId !== undefined) {
      hasEntity = true;
      if (entityId === undefined) entityId = r.entityId;
      else if (entityId !== r.entityId) return false;
    }
  }
  return !(hasEntity && hasGhost);
}

/**
 * Projects on-ring micro-badges (`FIRING RANGE · N` / `SIGHT · N`) onto single-unit circles when
 * a 3D camera is active, and displays a compact Faction Plate legend strip for multi-unit / fallback views.
 */
export class RingLabelsOverlay {
  readonly el: HTMLElement | null = null;
  private readonly tagsEl: HTMLElement | null = null;
  private readonly legendEl: HTMLElement | null = null;
  private readonly projVec = new THREE.Vector3();
  private readonly centerVec = new THREE.Vector3();

  constructor(private readonly ctx: FeatureContext) {
    if (typeof document === 'undefined') return;
    const services = ctx.services as OverlayServices;
    const host = services.hudOverlay;
    if (!host) return;

    const root = document.createElement('div');
    root.className = 'ta-range-rings-overlay';
    root.dataset.testid = 'range-rings-overlay';
    root.hidden = true;

    const tags = document.createElement('div');
    tags.className = 'ta-range-rings-tags';

    const legend = document.createElement('div');
    legend.className = 'ta-range-rings-legend';
    legend.dataset.testid = 'range-rings-legend';
    legend.hidden = true;

    root.append(tags, legend);
    host.appendChild(root);
    this.el = root;
    this.tagsEl = tags;
    this.legendEl = legend;
  }

  private resolveCamera(): THREE.Camera | null {
    const s = this.ctx.services as OverlayServices;
    return s.camera ?? s.rtsCamera?.camera ?? null;
  }

  private resolveViewportRect(): { left: number; top: number; width: number; height: number } | null {
    const s = this.ctx.services as OverlayServices;
    const canvas = (s.surface ?? s.canvas) as HTMLElement | null | undefined;
    if (canvas && typeof canvas.getBoundingClientRect === 'function') {
      const r = canvas.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) return r;
    }
    return null;
  }

  private pickRingAnchor(
    ring: RangeRingDescriptor,
    camera: THREE.Camera,
    rect: { left: number; top: number; width: number; height: number },
    heightSampler: RingHeightSampler | null,
  ): { x: number; y: number } | null {
    this.centerVec.set(ring.worldX, ring.worldY, ring.worldZ).project(camera);
    const cx = rect.left + (this.centerVec.x * 0.5 + 0.5) * rect.width;
    const cy = rect.top + (-this.centerVec.y * 0.5 + 0.5) * rect.height;

    const preferRight = ring.kind !== 'viewRange';
    let best: { x: number; y: number; score: number } | null = null;

    for (let i = 0; i < ARC_SAMPLE_COUNT; i++) {
      const theta = (i / ARC_SAMPLE_COUNT) * Math.PI * 2;
      const wx = ring.worldX + Math.cos(theta) * ring.radiusMeters;
      const wz = ring.worldZ + Math.sin(theta) * ring.radiusMeters;
      const wy = heightSampler ? heightSampler(wx, wz) + RING_Y_OFFSET : ring.worldY;
      this.projVec.set(wx, wy, wz).project(camera);
      if (this.projVec.z < -1 || this.projVec.z > 1) continue;
      const sx = rect.left + (this.projVec.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-this.projVec.y * 0.5 + 0.5) * rect.height;
      if (
        sx < rect.left + VIEWPORT_PAD_X ||
        sx > rect.left + rect.width - VIEWPORT_PAD_X ||
        sy < rect.top + VIEWPORT_PAD_Y ||
        sy > rect.top + rect.height - VIEWPORT_PAD_Y - 80
      ) {
        continue;
      }

      const dx = sx - cx;
      const dy = sy - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / len;
      const ny = dy / len;
      // Bias weapon/firing rings toward upper-right and sight rings toward upper-left so badges separate naturally.
      const dirScore = (preferRight ? nx : -nx) * 1.3 + -ny;
      if (!best || dirScore > best.score) {
        best = { x: sx, y: sy, score: dirScore };
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  private renderTags(labels: readonly PlacedLabel[]): void {
    if (!this.tagsEl) return;
    if (labels.length === 0) {
      this.tagsEl.replaceChildren();
      return;
    }
    const nodes: HTMLElement[] = [];
    for (const item of labels) {
      const tag = document.createElement('div');
      tag.className = 'ta-range-ring-tag';
      tag.dataset.kind = item.kind;
      tag.dataset.testid = `range-ring-tag-${item.kind}`;
      tag.style.left = `${Math.round(item.x)}px`;
      tag.style.top = `${Math.round(item.y)}px`;

      const swatch = document.createElement('span');
      swatch.className = 'ta-range-rings-swatch';
      swatch.dataset.kind = item.kind;

      const text = document.createElement('span');
      text.textContent = item.text;

      tag.append(swatch, text);
      nodes.push(tag);
    }
    this.tagsEl.replaceChildren(...nodes);
  }

  private renderLegend(rings: readonly RangeRingDescriptor[], single: boolean): void {
    if (!this.legendEl) return;
    const seen = new Map<RangeRingKind, RangeRingDescriptor>();
    for (const r of rings) {
      const key: RangeRingKind = r.kind === 'ghostWeapon' ? 'weapon' : r.kind;
      if (!seen.has(key)) seen.set(key, r);
    }
    if (seen.size === 0) {
      this.legendEl.hidden = true;
      this.legendEl.replaceChildren();
      return;
    }

    const order: readonly RangeRingKind[] = ['weapon', 'viewRange', 'enemyWeapon'];
    const items: HTMLElement[] = [];
    for (const kind of order) {
      const sample = seen.get(kind);
      if (!sample) continue;
      const row = document.createElement('span');
      row.className = 'ta-range-rings-legend__item';
      row.dataset.kind = kind;

      const swatch = document.createElement('span');
      swatch.className = 'ta-range-rings-swatch';
      swatch.dataset.kind = kind;

      const label = document.createElement('span');
      label.textContent = single
        ? `${labelPrefix(kind)} · ${Math.round(sample.radiusTiles)}`
        : labelPrefix(kind);

      row.append(swatch, label);
      items.push(row);
    }

    this.legendEl.hidden = items.length === 0;
    this.legendEl.replaceChildren(...items);
  }

  update(rings: readonly RangeRingDescriptor[], heightSampler: RingHeightSampler | null = null): void {
    if (!this.el || !this.tagsEl || !this.legendEl) return;
    if (rings.length === 0) {
      this.el.hidden = true;
      this.tagsEl.replaceChildren();
      this.legendEl.hidden = true;
      this.legendEl.replaceChildren();
      return;
    }

    this.el.hidden = false;
    const single = isSingleSubject(rings);
    const camera = single ? this.resolveCamera() : null;
    const rect = single ? this.resolveViewportRect() : null;
    const placed: PlacedLabel[] = [];
    let allAnchored = single && Boolean(camera && rect);

    if (single && camera && rect) {
      camera.updateMatrixWorld();
      for (const ring of rings) {
        const pt = this.pickRingAnchor(ring, camera, rect, heightSampler);
        if (!pt) {
          allAnchored = false;
          continue;
        }
        let y = pt.y;
        for (const prev of placed) {
          if (Math.abs(pt.x - prev.x) < 138 && Math.abs(y - prev.y) < 28) {
            y = prev.y + 30;
          }
        }
        placed.push({
          kind: ring.kind,
          text: `${labelPrefix(ring.kind)} · ${Math.round(ring.radiusTiles)}`,
          x: pt.x,
          y,
        });
      }
    }

    this.renderTags(placed);
    if (allAnchored && placed.length === rings.length) {
      this.legendEl.hidden = true;
      this.legendEl.replaceChildren();
    } else {
      this.renderLegend(rings, single);
    }
  }

  dispose(): void {
    this.el?.remove();
  }
}
