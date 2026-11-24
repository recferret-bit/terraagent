import * as THREE from 'three';
import { FLAGSHIP_CARRIER_ID } from '../../prestige/tierVisuals';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../../visuals/space/placeholders';
import { syncSpaceBiomeRim } from '../../visuals/space/spaceLighting';
import type { OrbitalLeadPatron, ProjectedFlagship } from '../types';

/** Capital flagship scale (m) in the orbital skybox: >2× the 6 m standard carrier even in high orbit. */
export const FLAGSHIP_SIZE = 12.2;
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const _ctr = new THREE.Vector3();
const _toPlanet = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _belly = new THREE.Vector3();
const _up = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _right = new THREE.Vector3();
const _mat = new THREE.Matrix4();

/**
 * The Lead Patron's `ISS <pilot>.near` Flagship Orbital Carrier, parked in high inclined orbit above-left of the planet.
 * Banked so its 6 ventral-broadside drop-pod launch batteries aim inward toward `planetPos` while its 4 X-cruciform
 * sapphire solar arrays tilt toward the sun & camera. Clamps inside narrow mobile frustums so neither hull nor badge clips.
 */
export class FlagshipCarrier {
  private model: FittedModel | null = null;
  private baseScale = 1;
  private name = '';

  constructor(
    private readonly scene: THREE.Scene,
    private biomeKey = 'dune',
  ) {}

  get active(): boolean {
    return this.model !== null;
  }

  /** Syncs the flagship's Fresnel silhouette rim tint to the active orbital planet's biome. */
  setBiome(biomeKey: string): void {
    this.biomeKey = biomeKey;
    if (this.model) syncSpaceBiomeRim(this.model.mesh, biomeKey);
  }

  /** Show the flagship for `patron`, or remove it with `null`. A new name on a shown flagship just renames it. */
  setLeadPatron(patron: OrbitalLeadPatron | null): void {
    const name = patron?.carrierName.trim() ?? '';
    if (!patron || name === '') {
      this.remove();
      return;
    }
    this.name = name;
    if (this.model) return;
    this.model = acquireModel(
      FLAGSHIP_CARRIER_ID,
      this.biomeKey,
      { size: FLAGSHIP_SIZE, mode: 'max', force: true },
      { spaceLit: true },
    );
    this.baseScale = this.model.root.scale.x;
    this.model.root.rotation.order = 'YXZ';
    this.model.root.visible = false;
    this.scene.add(this.model.root);
  }

  /** Per frame. `show` is false during DEPLOY and the camera dive, when the ships and planet are on another path. */
  update(time: number, planetPos: THREE.Vector3, show: boolean, camera?: THREE.PerspectiveCamera): void {
    const m = this.model;
    if (!m) return;
    m.root.visible = show;
    if (!show) return;
    const fz = -6.8;
    const isNarrow = Boolean(camera && camera.aspect > 0 && camera.aspect < 1.05);
    const fitFactor = isNarrow && camera ? THREE.MathUtils.clamp(camera.aspect / 0.62, 0.72, 1) : 1;
    m.root.scale.setScalar(this.baseScale * fitFactor);
    let fx = Math.max(-1.6, planetPos.x - 8.5) + Math.sin(time * 0.06) * 0.42;
    let fy = (planetPos.x < 3 ? 9.2 : 4.5) + Math.sin(time * 0.13 + 1.1) * 0.22;
    if (isNarrow && camera) {
      const dz = Math.max(10, camera.position.z - fz);
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dz;
      const halfW = halfH * camera.aspect;
      const horizExtent = Math.min(halfW * 0.82, Math.max(m.size.x, m.size.z) * 0.5 * fitFactor);
      fx = THREE.MathUtils.clamp(-0.2 + Math.sin(time * 0.06) * 0.22, -halfW + horizExtent, halfW - horizExtent);
      fy = Math.min(halfH - 5.8, 7.6) + Math.sin(time * 0.13 + 1.1) * 0.18;
    }
    m.root.position.set(fx, fy, fz);
    // Planet-tracking prograde attitude (LVLH): ventral `-Y` (`_belly`) aims at `planetPos` (`dot > 0.96`) while banked
    // toward `camera` (`dot > 0.58`), and nose (`+Z`) glides prograde along the planet's upper-left horizon so both
    // ventral 3-pod batteries AND all 4 X-cruciform sapphire solar arrays present broad faces to the camera.
    _toPlanet.subVectors(planetPos, m.root.position);
    if (_toPlanet.lengthSq() < 1e-6) _toPlanet.set(0.58, -0.64, 0.5);
    else _toPlanet.normalize();
    if (camera) _toCam.subVectors(camera.position, m.root.position);
    else _toCam.set(-fx, 1.4 - fy, 62 - fz);
    if (_toCam.lengthSq() < 1e-6) _toCam.set(0, -0.1, 0.99);
    else _toCam.normalize();
    _belly.copy(_toPlanet).addScaledVector(_toCam, 0.24).normalize();
    const swayY = Math.sin(time * 0.08) * 0.03;
    const swayX = Math.sin(time * 0.05) * 0.04;
    _up.copy(_belly).negate();
    _nose.set(0.76 + swayX, 0.38 + swayY, 0.26);
    _nose.addScaledVector(_up, -_nose.dot(_up)).normalize();
    _right.crossVectors(_up, _nose).normalize();
    _up.crossVectors(_nose, _right).normalize();
    _mat.makeBasis(_right, _up, _nose);
    m.root.quaternion.setFromRotationMatrix(_mat);
    tickArchetypeMesh(m.mesh, time);
  }

  /** Screen anchor above the rotated hull/solar-wing crown, for the name label. Null when there is no patron. */
  project(camera: THREE.Camera): ProjectedFlagship | null {
    const m = this.model;
    if (!m) return null;
    m.root.updateMatrixWorld(true);
    _box.setFromObject(m.root);
    _box.getCenter(_ctr);
    _v.set(_ctr.x, _box.max.y + 0.14, _ctr.z);
    _v.project(camera);
    const inView = m.root.visible && _v.z > -1 && _v.z < 1 && Math.abs(_v.x) <= 0.98 && Math.abs(_v.y) <= 0.98;
    const isNarrow =
      (camera as THREE.PerspectiveCamera).aspect > 0 && (camera as THREE.PerspectiveCamera).aspect < 1.05;
    return {
      name: this.name,
      nx: THREE.MathUtils.clamp((_v.x + 1) / 2, isNarrow ? 0.28 : 0.42, isNarrow ? 0.72 : 0.62),
      ny: THREE.MathUtils.clamp((1 - _v.y) / 2, isNarrow ? 0.12 : 0.21, 0.88),
      visible: inView,
    };
  }

  private remove(): void {
    if (!this.model) return;
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = null;
    this.name = '';
  }

  dispose(): void {
    this.remove();
  }
}
