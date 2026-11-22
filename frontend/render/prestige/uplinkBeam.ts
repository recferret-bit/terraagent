import * as THREE from 'three';
import { isArchetypeRuin } from '../kitbash/catalog';
import {
  buildUplinkFragment,
  UPLINK_DISC_FRAG,
  UPLINK_DISC_VERT,
  UPLINK_HALO_FRAG,
  UPLINK_HALO_VERT,
  UPLINK_VERT,
} from './uplinkBeamGlsl';

/** Beam column height (m): well above the diorama camera frustum so it reads as reaching orbit. */
export const UPLINK_LENGTH = 46;
const OUTER_RADIUS = 0.28;
const CORE_RADIUS = 0.095;
const GOLD_OUTER_RADIUS = 0.29;
const GOLD_MID_RADIUS = 0.145;
const GOLD_CORE_RADIUS = 0.075;
const CYAN = new THREE.Color(0.0, 1.32, 2.1);
const GOLD_OUTER = new THREE.Color(1.65, 0.78, 0.04);
const GOLD_HALO = new THREE.Color(1.92, 1.05, 0.08);

export type UplinkBeamStyle = 'uplink' | 'gold';

export interface UplinkBeam {
  readonly group: THREE.Group;
  readonly style: UplinkBeamStyle;
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

interface PulseRing { mesh: THREE.Mesh; alphaU: { value: number }; phaseOffset: number; maxH: number; speed: number }
interface OrbitRing { mesh: THREE.Mesh; speed: number; tiltX: number; tiltZ: number }

interface BeamBuildCtx {
  group: THREE.Group;
  geos: THREE.BufferGeometry[];
  mats: THREE.ShaderMaterial[];
  pulseRings: PulseRing[];
  orbitRings: OrbitRing[];
  uTime: { value: number };
  uOn: { value: number };
  uLen: { value: number };
  frag: string;
  sync: (renderer?: THREE.WebGLRenderer) => void;
}

function addMesh(ctx: BeamBuildCtx, geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, order: number, name: string): THREE.Mesh {
  ctx.geos.push(geo); ctx.mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.frustumCulled = false; mesh.renderOrder = order; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.onBeforeRender = ctx.sync;
  ctx.group.add(mesh);
  return mesh;
}

const columnGeo = (r: number) => new THREE.CylinderGeometry(r, r * 1.25, UPLINK_LENGTH, 20, 1, true).translate(0, UPLINK_LENGTH / 2, 0);

function mkColumnMat(ctx: BeamBuildCtx, color: THREE.Color, core: number, power: number, gold: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: ctx.uTime, uOn: ctx.uOn, uLen: ctx.uLen,
      uColor: { value: color }, uCore: { value: core }, uPower: { value: power }, uGold: { value: gold },
    },
    vertexShader: UPLINK_VERT, fragmentShader: ctx.frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

function mkDiscMat(ctx: BeamBuildCtx, color: THREE.Color, power: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: ctx.uTime, uOn: ctx.uOn, uColor: { value: color }, uPower: { value: power } },
    vertexShader: UPLINK_DISC_VERT, fragmentShader: UPLINK_DISC_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

function mkHaloMat(ctx: BeamBuildCtx, color: THREE.Color, power: number, alpha = 1) {
  const alphaU = { value: alpha };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: ctx.uTime, uOn: ctx.uOn, uColor: { value: color }, uPower: { value: power }, uAlpha: alphaU },
    vertexShader: UPLINK_HALO_VERT, fragmentShader: UPLINK_HALO_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  return { mat, alphaU };
}

function addGoldBeamLayers(ctx: BeamBuildCtx): void {
  addMesh(ctx, columnGeo(GOLD_OUTER_RADIUS), mkColumnMat(ctx, GOLD_OUTER, 0, 0.56, 1.0), 30, 'sovereign-outer-sheath');
  addMesh(ctx, columnGeo(GOLD_MID_RADIUS), mkColumnMat(ctx, CYAN, 0.28, 0.44, 0.3), 31, 'sovereign-mid-sheath');
  addMesh(ctx, columnGeo(GOLD_CORE_RADIUS), mkColumnMat(ctx, GOLD_HALO, 1, 0.88, 1.0), 32, 'sovereign-core');
  addMesh(ctx, new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2).translate(0, 0.02, 0), mkDiscMat(ctx, GOLD_HALO, 0.52), 29, 'sovereign-emitter-disc');
  // Secondary lens flare right inside the Tier 3+ upper spire apex crown (Y = 7.15 - 4.34 = 2.81 local)
  addMesh(ctx, new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2).translate(0, 2.81, 0), mkDiscMat(ctx, CYAN, 0.46), 29, 'sovereign-apex-flare');

  const crownSpecs = [
    { y: 0.91, r: 1.26, tube: 0.036, speed: 0.85, tiltX: 0.24, tiltZ: 0.16, color: GOLD_HALO, power: 0.78 },
    { y: 1.96, r: 1.04, tube: 0.032, speed: -1.25, tiltX: -0.28, tiltZ: 0.2, color: CYAN, power: 0.76 },
    { y: 2.81, r: 0.86, tube: 0.030, speed: 1.65, tiltX: 0.22, tiltZ: -0.24, color: GOLD_HALO, power: 0.80 },
  ];
  for (let i = 0; i < crownSpecs.length; i++) {
    const s = crownSpecs[i]!;
    const geo = new THREE.TorusGeometry(s.r, s.tube, 6, 28).rotateX(Math.PI / 2);
    const { mat } = mkHaloMat(ctx, s.color, s.power, 0.9);
    const mesh = addMesh(ctx, geo, mat, 33, `sovereign-orbit-ring-${i}`);
    mesh.position.y = s.y;
    ctx.orbitRings.push({ mesh, speed: s.speed, tiltX: s.tiltX, tiltZ: s.tiltZ });
  }
}

