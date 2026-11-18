import * as THREE from 'three';
import type { PlanetGlobe } from '../../planets/PlanetGlobe';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame, ProjectedAnchor2D } from '../types';
import { R } from './StageGlobes';
import { buildSphericalHexFillGeo, buildSphericalHexLoopGeo } from './sectorHexGeo';

const UP = new THREE.Vector3(0, 1, 0);
const COLOR_CYAN = new THREE.Color(0x39d0ff).multiplyScalar(1.3);
const COLOR_BLUE = new THREE.Color(0x5b8cff).multiplyScalar(1.15);
const COLOR_ORANGE = new THREE.Color(0xff6a13).multiplyScalar(1.65);

interface OpacityHandle {
  readonly setAlpha: (k: number) => void;
}

interface MarkerRecord {
  readonly input: OrbitalGlobeMarkerInput;
  readonly root: THREE.Group;
  readonly surfaceCenterLocal: THREE.Vector3;
  readonly normalLocal: THREE.Vector3;
  readonly tipLocal: THREE.Vector3;
  readonly pulseLoop: THREE.LineLoop | null;
  readonly opacityHandles: readonly OpacityHandle[];
  facing: number;
}

function buildRingLineGeo(radius: number, segments: number, dashed = false): THREE.BufferGeometry {
  const pts: number[] = [];
  const step = (Math.PI * 2) / segments;
  for (let i = 0; i < segments; i++) {
    if (dashed && i % 2 === 1) continue;
    const a0 = i * step;
    const a1 = (i + 1) * step;
    pts.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
    pts.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

function markerKey(markers: readonly OrbitalGlobeMarkerInput[]): string {
  return markers
    .map((m) => `${m.id}:${m.yaw.toFixed(3)}:${m.pitch.toFixed(3)}:${m.role}:${m.players ?? 0}:${m.bots ?? 0}:${m.isHomeBase ? 1 : 0}`)
    .join('|');
}

function sphericalNormal(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
}

function makeLineMat(color: THREE.Color, opacity: number, disposables: Array<{ dispose(): void }>): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(mat);
  return mat;
}

function makeMeshMat(color: THREE.Color, opacity: number, disposables: Array<{ dispose(): void }>): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  disposables.push(mat);
  return mat;
}

/**
 * 3D Ship Enchanted-Reality hologram overlay around the orbital planet globe:
 * renders strictly hexagonal surface sectors (no square grid) locked 1:1 to `globe.spin.rotation.y`
 * so the illuminated landing side smoothly faces the player while staying glued to terrain.
 */
export class GlobeHighlights {
  readonly group = new THREE.Group();
  private readonly surfaceSyncGroup = new THREE.Group();
  private readonly markersGroup = new THREE.Group();
  private readonly scanRing: THREE.LineSegments;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly markerDisposables: Array<{ dispose(): void }> = [];
  private readonly sharedOuterLoopGeo: THREE.BufferGeometry;
  private readonly sharedInnerLoopGeo: THREE.BufferGeometry;
  private readonly sharedFillGeo: THREE.BufferGeometry;
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private records: MarkerRecord[] = [];
  private lastKey = '';

