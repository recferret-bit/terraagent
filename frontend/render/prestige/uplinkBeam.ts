import * as THREE from 'three';
import { isArchetypeRuin } from '../kitbash/catalog';
import { buildUplinkFragment, UPLINK_DISC_FRAG, UPLINK_DISC_VERT, UPLINK_VERT } from './uplinkBeamGlsl';

/** Beam column height (m): well above the diorama camera frustum so it reads as reaching orbit. */
export const UPLINK_LENGTH = 46;
const OUTER_RADIUS = 0.34;
const CORE_RADIUS = 0.11;
const CYAN = new THREE.Color(0.0, 1.5, 2.3);

export interface UplinkBeam {
  readonly group: THREE.Group;
  /** Force the beam on or off regardless of the host's build stage and ruin state (tests, previews). */
  setForced(on: boolean | null): void;
  dispose(): void;
}

/** Visible once the host is fully built (`buildStage` 1, or unset) and not a ruin. */
export function uplinkShouldShow(host: THREE.Object3D | null): boolean {
  if (!host) return true;
  const stage = (host.userData as { buildStage?: unknown }).buildStage;
  return (typeof stage === 'number' ? stage >= 1 : true) && !isArchetypeRuin(host);
}

/**
 * Emissive vertical beam in the render engine (additive HDR shells, following the `Flames.ts` pattern): an outer
 * sheath, a hot inner core and an emitter disc. A separate object, not a kitbash part, so it does not enter the model's
 * bounds, triangle budget or validator. Local origin = the emitter lens; the caller positions the group.
 */
export function createUplinkBeam(): UplinkBeam {
  const group = new THREE.Group();
  group.name = 'prestige:uplinkBeam';
  const u = { uTime: { value: 0 }, uOn: { value: 1 }, uPower: { value: 1 }, uColor: { value: CYAN }, uLen: { value: UPLINK_LENGTH } };
  let forced: boolean | null = null;
  const frag = buildUplinkFragment();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.ShaderMaterial[] = [];

  const sync = () => {
    u.uTime.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    u.uOn.value = (forced ?? uplinkShouldShow(group.parent)) ? 1 : 0;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, order: number) => {
    geos.push(geo); mats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = order; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.onBeforeRender = sync;
    group.add(mesh);
  };
  const column = (r: number) => new THREE.CylinderGeometry(r, r * 1.25, UPLINK_LENGTH, 20, 1, true).translate(0, UPLINK_LENGTH / 2, 0);
  const mk = (core: number, power: number) => new THREE.ShaderMaterial({
    uniforms: { ...u, uCore: { value: core }, uPower: { value: power } },
    vertexShader: UPLINK_VERT, fragmentShader: frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  add(column(OUTER_RADIUS), mk(0, 1.1), 30);
  add(column(CORE_RADIUS), mk(1, 1.6), 31);

  const disc = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
  add(disc, new THREE.ShaderMaterial({
    uniforms: u, vertexShader: UPLINK_DISC_VERT, fragmentShader: UPLINK_DISC_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  }), 29);

  return {
    group,
    setForced(on) { forced = on; sync(); },
    dispose() { group.removeFromParent(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}
