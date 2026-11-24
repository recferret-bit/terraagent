import * as THREE from 'three';
import { resolveDescentPrestige } from '@terra/render/descent/types';
import { FLAGSHIP_CARRIER_ID } from '@terra/render/prestige/tierVisuals';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '@terra/render/visuals/space/placeholders';
import { smoother } from '../math';
import type { DescentContext, FramePart, FrameState } from './FrameState';

export const DESCENT_FLAGSHIP_SIZE = 76;
const SKYBOX_CUTOFF_TN = 14.5;
const _toCam = new THREE.Vector3();
const _belly = new THREE.Vector3();
const _up = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _mat = new THREE.Matrix4();

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
    const chase = smoother(3.8, 6.4, f.tn);
    m.root.visible = true;
    m.root.position.set(
      f.podCenter.x + 122 - 42 * chase + 8 * drift,
      f.podCenter.y + 14 - 34 * chase - 72 * drift,
      f.podCenter.z - 160 - 26 * drift,
    );
    // Orient ventral drop-pod batteries downward toward the planet (`belly.y < -0.78`) AND banked toward the chase
    // camera (`dot(belly, toCam) > 0.42`) while tilting nose across the orbital limb so all 4 solar wings read broadly.
    _toCam.subVectors(f.camPos, m.root.position);
    if (_toCam.lengthSq() < 1e-6) _toCam.set(0.2, -0.15, 0.96);
    else _toCam.normalize();
    _belly.set(0, -1, 0).addScaledVector(_toCam, 0.58 + 0.16 * drift).normalize();
    _up.copy(_belly).negate();
    _nose.set(-0.68, 0.34, 0.64 + 0.06 * drift);
    _nose.addScaledVector(_up, -_nose.dot(_up)).normalize();
    _right.crossVectors(_up, _nose).normalize();
    _up.crossVectors(_nose, _right).normalize();
    _mat.makeBasis(_right, _up, _nose);
    m.root.quaternion.setFromRotationMatrix(_mat);
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
