// .agents/skills/planetary-lighting-and-lightning/examples/LightningStrikeSystem.ts
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { PlanetaryLightingSystem } from './PlanetaryLightingSystem';

interface ActiveBolt {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
}

/**
 * Generates procedural 3D midpoint-displacement lightning bolts, branching forks,
 * jagged ground-skimming discharge tendrils, and power-grid overload arcs.
 */
export class LightningStrikeSystem {
  private readonly activeBolts: ActiveBolt[] = [];
  private readonly boltMaterial: THREE.MeshBasicMaterial;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly lightingSystem?: PlanetaryLightingSystem
  ) {
    // HDR Color (> 1.1) triggers selective UnrealBloomPass for electric corona
    this.boltMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.45 * 5.5, 0.88 * 5.5, 1.0 * 6.0),
      toneMapped: false,
      transparent: true,
      opacity: 1.0,
    });
    this.boltMaterial.userData.waterReflect = true;
  }

  /**
   * Builds a jagged 3D lightning geometry with optional secondary branches
   * using recursive midpoint displacement.
   */
  public buildJaggedBoltGeometry(
    start: THREE.Vector3,
    end: THREE.Vector3,
    generations = 5,
    trunkRadius = 0.08,
    spawnForks = true
  ): THREE.BufferGeometry {
    interface Segment {
      a: THREE.Vector3;
      b: THREE.Vector3;
      isFork: boolean;
    }

    let segments: Segment[] = [{ a: start.clone(), b: end.clone(), isFork: false }];
    let sway = start.distanceTo(end) * 0.16;

    for (let g = 0; g < generations; g++) {
      const next: Segment[] = [];
      for (const seg of segments) {
        const mid = seg.a.clone().add(seg.b).multiplyScalar(0.5);
        mid.x += (Math.random() - 0.5) * sway;
        mid.y += (Math.random() - 0.5) * sway * 0.35;
        mid.z += (Math.random() - 0.5) * sway;

        next.push({ a: seg.a, b: mid, isFork: seg.isFork });
        next.push({ a: mid, b: seg.b, isFork: seg.isFork });

        // Spawn angled secondary fork branch on early generations
        if (spawnForks && !seg.isFork && g <= 2 && Math.random() < 0.32) {
          const dir = seg.b.clone().sub(seg.a).multiplyScalar(0.55);
          dir.x += (Math.random() - 0.5) * sway * 1.4;
          dir.z += (Math.random() - 0.5) * sway * 1.4;
          const forkEnd = mid.clone().add(dir);
          next.push({ a: mid, b: forkEnd, isFork: true });
        }
      }
      segments = next;
      sway *= 0.52;
    }

    const tubes: THREE.BufferGeometry[] = [];
    for (const seg of segments) {
      const r = seg.isFork ? trunkRadius * 0.42 : trunkRadius;
      const curve = new THREE.LineCurve3(seg.a, seg.b);
      tubes.push(new THREE.TubeGeometry(curve, 1, r, 5, false));
    }

    return BufferGeometryUtils.mergeGeometries(tubes, false);
  }

  /**
   * Triggers a full sky-to-ground lightning strike at `targetPos` (e.g., hitting a power station).
   */
  public strikeAt(targetPos: THREE.Vector3, skyHeight = 44): void {
    const skyOrigin = new THREE.Vector3(
      targetPos.x + (Math.random() - 0.5) * 8,
      targetPos.y + skyHeight,
      targetPos.z + (Math.random() - 0.5) * 8
    );

    const geo = this.buildJaggedBoltGeometry(skyOrigin, targetPos, 5, 0.085, true);
    const mat = this.boltMaterial.clone();
    mat.userData.waterReflect = true;
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.activeBolts.push({ mesh, age: 0, duration: 0.24 });

    // Jagged 3D ground-skimming lightning tendrils radiating outward at irregular distances & angles
    const tendrilOrigin = new THREE.Vector3(targetPos.x, targetPos.y + 0.08, targetPos.z);
    const baseRotation = Math.random() * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const ang = baseRotation + (i / 3) * Math.PI * 2 + (Math.random() - 0.5) * 0.95;
      const dist = 1.4 + Math.random() * 1.4;
      const tendrilEnd = new THREE.Vector3(
        targetPos.x + Math.cos(ang) * dist,
        targetPos.y + 0.08,
        targetPos.z + Math.sin(ang) * dist
      );
      const tendrilGeo = this.buildJaggedBoltGeometry(tendrilOrigin, tendrilEnd, 4, 0.042, true);
      const tendrilMat = this.boltMaterial.clone();
      tendrilMat.userData.waterReflect = true;
      const tendrilMesh = new THREE.Mesh(tendrilGeo, tendrilMat);
      this.scene.add(tendrilMesh);
      this.activeBolts.push({ mesh: tendrilMesh, age: 0, duration: 0.22 });
    }

    // Trigger synchronized sky flash & local PointLight via PlanetaryLightingSystem
    if (this.lightingSystem) {
      this.lightingSystem.triggerSkyFlash(0.24);
      this.lightingSystem.spawnDynamicFlash(
        targetPos.clone().add(new THREE.Vector3(0, 1.5, 0)),
        0x66e0ff,
        18.0,
        28.0,
        0.26
      );
    }
  }

  /**
   * Spawns a smaller localized electrical overload arc jumping between two points on a damaged building.
   */
  public spawnGridOverloadArc(p1: THREE.Vector3, p2: THREE.Vector3): void {
    const geo = this.buildJaggedBoltGeometry(p1, p2, 4, 0.028, false);
    const mat = this.boltMaterial.clone();
    mat.userData.waterReflect = true;
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
    this.activeBolts.push({ mesh, age: 0, duration: 0.12 });
  }

  public update(dt: number): void {
    for (let i = this.activeBolts.length - 1; i >= 0; i--) {
      const b = this.activeBolts[i];
      b.age += dt;
      if (b.age >= b.duration) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.activeBolts.splice(i, 1);
      } else {
        const t = b.age / b.duration;
        // Rapid flicker envelope
        const flicker = Math.sin(t * Math.PI * 6) > -0.2 ? 1.0 - t : 0.2;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = flicker;
      }
    }
  }
}
