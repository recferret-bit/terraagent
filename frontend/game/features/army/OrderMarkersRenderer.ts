import * as THREE from 'three';
import type { GameView, RendererInstance } from '../../core/registry/types';
import type { Scene3dService } from '../shared/scene3d';

export type OrderMarkerKind = 'move' | 'attackMove' | 'attackTarget';

export const ORDER_MARKER_TTL_MS = 1200;

export interface OrderMarker {
  id: number;
  kind: OrderMarkerKind;
  q: number;
  r: number;
  targetId?: number;
  createdAtMs: number;
  ttlMs: number;
}

const MARKER_COLORS: Readonly<Record<OrderMarkerKind, number>> = {
  move: 0x39d0ff,
  attackMove: 0xff6a13,
  attackTarget: 0xff3b3b,
};

export function syncDomOrderMarkers(container: HTMLElement | null | undefined, markers: readonly OrderMarker[]): void {
  if (!container || typeof document === 'undefined') return;
  const nodes: HTMLElement[] = [];
  for (const m of markers) {
    const el = document.createElement('div');
    el.className = `ta-order-marker ta-order-marker--${m.kind}`;
    el.setAttribute('data-order-marker', m.kind);
    el.setAttribute('data-kind', m.kind);
    el.setAttribute('data-q', String(m.q));
    el.setAttribute('data-r', String(m.r));
    el.setAttribute('data-marker-id', String(m.id));
    if (m.targetId !== undefined) {
      el.setAttribute('data-target-id', String(m.targetId));
    }
    nodes.push(el);
  }
  container.replaceChildren(...nodes);
}

export interface OrderMarkersRendererOptions {
  scene3d?: Scene3dService | null;
  getMarkers(): readonly OrderMarker[];
  pruneExpired?(nowMs?: number): void;
  domContainer?: HTMLElement | null;
  now?: () => number;
}

interface MarkerMeshPair {
  root: THREE.Group;
  ring: THREE.Mesh;
  beacon: THREE.Mesh;
  kind: OrderMarkerKind;
}

export class OrderMarkersRenderer implements RendererInstance {
  readonly group = new THREE.Group();
  private readonly ringGeo = new THREE.RingGeometry(0.32, 0.54, 24);
  private readonly beaconGeo = new THREE.CylinderGeometry(0.06, 0.16, 0.42, 6);
  private readonly materials: Record<OrderMarkerKind, THREE.MeshBasicMaterial>;
  private readonly meshById = new Map<number, MarkerMeshPair>();
  private readonly now: () => number;

  constructor(private readonly opts: OrderMarkersRendererOptions) {
    this.group.name = 'army-order-markers';
    this.ringGeo.rotateX(-Math.PI / 2);
    this.now = opts.now ?? (() => Date.now());
    this.materials = {
      move: new THREE.MeshBasicMaterial({ color: MARKER_COLORS.move, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      attackMove: new THREE.MeshBasicMaterial({ color: MARKER_COLORS.attackMove, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
      attackTarget: new THREE.MeshBasicMaterial({ color: MARKER_COLORS.attackTarget, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    };
    if (opts.scene3d?.scene) {
      opts.scene3d.scene.add(this.group);
    }
    this.sync();
  }

  private getOrCreateMesh(m: OrderMarker): MarkerMeshPair {
    const existing = this.meshById.get(m.id);
    if (existing) return existing;
    const mat = this.materials[m.kind];
    const root = new THREE.Group();
    root.name = `order-marker-${m.id}`;
    root.userData = { markerId: m.id, kind: m.kind, q: m.q, r: m.r, targetId: m.targetId };
    const ring = new THREE.Mesh(this.ringGeo, mat);
    const beacon = new THREE.Mesh(this.beaconGeo, mat);
    beacon.position.y = 0.24;
    root.add(ring, beacon);
    this.group.add(root);
    const pair: MarkerMeshPair = { root, ring, beacon, kind: m.kind };
    this.meshById.set(m.id, pair);
    return pair;
  }

  sync(nowMs = this.now()): void {
    this.opts.pruneExpired?.(nowMs);
    const markers = this.opts.getMarkers();
    if (this.opts.domContainer) {
      syncDomOrderMarkers(this.opts.domContainer, markers);
    }
    if (!this.opts.scene3d) return;

    const activeIds = new Set<number>();
    for (const m of markers) {
      activeIds.add(m.id);
      const pair = this.getOrCreateMesh(m);
      const s3d = this.opts.scene3d as Scene3dService & { hexToWorld?: (q: number, r: number) => { x: number; y?: number; z: number } };
      const world = typeof s3d.tileToWorld === 'function' ? s3d.tileToWorld(m.q, m.r) : { x: m.q, y: 0, z: m.r, ...(s3d.hexToWorld?.(m.q, m.r) ?? {}) };
      pair.root.position.set(world.x, (world.y ?? 0) + 0.08, world.z);
      const ageRatio = Math.max(0, Math.min(1, (nowMs - m.createdAtMs) / Math.max(1, m.ttlMs)));
      const pulse = 1 + 0.25 * Math.sin(ageRatio * Math.PI);
      pair.ring.scale.setScalar(pulse);
      pair.beacon.position.y = 0.24 + 0.12 * (1 - ageRatio);
    }

    for (const [id, pair] of this.meshById.entries()) {
      if (!activeIds.has(id)) {
        this.group.remove(pair.root);
        this.meshById.delete(id);
      }
    }
  }

  update(_view: GameView, _dt: number): void {
    this.sync();
  }

  dispose(): void {
    for (const pair of this.meshById.values()) {
      this.group.remove(pair.root);
    }
    this.meshById.clear();
    if (this.opts.scene3d?.scene) {
      this.opts.scene3d.scene.remove(this.group);
    }
    this.ringGeo.dispose();
    this.beaconGeo.dispose();
    this.materials.move.dispose();
    this.materials.attackMove.dispose();
    this.materials.attackTarget.dispose();
  }
}
