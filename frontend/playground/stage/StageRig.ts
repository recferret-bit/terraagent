import * as THREE from 'three';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { PEDESTAL_R, buildGrid } from './grid';
import { buildHuman, buildRuler } from './props';

/** Pedestal + calibration grid + ruler + human reference; rebuilt whenever the biome or grid style changes. */
export class StageRig {
  readonly group = new THREE.Group();
  grid = new THREE.Group();
  ruler = new THREE.Group();
  human = new THREE.Group();
  /** Pedestal top disc (target of the double-click refocus ray). */
  top!: THREE.Mesh;

  constructor(private getMinX: () => number) {}

  build(kind: PlanetKind, opts: { hex: boolean; grid: boolean; ruler: boolean; human: boolean }) {
    this.group.clear();
    const spec = PLANET_SPECS[kind];
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R + 0.25, 0.5, 64),
      new THREE.MeshStandardMaterial({ color: spec.palette.rockDark, roughness: 0.75, metalness: 0.2 }));
    slab.position.y = -0.5 - 0.002; slab.receiveShadow = true; slab.name = 'pedestal';
    const top = new THREE.Mesh(new THREE.CircleGeometry(PEDESTAL_R, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: spec.palette.groundLow, roughness: 0.85, metalness: 0.05 }));
    top.position.y = -0.002; top.receiveShadow = true; top.name = 'pedestal';
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL_R, 0.05, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1e5bff, emissive: 0x1e5bff, emissiveIntensity: 1.6 }));
    this.top = top;
    this.group.add(slab, top, rim);

    this.grid = buildGrid(opts.hex); this.group.add(this.grid);
    this.ruler = buildRuler(); this.ruler.visible = opts.ruler; this.group.add(this.ruler);
    this.human = buildHuman(); this.human.visible = opts.human; this.group.add(this.human);
    this.grid.visible = opts.grid;
    this.placeHuman();
  }

  /** The planet-surface view replaces the pedestal. */
  hidePedestal() { this.group.children.forEach((c) => { if (c.name === 'pedestal') c.visible = false; }); }

  placeHuman() { this.human.position.set(Math.max(-5, this.getMinX() - 1.2), 0, 0.6); }
}