  constructor(scene: THREE.Scene, private readonly radius = R) {
    this.group.name = 'OrbitalGlobeHighlights';
    const surfR = radius * 1.006;
    this.sharedOuterLoopGeo = buildSphericalHexLoopGeo(surfR, 0.106, 5);
    this.sharedInnerLoopGeo = buildSphericalHexLoopGeo(surfR, 0.080, 4);
    this.sharedFillGeo = buildSphericalHexFillGeo(surfR * 0.999, 0.103, 5);

    const scanGeo = buildRingLineGeo(radius * 1.125, 72, true);
    const scanMat = makeLineMat(COLOR_CYAN, 0.28, this.disposables);
    this.scanRing = new THREE.LineSegments(scanGeo, scanMat);
    this.scanRing.rotation.set(0.22, 0, 0);

    this.disposables.push(
      this.sharedOuterLoopGeo,
      this.sharedInnerLoopGeo,
      this.sharedFillGeo,
      scanGeo,
    );
    this.surfaceSyncGroup.add(this.markersGroup);
    this.group.add(this.scanRing, this.surfaceSyncGroup);
    scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  private clearMarkers(): void {
    this.markersGroup.clear();
    this.records = [];
    for (const d of this.markerDisposables) d.dispose();
    this.markerDisposables.length = 0;
  }

  setHighlights(markers: readonly OrbitalGlobeMarkerInput[]): void {
    const key = markerKey(markers);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.clearMarkers();

    for (const input of markers) {
      this.records.push(this.buildMarkerRecord(input));
    }
  }

  private buildMarkerRecord(input: OrbitalGlobeMarkerInput): MarkerRecord {
    const normal = sphericalNormal(input.yaw, input.pitch, new THREE.Vector3());
    const east = new THREE.Vector3(Math.cos(input.yaw), 0, -Math.sin(input.yaw)).normalize();
    const south = new THREE.Vector3().crossVectors(east, normal).normalize();
    const basis = new THREE.Matrix4().makeBasis(east, normal, south);
    const patchGroup = new THREE.Group();
    patchGroup.quaternion.setFromRotationMatrix(basis);

    const tipGroup = new THREE.Group();
    tipGroup.position.copy(normal).multiplyScalar(this.radius * 1.008);
    tipGroup.quaternion.copy(patchGroup.quaternion);

    const isTarget = input.role === 'target';
    const isHome = Boolean(input.isHomeBase);
    const hasPlayers = (input.players ?? 0) > 0 || input.role === 'player';
    const hasBots = (input.bots ?? 0) > 0 || input.role === 'bot';
    const primaryColor = isHome ? COLOR_ORANGE : isTarget ? COLOR_CYAN : COLOR_BLUE;

    const handles: OpacityHandle[] = [];
    const bind = <T extends { opacity: number }>(mat: T, base: number): T => {
      handles.push({ setAlpha: (k) => { mat.opacity = base * k; } });
      return mat;
    };

    const outerBaseAlpha = isHome ? 0.95 : isTarget ? 0.96 : (hasPlayers || hasBots ? 0.58 : 0.36);
    const outerMat = bind(makeLineMat(primaryColor, outerBaseAlpha, this.markerDisposables), outerBaseAlpha);
    const outerLoop = new THREE.LineLoop(this.sharedOuterLoopGeo, outerMat);
    outerLoop.renderOrder = 6;
    patchGroup.add(outerLoop);

    let pulseLoop: THREE.LineLoop | null = null;
    if (isHome) {
      const homeFillAlpha = isTarget ? 0.14 : 0.16;
      const homeFillMat = bind(makeMeshMat(COLOR_ORANGE, homeFillAlpha, this.markerDisposables), homeFillAlpha);
      const homeFill = new THREE.Mesh(this.sharedFillGeo, homeFillMat);
      homeFill.renderOrder = 5;
      patchGroup.add(homeFill);
    }
    if (isTarget) {
      if (!isHome) {
        const fillMat = bind(makeMeshMat(COLOR_CYAN, 0.18, this.markerDisposables), 0.18);
        const fill = new THREE.Mesh(this.sharedFillGeo, fillMat);
        fill.renderOrder = 5;
        patchGroup.add(fill);
      }
      const innerMat = bind(makeLineMat(COLOR_CYAN, 0.78, this.markerDisposables), 0.78);
      pulseLoop = new THREE.LineLoop(this.sharedInnerLoopGeo, innerMat);
      pulseLoop.renderOrder = 6;
      patchGroup.add(pulseLoop);
    }

    const holder = new THREE.Group();
    holder.add(patchGroup, tipGroup);
    this.markersGroup.add(holder);
    return {
      input,
      root: tipGroup,
      surfaceCenterLocal: normal.clone().multiplyScalar(this.radius * 1.008),
      normalLocal: normal,
      tipLocal: new THREE.Vector3(0, 0.06, 0),
      pulseLoop,
      opacityHandles: handles,
      facing: 1,
    };
  }

  update(
    globe: PlanetGlobe,
    planetPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    _dt: number,
    time: number,
  ): void {
    this.group.position.copy(planetPos);
    this.surfaceSyncGroup.rotation.set(0, globe.spin.rotation.y, 0);
    this.surfaceSyncGroup.scale.copy(globe.group.scale);
    this.scanRing.rotation.set(0.22, globe.spin.rotation.y * 1.15, globe.spec.orbital.axialTilt * 0.45);
    this.surfaceSyncGroup.updateMatrixWorld(true);

    const pulseScale = 1 + Math.sin(time * 3.4) * 0.035;

    this.surfaceSyncGroup.getWorldQuaternion(this.scratchQuat);
    for (const rec of this.records) {
      const worldNorm = this.scratchA.copy(rec.normalLocal).applyQuaternion(this.scratchQuat);
      const surfWorld = this.scratchB.copy(planetPos).addScaledVector(worldNorm, this.radius);
      const toCam = this.scratchC.copy(camera.position).sub(surfWorld).normalize();
      const facing = worldNorm.dot(toCam);
      rec.facing = facing;

      const limbFade = THREE.MathUtils.smoothstep(facing, 0.06, 0.28);
      rec.root.parent!.visible = limbFade > 0.02;
      for (const h of rec.opacityHandles) h.setAlpha(limbFade);

      if (rec.pulseLoop) rec.pulseLoop.scale.setScalar(pulseScale);
    }
  }

  project(
    camera: THREE.PerspectiveCamera,
    planetPos: THREE.Vector3,
    time = 0,
    pointer?: THREE.Vector2,
  ): OrbitalProjectedFrame {
    this.group.updateMatrixWorld(true);
    const v = this.scratchA;
    v.copy(planetPos).project(camera);
    const globeNx = (v.x + 1) * 0.5;
    const globeNy = (1 - v.y) * 0.5;

    const top = this.scratchB.copy(planetPos).addScaledVector(UP, this.radius).project(camera);
    const globeRadiusNormY = Math.max(0.05, Math.abs((1 - top.y) * 0.5 - globeNy));

    const anchors: ProjectedAnchor2D[] = [];
    const pushLimb = (id: 'scanLimb' | 'presenceLimb', worldPos: THREE.Vector3) => {
      v.copy(worldPos).project(camera);
      anchors.push({ id, role: id, nx: (v.x + 1) * 0.5, ny: (1 - v.y) * 0.5, visible: v.z >= -1 && v.z <= 1 });
    };

    const scanPos = this.scratchB.set(planetPos.x - this.radius * 0.76, planetPos.y + this.radius * 0.44, planetPos.z + this.radius * 0.48);
    pushLimb('scanLimb', scanPos);

    const presPos = this.scratchB.set(planetPos.x + this.radius * 0.10, planetPos.y + this.radius * 0.50, planetPos.z + this.radius * 0.85);
    pushLimb('presenceLimb', presPos);

    for (const rec of this.records) {
      this.scratchB.copy(rec.tipLocal);
      rec.root.localToWorld(this.scratchB);
      v.copy(this.scratchB).project(camera);
      const nx = (v.x + 1) * 0.5;
      const ny = (1 - v.y) * 0.5;
      const tipVis = rec.facing > 0.12 && v.z >= -1 && v.z <= 1;

      this.scratchC.copy(rec.surfaceCenterLocal);
      this.surfaceSyncGroup.localToWorld(this.scratchC);
      v.copy(this.scratchC).project(camera);
      const centerNx = (v.x + 1) * 0.5;
      const centerNy = (1 - v.y) * 0.5;

      anchors.push({
        id: rec.input.id,
        role: rec.input.role,
        nx,
        ny,
        centerNx,
        centerNy,
        visible: tipVis && v.z >= -1 && v.z <= 1,
        players: rec.input.players ?? 0,
        bots: rec.input.bots ?? 0,
        isHomeBase: Boolean(rec.input.isHomeBase),
      });
    }

    return {
      globeNx,
      globeNy,
      globeRadiusNormY,
      anchors,
      time,
      ...(pointer ? { pointerX: pointer.x, pointerY: pointer.y } : {}),
    };
  }

  dispose(): void {
    this.clearMarkers();
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
