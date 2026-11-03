import * as THREE from 'three';
import { createArchetypeMesh, stripBuildingPlinth } from '@terra/render/kitbash';
import { TILE_M } from '@terra/render/planets/hex';
import type { FeatureContext, RendererInstance } from '../../core/registry/types';
import type { Scene3dService } from '../shared/scene3d';
import type { PlacementGhostState } from './PlacementGhost';

/** While the pointer rests on the canvas, re-pick at most this often (the camera may pan under it). */
export const GHOST_IDLE_PICK_MS = 150;

const VALID = 0x39ff88;
const INVALID = 0xff3b3b;
const HEX_R = TILE_M / Math.sqrt(3);

const ARCHETYPE_BY_BUILDING: Record<string, string> = {
  commandHub: 'building.commandHub',
  metalsExtractor: 'building.mine',
  solar: 'building.solar',
  pylon: 'building.pylon',
  powerLine: 'building.pylon',
  capacitor: 'building.capacitor',
  wind: 'building.wind',
  thermal: 'building.coalGen',
  supplyDepot: 'building.depot',
  mineralsQuarry: 'building.quarry',
  waterExtractor: 'building.waterPump',
  petroleumWell: 'building.oilWell',
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const hexGeo = (): THREE.BufferGeometry => {
  const g = new THREE.CircleGeometry(HEX_R * 0.96, 6);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 6);
  return g;
};

/** Translucent 3D footprint hexes + building mesh for the W02 construction placement ghost. */
export class ConstructionGhostRig3D {
  readonly group = new THREE.Group();
  private readonly geo = hexGeo();
  private readonly tiles: THREE.Mesh[] = [];
  private readonly mats = { ok: this.mat(VALID, 0.38), bad: this.mat(INVALID, 0.42) };
  private readonly bodyMats = { ok: this.mat(VALID, 0.45), bad: this.mat(INVALID, 0.5) };
  private body: THREE.Object3D | null = null;
  private bodyBuilding = '';
  private bodyBiome = '';
  private bodyTint: boolean | null = null;
  private pulse = 0;

  constructor(private readonly s3: Scene3dService) {
    this.group.name = 'construction-ghost-3d';
    this.group.visible = false;
    s3.scene.add(this.group);
  }

  private mat(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  }

