import * as THREE from 'three';
import { FLAGSHIP_CARRIER_ID } from '../../prestige/tierVisuals';
import { acquireModel, tickArchetypeMesh, type FittedModel } from '../../visuals/space/placeholders';
import type { OrbitalLeadPatron, ProjectedFlagship } from '../types';

/** Model size (m) in the skybox: a touch smaller than the menu carrier and farther back, so it reads as a second ship. */
const FLAGSHIP_SIZE = 6.4;
const _v = new THREE.Vector3();

/**
 * The Lead Patron's `ISS <pilot>.near` Flagship Orbital Carrier, parked above and left of the planet in the orbit menu.
 * One model, built on demand: no patron means no model, no draw call and no label.
 */
export class FlagshipCarrier {
  private model: FittedModel | null = null;
  private name = '';

  constructor(private readonly scene: THREE.Scene) {}

  get active(): boolean { return this.model !== null; }

  /** Show the flagship for `patron`, or remove it with `null`. A new name on a shown flagship just renames it. */
  setLeadPatron(patron: OrbitalLeadPatron | null): void {
    const name = patron?.carrierName.trim() ?? '';
    if (!patron || name === '') {
      this.remove();
      return;
    }
    this.name = name;
    if (this.model) return;
    this.model = acquireModel(FLAGSHIP_CARRIER_ID, 'dune', { size: FLAGSHIP_SIZE, mode: 'max', force: true }, { spaceLit: true });
    this.model.root.rotation.order = 'YXZ';
    this.model.root.visible = false;
    this.scene.add(this.model.root);
  }

  /** Per frame. `show` is false during DEPLOY and the camera dive, when the ships and planet are on another path. */
  update(time: number, planetPos: THREE.Vector3, show: boolean): void {
    const m = this.model;
    if (!m) return;
    m.root.visible = show;
    if (!show) return;
    m.root.position.set(planetPos.x - 9.5 + Math.sin(time * 0.06) * 0.5, 9.4 + Math.sin(time * 0.13 + 1.1) * 0.25, -8);
    m.root.rotation.set(0.05, 0.62 + Math.sin(time * 0.05) * 0.08, -0.04 + Math.sin(time * 0.09) * 0.02);
    tickArchetypeMesh(m.mesh, time);
  }

  /** Screen anchor of the hull top, for the name label. Null when there is no patron. */
  project(camera: THREE.Camera): ProjectedFlagship | null {
    const m = this.model;
    if (!m) return null;
    _v.copy(m.root.position);
    _v.y += m.size.y;
    _v.project(camera);
    return {
      name: this.name,
      nx: (_v.x + 1) / 2,
      ny: (1 - _v.y) / 2,
      visible: m.root.visible && _v.z > -1 && _v.z < 1,
    };
  }

  private remove(): void {
    if (!this.model) return;
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.model = null;
    this.name = '';
  }

  dispose(): void { this.remove(); }
}
