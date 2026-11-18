import * as THREE from 'three';
import type { OrbitalGlobeMarkerInput, OrbitalProjectedFrame, ProjectedAnchor2D } from '../types';
import { R } from './StageGlobes';

const UP = new THREE.Vector3(0, 1, 0);
const COLOR_CYAN = new THREE.Color(0x39d0ff).multiplyScalar(1.35);
const COLOR_BLUE = new THREE.Color(0x5b8cff).multiplyScalar(1.25);
const COLOR_ORANGE = new THREE.Color(0xff6a13).multiplyScalar(1.75);
const COLOR_AMBER = new THREE.Color(0xffb048).multiplyScalar(1.35);

interface MarkerRecord {
  readonly input: OrbitalGlobeMarkerInput;
  readonly root: THREE.Group;
  readonly tipLocal: THREE.Vector3;
  readonly pulseMesh: THREE.Mesh | null;
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

/**
 * 3D Ship Enchanted-Reality hologram overlay around the orbital planet globe:
 * renders an additive cyan orbital telemetry ring plus hex surface reticles, vertical beacons,
 * and player/bot nodes on the camera-facing hemisphere, and projects their anchors to 2D HUD space.
 */
export class GlobeHighlights {
  readonly group = new THREE.Group();
  private readonly markersGroup = new THREE.Group();
  private readonly scanRing: THREE.LineSegments;
  private readonly orbitRing: THREE.LineSegments;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly sharedHexGeo = new THREE.RingGeometry(0.2, 0.27, 6);
  private readonly sharedOuterHexGeo = new THREE.RingGeometry(0.42, 0.5, 6);
  private readonly sharedSpikeGeo = new THREE.CylinderGeometry(0.024, 0.06, 1.35, 6).translate(0, 0.675, 0);
  private readonly sharedPipGeo = new THREE.CircleGeometry(0.12, 6);
  private readonly mats: Record<'cyan' | 'blue' | 'orange' | 'amber', THREE.MeshBasicMaterial>;
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private records: MarkerRecord[] = [];
  private lastKey = '';

