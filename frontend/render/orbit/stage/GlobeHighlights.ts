import * as THREE from 'three';
import type { PlanetGlobe } from '../../planets/PlanetGlobe';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame, ProjectedAnchor2D } from '../types';
import { R } from './StageGlobes';
import { buildSphericalGridGeo, buildSphericalHexFillGeo, buildSphericalHexLoopGeo } from './sectorHexGeo';

const UP = new THREE.Vector3(0, 1, 0);
const COLOR_CYAN = new THREE.Color(0x39d0ff).multiplyScalar(1.3);
const COLOR_BLUE = new THREE.Color(0x5b8cff).multiplyScalar(1.15);
const COLOR_ORANGE = new THREE.Color(0xff6a13).multiplyScalar(1.65);
const COLOR_AMBER = new THREE.Color(0xffb048).multiplyScalar(1.35);

interface OpacityHandle {
  readonly setAlpha: (k: number) => void;
}

interface MarkerRecord {
  readonly input: OrbitalGlobeMarkerInput;
  readonly root: THREE.Group;
  readonly normalLocal: THREE.Vector3;
  readonly tipLocal: THREE.Vector3;
  readonly pulseLoop: THREE.LineLoop | null;
  readonly dropRing: THREE.LineLoop | null;
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
    .map((m) => `${m.id}:${m.yaw.toFixed(3)}:${m.pitch.toFixed(3)}:${m.role}:${m.players ?? 0}:${m.bots ?? 0}`)
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
 * locks 1:1 to `globe.spin.rotation.y` so curved spherical sector outlines, insertion vectors,
 * and player/bot nodes stay glued to the planet's crust while fading cleanly at the limb.
 */
export class GlobeHighlights {
  readonly group = new THREE.Group();
  private readonly surfaceSyncGroup = new THREE.Group();
  private readonly markersGroup = new THREE.Group();
  private readonly scanRing: THREE.LineSegments;
  private readonly gridMat: THREE.LineBasicMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly markerDisposables: Array<{ dispose(): void }> = [];
  private readonly sharedOuterLoopGeo: THREE.BufferGeometry;
  private readonly sharedInnerLoopGeo: THREE.BufferGeometry;
  private readonly sharedFillGeo: THREE.BufferGeometry;
  private readonly sharedSpikeGeo: THREE.BufferGeometry;
  private readonly sharedVectorLineGeo: THREE.BufferGeometry;
  private readonly sharedDropRingGeo: THREE.BufferGeometry;
  private readonly sharedPipGeo: THREE.BufferGeometry;
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchC = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private records: MarkerRecord[] = [];
  private lastKey = '';
  private lastPlanetKind: string | null = null;
  private anchorSpinY = 0;
  private reacquirePhase: 'idle' | 'out' | 'in' = 'idle';
  private reacquireAlpha = 1;

