import * as THREE from 'three';
import { resolveDescentPrestige } from '@terra/render/descent/types';
import { FLAGSHIP_CARRIER_ID } from '@terra/render/prestige/tierVisuals';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '@terra/render/visuals/space/placeholders';
import { smoother } from '../math';
import type { DescentContext, FramePart, FrameState } from './FrameState';

const DESCENT_FLAGSHIP_SIZE = 24;
const SKYBOX_CUTOFF_TN = 14.5;

/**
 * W28-12 (`NEAR_STAKING_SPEC` §3): parks the planet's Tier 4 Lead Patron Flagship Orbital Carrier
 * (`ISS <pilot>.near`) in the high-orbit Descent skybox during the orbital & exosphere phases (`tn < 14.5`).
 * Zero allocation when the planet has no Lead Patron.
 */
export class DescentFlagship implements FramePart {
  private model: FittedModel | null = null;
  private carrierName = '';

  constructor(private readonly ctx: DescentContext) {}

  get activeName(): string {
    return this.carrierName;
  }

  update(f: FrameState): void {
    const rawName = resolveDescentPrestige(this.ctx.prestige)?.flagshipCarrierName?.trim() ?? '';
    if (!rawName || f.tn >= SKYBOX_CUTOFF_TN) {
      if (this.model) this.model.root.visible = false;
      if (!rawName) this.carrierName = '';
      return;
    }
    this.carrierName = rawName;
    const m = this.ensureModel();
    const drift = smoother(2, SKYBOX_CUTOFF_TN, f.tn);
    m.root.visible = true;
    m.root.position.set(
      f.podCenter.x - 36 - 20 * drift,
      f.podCenter.y + 16 + 34 * drift,
      f.podCenter.z - 92 - 40 * drift,
    );
    m.root.rotation.set(0.05, 0.58 + 0.06 * drift, -0.04);
    tickArchetypeMesh(m.mesh, f.tn);
  }

  private ensureModel(): FittedModel {
    if (this.model) return this.model;
    const m = acquireModel(
      FLAGSHIP_CARRIER_ID,
      this.ctx.spec.biomeKey,
      { size: DESCENT_FLAGSHIP_SIZE, mode: 'max', force: true },
      { spaceLit: true },
    );
    m.root.name = 'descent:flagshipCarrier';
    m.root.rotation.order = 'YXZ';
    m.root.traverse((ob) => {
      const mat = (ob as THREE.Mesh).material as (THREE.Material & { fog?: boolean }) | undefined;
      if (mat) mat.fog = false;
    });
    this.ctx.root.add(m.root);
    this.model = m;
    return m;
  }

  dispose(): void {
    if (!this.model) return;
    this.ctx.root.remove(this.model.root);
    this.model.dispose();
    this.model = null;
    this.carrierName = '';
  }
}