  constructor(scene: THREE.Scene, private readonly radius = R) {
    this.group.name = 'OrbitalGlobeHighlights';
    this.sharedHexGeo.rotateX(-Math.PI / 2);
    this.sharedOuterHexGeo.rotateX(-Math.PI / 2);
    this.sharedPipGeo.rotateX(-Math.PI / 2);
    this.disposables.push(this.sharedHexGeo, this.sharedOuterHexGeo, this.sharedSpikeGeo, this.sharedPipGeo);

    const mkMat = (c: THREE.Color, opacity: number) => {
      const m = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.disposables.push(m);
      return m;
    };
    this.mats = {
      cyan: mkMat(COLOR_CYAN, 0.72),
      blue: mkMat(COLOR_BLUE, 0.7),
      orange: mkMat(COLOR_ORANGE, 0.92),
      amber: mkMat(COLOR_AMBER, 0.8),
    };

    const scanGeo = buildRingLineGeo(radius * 1.13, 72, true);
    const scanMat = new THREE.LineBasicMaterial({
      color: COLOR_CYAN,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.scanRing = new THREE.LineSegments(scanGeo, scanMat);
    this.scanRing.rotation.set(0.32, 0.1, -0.18);

    const orbitGeo = buildRingLineGeo(radius * 1.075, 64, false);
    const orbitMat = new THREE.LineBasicMaterial({
      color: COLOR_BLUE,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.orbitRing = new THREE.LineSegments(orbitGeo, orbitMat);
    this.orbitRing.rotation.set(-0.22, 0.4, 0.14);

    this.disposables.push(scanGeo, scanMat, orbitGeo, orbitMat);
    this.group.add(this.scanRing, this.orbitRing, this.markersGroup);
    scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setHighlights(markers: readonly OrbitalGlobeMarkerInput[]): void {
    const key = markerKey(markers);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.markersGroup.clear();
    this.records = [];

    for (const input of markers) {
      const normal = sphericalNormal(input.yaw, input.pitch, new THREE.Vector3());
      const root = new THREE.Group();
      root.position.copy(normal).multiplyScalar(this.radius * 1.022);
      root.quaternion.setFromUnitVectors(UP, normal);

      const isTarget = input.role === 'target';
      const hasPlayers = (input.players ?? 0) > 0 || input.role === 'player';
      const hasBots = (input.bots ?? 0) > 0 || input.role === 'bot';

      const baseMat = isTarget ? this.mats.orange : hasPlayers ? this.mats.cyan : hasBots ? this.mats.amber : this.mats.blue;
      const baseMesh = new THREE.Mesh(this.sharedHexGeo, baseMat);
      baseMesh.renderOrder = 6;
      root.add(baseMesh);

      let pulseMesh: THREE.Mesh | null = null;
      if (isTarget) {
        const outer = new THREE.Mesh(this.sharedOuterHexGeo, this.mats.orange);
        outer.renderOrder = 6;
        const spike = new THREE.Mesh(this.sharedSpikeGeo, this.mats.orange);
        spike.renderOrder = 6;
        root.add(outer, spike);
        pulseMesh = outer;
      }
      if (hasPlayers) {
        const pip = new THREE.Mesh(this.sharedPipGeo, this.mats.cyan);
        pip.position.set(isTarget ? -0.26 : 0, 0.04, 0);
        pip.renderOrder = 7;
        root.add(pip);
      }
      if (hasBots) {
        const botPip = new THREE.Mesh(this.sharedPipGeo, this.mats.amber);
        botPip.position.set(hasPlayers || isTarget ? 0.26 : 0, 0.04, 0.12);
        botPip.renderOrder = 7;
        root.add(botPip);
      }

      this.markersGroup.add(root);
      this.records.push({
        input,
        root,
        tipLocal: new THREE.Vector3(0, isTarget ? 1.15 : 0.2, 0),
        pulseMesh,
      });
    }
  }

  update(planetPos: THREE.Vector3, time: number): void {
    this.group.position.copy(planetPos);
    this.scanRing.rotation.y = time * 0.14;
    this.orbitRing.rotation.y = -time * 0.09;
    this.markersGroup.rotation.y = Math.sin(time * 0.25) * 0.04;
    this.markersGroup.rotation.x = Math.cos(time * 0.2) * 0.02;

    const pulse = 1 + Math.sin(time * 3.4) * 0.14;
    for (const rec of this.records) {
      if (rec.pulseMesh) {
        rec.pulseMesh.scale.setScalar(pulse);
        rec.pulseMesh.rotation.y = time * 0.7;
      }
    }
  }

  project(camera: THREE.PerspectiveCamera, planetPos: THREE.Vector3): OrbitalProjectedFrame {
    this.group.updateMatrixWorld(true);
    const v = this.scratchA;
    v.copy(planetPos).project(camera);
    const globeNx = (v.x + 1) * 0.5;
    const globeNy = (1 - v.y) * 0.5;

    const top = this.scratchB.copy(planetPos).addScaledVector(UP, this.radius).project(camera);
    const globeRadiusNormY = Math.max(0.05, Math.abs((1 - top.y) * 0.5 - globeNy));

    const anchors: ProjectedAnchor2D[] = [];
    const pushPoint = (
      id: string,
      role: ProjectedAnchor2D['role'],
      worldPos: THREE.Vector3,
    ) => {
      v.copy(worldPos).project(camera);
      anchors.push({
        id,
        role,
        nx: (v.x + 1) * 0.5,
        ny: (1 - v.y) * 0.5,
        visible: v.z >= -1 && v.z <= 1,
      });
    };

    const scanPos = this.scratchB.set(
      planetPos.x - this.radius * 0.76,
      planetPos.y + this.radius * 0.44,
      planetPos.z + this.radius * 0.48,
    );
    pushPoint('scanLimb', 'scanLimb', scanPos);

    const presPos = this.scratchB.set(
      planetPos.x + this.radius * 0.68,
      planetPos.y + this.radius * 0.42,
      planetPos.z + this.radius * 0.58,
    );
    pushPoint('presenceLimb', 'presenceLimb', presPos);

    for (const rec of this.records) {
      this.scratchB.copy(rec.tipLocal);
      rec.root.localToWorld(this.scratchB);
      pushPoint(rec.input.id, rec.input.role, this.scratchB);
    }

    return { globeNx, globeNy, globeRadiusNormY, anchors };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