  private clearBody(): void {
    if (!this.body) return;
    const ghostMats = new Set<THREE.Material>([this.bodyMats.ok, this.bodyMats.bad]);
    const toDispose = new Set<THREE.Material>();
    // the body's geometry is its own (`createArchetypeMesh` clones the cache; `stripBuildingPlinth` builds a new one)
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      if (mesh.customDepthMaterial) toDispose.add(mesh.customDepthMaterial);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (m && !ghostMats.has(m)) toDispose.add(m);
      }
    });
    for (const m of toDispose) m.dispose();
    this.group.remove(this.body);
    this.body = null;
    this.bodyTint = null;
  }

  private ensureBody(building: string): void {
    const biome = this.s3.biomeKey();
    if (this.body && this.bodyBuilding === building && this.bodyBiome === biome) return;
    this.clearBody();
    this.bodyBuilding = building;
    this.bodyBiome = biome;
    const archetypeId = ARCHETYPE_BY_BUILDING[building] ?? 'building.commandHub';
    try {
      this.body = createArchetypeMesh(archetypeId, biome);
      stripBuildingPlinth(this.body);
      const projRig = this.body.getObjectByName('entity-projector-rig');
      if (projRig) this.body.remove(projRig);
      // the ghost shows no lamps: free the rig's materials too (it is not under the body any more)
      (this.body.userData as { projectorRig?: { dispose?: () => void } }).projectorRig?.dispose?.();
      delete (this.body.userData as { projectorRig?: unknown }).projectorRig;
      this.body.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      this.group.add(this.body);
    } catch {
      this.body = null;
    }
  }

  private tint(valid: boolean): void {
    if (!this.body || this.bodyTint === valid) return;
    const m = valid ? this.bodyMats.ok : this.bodyMats.bad;
    const ghostMats = new Set<THREE.Material>([this.bodyMats.ok, this.bodyMats.bad]);
    const replaced = new Set<THREE.Material>();
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const old of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (old && !ghostMats.has(old)) replaced.add(old);
      }
      mesh.material = m;
    });
    for (const old of replaced) old.dispose();
    this.bodyTint = valid;
  }

  update(state: PlacementGhostState | null, dt: number): void {
    const on = state !== null;
    this.group.visible = on;
    if (!state) return;
    this.pulse += dt;
    const k = 0.85 + 0.15 * Math.sin(this.pulse * 5);
    while (this.tiles.length < state.tiles.length) {
      const m = new THREE.Mesh(this.geo, this.mats.ok);
      m.renderOrder = 5;
      this.tiles.push(m);
      this.group.add(m);
    }
    let sumX = 0;
    let sumZ = 0;
    let maxY = -Infinity;
    let count = 0;
    this.tiles.forEach((m, i) => {
      const t = state.tiles[i];
      m.visible = Boolean(t);
      if (!t) return;
      const p = this.s3.tileToWorld(t.q, t.r);
      m.position.set(p.x, p.y + 0.12, p.z);
      m.material = state.valid ? this.mats.ok : this.mats.bad;
      sumX += p.x;
      sumZ += p.z;
      if (p.y > maxY) maxY = p.y;
      count++;
    });
    this.mats.ok.opacity = 0.3 + 0.1 * k;
    this.mats.bad.opacity = 0.34 + 0.1 * k;
    this.ensureBody(state.building);
    if (this.body) {
      if (count > 0) {
        this.body.position.set(sumX / count, maxY, sumZ / count);
      } else {
        const c = this.s3.tileToWorld(state.q, state.r);
        this.body.position.set(c.x, c.y, c.z);
      }
      this.body.rotation.y = (state.rotation * Math.PI) / 3;
      this.tint(state.valid);
    }
  }

  dispose(): void {
    this.clearBody();
    this.s3.scene.remove(this.group);
    this.geo.dispose();
    for (const m of [...Object.values(this.mats), ...Object.values(this.bodyMats)]) m.dispose();
  }
}

export function createConstructionGhostRenderer(ctx: FeatureContext): RendererInstance {
  const s3 = ctx.services.scene3d;
  if (!s3) return { update() {}, dispose() {} };
  const rig = new ConstructionGhostRig3D(s3);
  const canvas = (ctx.services.surface ?? ctx.services.canvas) as HTMLElement | null | undefined;
  let pointer: { x: number; y: number } | null = null;
  let moved = false;
  let lastPickAt = -Infinity;
  let lastTile = '';
  let wasActive = false;

  const onMove = (e: PointerEvent) => {
    pointer = !canvas || e.target === canvas ? { x: e.clientX, y: e.clientY } : null;
    moved = true;
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pointermove', onMove);
  }

  const getGhostState = (): PlacementGhostState | null =>
    ctx.services.getPlacementGhostState?.() ?? ctx.services.getGhostState?.() ?? null;

  const hoverUnderPointer = () => {
    const t = now();
    if (!pointer || !ctx.services.pickTile || (!moved && t - lastPickAt < GHOST_IDLE_PICK_MS)) return;
    moved = false;
    lastPickAt = t;
    const tile = ctx.services.pickTile(pointer.x, pointer.y, canvas);
    const key = tile ? `${tile.q},${tile.r}` : '';
    if (tile && key !== lastTile) {
      lastTile = key;
      (ctx.services.setPlacementHoverTile ?? ctx.services.setHoverTile)?.(tile.q, tile.r);
    }
  };

  return {
    update(_view, dt) {
      const state = getGhostState();
      if (state) {
        if (!wasActive) {
          wasActive = true;
          lastTile = `${state.q},${state.r}`;
        }
        hoverUnderPointer();
      } else {
        wasActive = false;
        lastTile = '';
      }
      rig.update(getGhostState(), dt);
    },
    dispose() {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('pointermove', onMove);
      }
      rig.dispose();
    },
  };
}