  constructor(scene: THREE.Scene, private readonly radius = R) {
    this.group.name = 'OrbitalGlobeHighlights';
    const surfR = radius * 1.006;
    this.sharedOuterLoopGeo = buildSphericalHexLoopGeo(surfR, 0.182, 5);
    this.sharedInnerLoopGeo = buildSphericalHexLoopGeo(surfR, 0.142, 4);
    this.sharedFillGeo = buildSphericalHexFillGeo(surfR * 0.999, 0.178, 5);
    this.sharedSpikeGeo = new THREE.CylinderGeometry(0.02, 0.055, 1.55, 6).translate(0, 0.775, 0);
    this.sharedVectorLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1.85, 0),
    ]);
    this.sharedDropRingGeo = buildRingLineGeo(0.24, 12, false);
    this.sharedPipGeo = new THREE.CircleGeometry(0.11, 6);
    this.sharedPipGeo.rotateX(-Math.PI / 2);

    const gridGeo = buildSphericalGridGeo(radius * 1.004);
    this.gridMat = makeLineMat(COLOR_CYAN, 0.12, this.disposables);
    const grid = new THREE.LineSegments(gridGeo, this.gridMat);
    grid.renderOrder = 4;

    const scanGeo = buildRingLineGeo(radius * 1.125, 72, true);
    const scanMat = makeLineMat(COLOR_CYAN, 0.30, this.disposables);
    this.scanRing = new THREE.LineSegments(scanGeo, scanMat);
    this.scanRing.rotation.set(0.22, 0, 0);

    this.disposables.push(
      this.sharedOuterLoopGeo,
      this.sharedInnerLoopGeo,
      this.sharedFillGeo,
      this.sharedSpikeGeo,
      this.sharedVectorLineGeo,
      this.sharedDropRingGeo,
      this.sharedPipGeo,
      gridGeo,
      scanGeo,
    );
    this.surfaceSyncGroup.add(grid, this.markersGroup);
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
    const patchGroup = new THREE.Group();
    patchGroup.quaternion.setFromUnitVectors(UP, normal);

    const tipGroup = new THREE.Group();
    tipGroup.position.copy(normal).multiplyScalar(this.radius * 1.008);
    tipGroup.quaternion.copy(patchGroup.quaternion);

    const isTarget = input.role === 'target';
    const hasPlayers = (input.players ?? 0) > 0 || input.role === 'player';
    const hasBots = (input.bots ?? 0) > 0 || input.role === 'bot';
    const primaryColor = isTarget
      ? COLOR_ORANGE
      : hasPlayers
        ? COLOR_CYAN
        : hasBots
          ? COLOR_AMBER
          : COLOR_BLUE;

    const handles: OpacityHandle[] = [];
    const bind = <T extends { opacity: number }>(mat: T, base: number): T => {
      handles.push({ setAlpha: (k) => { mat.opacity = base * k; } });
      return mat;
    };

    const outerMat = bind(makeLineMat(primaryColor, isTarget ? 0.92 : 0.42, this.markerDisposables), isTarget ? 0.92 : 0.42);
    const outerLoop = new THREE.LineLoop(this.sharedOuterLoopGeo, outerMat);
    outerLoop.renderOrder = 6;
    patchGroup.add(outerLoop);

    let pulseLoop: THREE.LineLoop | null = null;
    let dropRing: THREE.LineLoop | null = null;
    if (isTarget) {
      const fillMat = bind(makeMeshMat(COLOR_ORANGE, 0.18, this.markerDisposables), 0.18);
      const fill = new THREE.Mesh(this.sharedFillGeo, fillMat);
      fill.renderOrder = 5;
      const innerMat = bind(makeLineMat(COLOR_ORANGE, 0.72, this.markerDisposables), 0.72);
      pulseLoop = new THREE.LineLoop(this.sharedInnerLoopGeo, innerMat);
      pulseLoop.renderOrder = 6;
      const vecMat = bind(makeLineMat(COLOR_ORANGE, 0.88, this.markerDisposables), 0.88);
      const vecLine = new THREE.Line(this.sharedVectorLineGeo, vecMat);
      vecLine.renderOrder = 7;
      const spikeMat = bind(makeMeshMat(COLOR_ORANGE, 0.82, this.markerDisposables), 0.82);
      const spike = new THREE.Mesh(this.sharedSpikeGeo, spikeMat);
      spike.renderOrder = 7;
      const ringMat = bind(makeLineMat(COLOR_AMBER, 0.86, this.markerDisposables), 0.86);
      dropRing = new THREE.LineLoop(this.sharedDropRingGeo, ringMat);
      dropRing.renderOrder = 7;
      patchGroup.add(fill, pulseLoop);
      tipGroup.add(vecLine, spike, dropRing);
    }

    if (hasPlayers) {
      const pipMat = bind(makeMeshMat(COLOR_CYAN, 0.88, this.markerDisposables), 0.88);
      const pip = new THREE.Mesh(this.sharedPipGeo, pipMat);
      pip.position.set(isTarget ? -0.22 : 0, 0.06, 0);
      pip.renderOrder = 8;
      tipGroup.add(pip);
    }
    if (hasBots) {
      const botMat = bind(makeMeshMat(COLOR_AMBER, 0.88, this.markerDisposables), 0.88);
      const botPip = new THREE.Mesh(this.sharedPipGeo, botMat);
      botPip.position.set(hasPlayers || isTarget ? 0.22 : 0, 0.06, 0.10);
      botPip.renderOrder = 8;
      tipGroup.add(botPip);
    }

    const holder = new THREE.Group();
    holder.add(patchGroup, tipGroup);
    this.markersGroup.add(holder);
    return {
      input,
      root: tipGroup,
      normalLocal: normal,
      tipLocal: new THREE.Vector3(0, isTarget ? 1.55 : 0.22, 0),
      pulseLoop,
      dropRing,
      opacityHandles: handles,
      facing: 1,
    };
  }

  private syncRotationToGlobe(globe: PlanetGlobe, dt: number): void {
    const kind = globe.spec.kind;
    if (this.lastPlanetKind === null) {
      this.anchorSpinY = globe.spin.rotation.y + 0.18;
      this.reacquirePhase = 'idle';
      this.reacquireAlpha = 1;
      this.lastPlanetKind = kind;
    } else if (kind !== this.lastPlanetKind) {
      this.anchorSpinY = globe.spin.rotation.y - 0.26;
      this.reacquirePhase = 'idle';
      this.reacquireAlpha = 1;
      this.lastPlanetKind = kind;
    }

    const deltaY = globe.spin.rotation.y - this.anchorSpinY;
    if (this.reacquirePhase === 'idle' && deltaY > 0.42) {
      this.reacquirePhase = 'out';
    }
    if (this.reacquirePhase === 'out') {
      this.reacquireAlpha = Math.max(0, this.reacquireAlpha - dt / 0.22);
      if (this.reacquireAlpha <= 0) {
        this.anchorSpinY += 0.62;
        this.reacquirePhase = 'in';
      }
    } else if (this.reacquirePhase === 'in') {
      this.reacquireAlpha = Math.min(1, this.reacquireAlpha + dt / 0.25);
      if (this.reacquireAlpha >= 1) this.reacquirePhase = 'idle';
    }

    this.surfaceSyncGroup.rotation.set(0, globe.spin.rotation.y - this.anchorSpinY, 0);
    this.surfaceSyncGroup.scale.copy(globe.group.scale);
    this.scanRing.rotation.set(0.22, globe.spin.rotation.y * 1.15, globe.spec.orbital.axialTilt * 0.45);
  }

  update(
    globe: PlanetGlobe,
    planetPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    dt: number,
    time: number,
  ): void {
    this.group.position.copy(planetPos);
    this.syncRotationToGlobe(globe, dt);
    this.surfaceSyncGroup.updateMatrixWorld(true);
    this.gridMat.opacity = 0.12 * this.reacquireAlpha;

    const dropProgress = (time * 0.65) % 1;
    const dropY = THREE.MathUtils.lerp(1.55, 0.08, dropProgress);
    const dropScale = THREE.MathUtils.lerp(1.25, 0.45, dropProgress);
    const pulseScale = 1 + Math.sin(time * 3.4) * 0.035;

    this.surfaceSyncGroup.getWorldQuaternion(this.scratchQuat);
    for (const rec of this.records) {
      const worldNorm = this.scratchA.copy(rec.normalLocal).applyQuaternion(this.scratchQuat);
      const surfWorld = this.scratchB.copy(planetPos).addScaledVector(worldNorm, this.radius);
      const toCam = this.scratchC.copy(camera.position).sub(surfWorld).normalize();
      const facing = worldNorm.dot(toCam);
      rec.facing = facing;

      const limbFade = THREE.MathUtils.smoothstep(facing, 0.06, 0.30) * this.reacquireAlpha;
      rec.root.parent!.visible = limbFade > 0.02;
      for (const h of rec.opacityHandles) h.setAlpha(limbFade);

      if (rec.pulseLoop) rec.pulseLoop.scale.setScalar(pulseScale);
      if (rec.dropRing) {
        rec.dropRing.position.y = dropY;
        rec.dropRing.scale.setScalar(dropScale);
      }
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
    const pushPoint = (id: string, role: ProjectedAnchor2D['role'], worldPos: THREE.Vector3, visibleOk = true) => {
      v.copy(worldPos).project(camera);
      anchors.push({
        id,
        role,
        nx: (v.x + 1) * 0.5,
        ny: (1 - v.y) * 0.5,
        visible: visibleOk && v.z >= -1 && v.z <= 1,
      });
    };

    const scanPos = this.scratchB.set(
      planetPos.x - this.radius * 0.76,
      planetPos.y + this.radius * 0.44,
      planetPos.z + this.radius * 0.48,
    );
    pushPoint('scanLimb', 'scanLimb', scanPos);

    const presPos = this.scratchB.set(
      planetPos.x + this.radius * 0.10,
      planetPos.y + this.radius * 0.50,
      planetPos.z + this.radius * 0.85,
    );
    pushPoint('presenceLimb', 'presenceLimb', presPos);

    for (const rec of this.records) {
      this.scratchB.copy(rec.tipLocal);
      rec.root.localToWorld(this.scratchB);
      pushPoint(rec.input.id, rec.input.role, this.scratchB, rec.facing > 0.15);
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