function addPulseRings(ctx: BeamBuildCtx, isGold: boolean): void {
  const pulseGeo = new THREE.TorusGeometry(isGold ? 0.46 : 0.40, isGold ? 0.028 : 0.022, 6, 24).rotateX(Math.PI / 2);
  ctx.geos.push(pulseGeo);
  for (let i = 0; i < 3; i++) {
    const { mat, alphaU } = mkHaloMat(ctx, isGold ? (i === 1 ? CYAN : GOLD_HALO) : CYAN, isGold ? 0.78 : 0.82, 0.8);
    ctx.mats.push(mat);
    const mesh = new THREE.Mesh(pulseGeo, mat);
    mesh.name = `uplink-pulse-ring-${i}`;
    mesh.frustumCulled = false; mesh.renderOrder = 32; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.onBeforeRender = ctx.sync;
    ctx.group.add(mesh);
    ctx.pulseRings.push({ mesh, alphaU, phaseOffset: i / 3, maxH: isGold ? 9.5 : 7.5, speed: isGold ? 0.34 : 0.28 });
  }
}

function updateChildWorldMatrix(group: THREE.Group, child: THREE.Object3D): void {
  child.updateMatrix();
  if (group.parent) {
    child.matrixWorld.multiplyMatrices(group.matrixWorld, child.matrix);
  } else {
    group.updateMatrix();
    child.matrixWorld.multiplyMatrices(group.matrix, child.matrix);
  }
}

/**
 * Emissive vertical beam in the render engine (additive HDR shells, following the `Flames.ts` pattern):
 * - `'uplink'` (Tier 1-2): cyan plasma sheath, white-cyan core, emitter disc and 3 ascending cyan telemetry pulse rings.
 * - `'gold'` (Tier 3+): sovereign amber-gold helical aura sheath, cyan-gold inner core, dual emitter + spire-apex flare
 *   discs, 3 counter-rotating tilted holographic astrolabe crown rings and 3 ascending golden pulse rings.
 * A separate object, not a kitbash part, so it does not enter the model's bounds, triangle budget or validator.
 */
export function createUplinkBeam(style: UplinkBeamStyle = 'uplink'): UplinkBeam {
  const isGold = style === 'gold';
  const group = new THREE.Group();
  group.name = isGold ? 'prestige:uplinkBeam:gold' : 'prestige:uplinkBeam';
  const uTime = { value: 0 }, uOn = { value: 1 }, uLen = { value: UPLINK_LENGTH };
  let forced: boolean | null = null;
  let lastFrame = -1;
  const geos: THREE.BufferGeometry[] = [], mats: THREE.ShaderMaterial[] = [];
  const pulseRings: PulseRing[] = [], orbitRings: OrbitRing[] = [];

  const sync = (renderer?: THREE.WebGLRenderer) => {
    const frame = renderer?.info?.render?.frame;
    if (typeof frame === 'number') {
      if (frame === lastFrame) return;
      lastFrame = frame;
    }
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    uTime.value = t;
    const on = forced ?? uplinkShouldShow(group.parent);
    uOn.value = on ? 1 : 0;
    if (!on) return;
    for (const pr of pulseRings) {
      const p = ((t * pr.speed + pr.phaseOffset) % 1 + 1) % 1;
      pr.mesh.position.y = 0.35 + p * pr.maxH;
      const sc = 0.85 + p * 0.65;
      pr.mesh.scale.set(sc, 1, sc);
      pr.alphaU.value = Math.sin(p * Math.PI) * (1 - p * 0.35);
      updateChildWorldMatrix(group, pr.mesh);
    }
    for (const or of orbitRings) {
      or.mesh.rotation.set(or.tiltX * Math.cos(t * 0.7), t * or.speed, or.tiltZ * Math.sin(t * 0.7));
      updateChildWorldMatrix(group, or.mesh);
    }
  };

  const ctx: BeamBuildCtx = { group, geos, mats, pulseRings, orbitRings, uTime, uOn, uLen, frag: buildUplinkFragment(), sync };
  if (isGold) {
    addGoldBeamLayers(ctx);
  } else {
    addMesh(ctx, columnGeo(OUTER_RADIUS), mkColumnMat(ctx, CYAN, 0, 0.82, 0.0), 30, 'uplink-outer-sheath');
    addMesh(ctx, columnGeo(CORE_RADIUS), mkColumnMat(ctx, CYAN, 1, 1.18, 0.0), 31, 'uplink-core');
    addMesh(ctx, new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2).translate(0, 0.02, 0), mkDiscMat(ctx, CYAN, 0.72), 29, 'uplink-emitter-disc');
  }
  addPulseRings(ctx, isGold);
  sync();

  return {
    group,
    style,
    setForced(on) { forced = on; lastFrame = -1; sync(); },
    dispose() { group.removeFromParent(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}
