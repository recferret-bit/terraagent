import * as THREE from 'three';
import { getParticleGeometry } from './geometries';
import type { ActiveWorkSiteInput, ParticleLayerSpec, ParticlePresetSpec } from './types';

interface LayerRuntime {
  spec: ParticleLayerSpec;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  rx: Float32Array;
  ry: Float32Array;
  rz: Float32Array;
  wx: Float32Array;
  wy: Float32Array;
  wz: Float32Array;
  age: Float32Array;
  lifetime: Float32Array;
  baseScale: Float32Array;
}

interface BeamPair {
  core: THREE.Mesh;
  sheath: THREE.Mesh;
}

const DUMMY = new THREE.Object3D();
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const FORWARD_Z = new THREE.Vector3(0, 0, 1);
const TMP_START = new THREE.Vector3();
const TMP_END = new THREE.Vector3();
const TMP_DIR = new THREE.Vector3();
const TMP_QUAT = new THREE.Quaternion();
const TMP_COLOR_A = new THREE.Color();
const TMP_COLOR_B = new THREE.Color();
const TMP_COLOR_OUT = new THREE.Color();

function createLayerRuntime(spec: ParticleLayerSpec, group: THREE.Group, seedBase: number): LayerRuntime {
  const geo = getParticleGeometry(spec.geometry);
  const isEmissive = (spec.emissiveIntensity ?? 0) > 0;
  const material = new THREE.MeshStandardMaterial({
    color: isEmissive ? 0xffffff : spec.color,
    emissive: isEmissive ? new THREE.Color(spec.color) : new THREE.Color(0x000000),
    emissiveIntensity: spec.emissiveIntensity ?? 0,
    roughness: Math.max(0.35, spec.roughness ?? (isEmissive ? 0.35 : 0.78)),
    metalness: spec.metalness ?? (isEmissive ? 0.1 : 0.08),
    flatShading: true,
  });

  const n = spec.count;
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.castShadow = spec.role !== 'accent' && spec.geometry !== 'dustCloud';
  mesh.receiveShadow = spec.role !== 'accent';
  mesh.frustumCulled = false;

  TMP_COLOR_A.setHex(spec.color);
  TMP_COLOR_B.setHex(spec.colorAlt ?? spec.color);
  for (let i = 0; i < n; i++) {
    const t = ((Math.sin((seedBase + i) * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const lum = 0.92 + 0.16 * (((Math.sin((seedBase + i) * 78.233) * 43758.5453) % 1 + 1) % 1);
    TMP_COLOR_OUT.lerpColors(TMP_COLOR_A, TMP_COLOR_B, t).multiplyScalar(lum);
    mesh.setColorAt(i, TMP_COLOR_OUT);
    DUMMY.scale.setScalar(0);
    DUMMY.updateMatrix();
    mesh.setMatrixAt(i, DUMMY.matrix);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);

  const age = new Float32Array(n);
  const lifetime = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lifetime[i] = spec.lifetimeRange[0] + (spec.lifetimeRange[1] - spec.lifetimeRange[0]) * ((i + 0.5) / n);
    // Stagger initial ages so continuous work streams evenly from frame 1
    age[i] = lifetime[i] * ((i * 0.6180339887) % 1);
  }

  return {
    spec,
    mesh,
    material,
    px: new Float32Array(n),
    py: new Float32Array(n),
    pz: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    vz: new Float32Array(n),
    rx: new Float32Array(n),
    ry: new Float32Array(n),
    rz: new Float32Array(n),
    wx: new Float32Array(n),
    wy: new Float32Array(n),
    wz: new Float32Array(n),
    age,
    lifetime,
    baseScale: new Float32Array(n),
  };
}

export class WorkParticleEmitter {
  readonly group = new THREE.Group();
  readonly preset: ParticlePresetSpec;
  private readonly layers: LayerRuntime[] = [];
  private readonly beams: BeamPair[] = [];
  private readonly muzzleFlares: THREE.Mesh[] = [];
  private readonly beamGeo: THREE.CylinderGeometry;
  private readonly beamCoreMat: THREE.MeshStandardMaterial;
  private readonly beamSheathMat: THREE.MeshBasicMaterial;
  private readonly impactFlare: THREE.Mesh;
  private readonly shockRing: THREE.Mesh;
  private readonly ringMat: THREE.MeshStandardMaterial;

  private site: ActiveWorkSiteInput;
  private active = true;
  private burstRemaining = 0;
  private burstDuration = 1;
  private clock = 0;
  private rngState: number;

  constructor(preset: ParticlePresetSpec, initialSite: ActiveWorkSiteInput) {
    this.preset = preset;
    this.site = initialSite;
    // Per worker + preset seed: two bots working at once must not throw identical debris patterns.
    this.rngState = [...`${preset.id}|${initialSite.workerId}`].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
    this.group.name = `WorkParticleEmitter(${preset.id})`;

    preset.layers.forEach((layerSpec, idx) => {
      this.layers.push(createLayerRuntime(layerSpec, this.group, (idx + 1) * 997));
    });

    const tb = preset.toolBeam;
    this.beamCoreMat = new THREE.MeshStandardMaterial({
      color: tb.coreColor,
      emissive: new THREE.Color(tb.coreColor),
      emissiveIntensity: tb.emissiveIntensity,
      roughness: 0.2,
      metalness: 0.0,
    });
    this.beamSheathMat = new THREE.MeshBasicMaterial({
      color: tb.glowColor,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
    for (let i = 0; i < 2; i++) {
      const core = new THREE.Mesh(this.beamGeo, this.beamCoreMat);
      const sheath = new THREE.Mesh(this.beamGeo, this.beamSheathMat);
      const muzzle = new THREE.Mesh(getParticleGeometry('energyOrb'), this.beamCoreMat);
      core.frustumCulled = false;
      sheath.frustumCulled = false;
      muzzle.frustumCulled = false;
      this.group.add(core, sheath, muzzle);
      this.beams.push({ core, sheath });
      this.muzzleFlares.push(muzzle);
    }

    this.impactFlare = new THREE.Mesh(getParticleGeometry('energyOrb'), this.beamCoreMat);
    this.impactFlare.frustumCulled = false;
    this.group.add(this.impactFlare);

    this.ringMat = new THREE.MeshStandardMaterial({
      color: tb.ringColor,
      emissive: new THREE.Color(tb.ringColor),
      emissiveIntensity: Math.max(3.2, tb.emissiveIntensity * 0.85),
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    this.shockRing = new THREE.Mesh(getParticleGeometry('shockRing'), this.ringMat);
    this.shockRing.frustumCulled = false;
    this.group.add(this.shockRing);

    this.seedAllParticles(1.0);
  }

  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 0xffffffff;
  }

  /** World x / z of the worked target (view-focus culling, `WorkParticleSystem.update`; per frame, no tuple). */
  get targetX(): number { return this.site.targetPos[0]; }
  get targetZ(): number { return this.site.targetPos[2]; }

  updateSite(site: ActiveWorkSiteInput): void {
    const moved = Math.hypot(site.targetPos[0] - this.site.targetPos[0], site.targetPos[2] - this.site.targetPos[2]) > 0.7;
    this.site = site;
    this.active = (site.intensity ?? 1) > 0.02;
    if (moved && this.active) {
      this.seedAllParticles(1.0);
    }
  }

  triggerBurst(durationSeconds = 0.95): void {
    this.burstRemaining = Math.max(this.burstRemaining, durationSeconds);
    this.burstDuration = Math.max(1e-3, this.burstRemaining);
    this.active = true;
    this.seedAllParticles(1.55);
  }

  setInactive(): void {
    this.active = false;
  }

  private computeCutPoint(): [number, number, number] {
    const tb = this.preset.toolBeam;
    const [tx, ty, tz] = this.site.targetPos;
    const a = this.clock * tb.sweepFreq;
    const r = tb.sweepRadius * (0.65 + 0.35 * Math.sin(this.clock * 2.3));
    return [
      tx + Math.cos(a) * r,
      Math.max(this.site.groundY + 0.08, ty + Math.sin(a * 1.5) * 0.14),
      tz + Math.sin(a) * r,
    ];
  }

  private spawnParticle(layer: LayerRuntime, i: number, cutPoint: [number, number, number], speedBoost: number): void {
    const { spec } = layer;
    const [cx, cy, cz] = cutPoint;
    const [bx, , bz] = this.site.botOrigin;
    // Full 360-degree radial fountain centered on the target object, with only a subtle bias toward the cutter
    let dx = bx - cx;
    let dz = bz - cz;
    const dLen = Math.hypot(dx, dz) || 1;
    dx /= dLen;
    dz /= dLen;

    const angle = this.rand() * Math.PI * 2;
    let dirX = Math.cos(angle) + dx * 0.18;
    let dirZ = Math.sin(angle) + dz * 0.18;
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dirLen;
    dirZ /= dirLen;

    const speed = (spec.speedRange[0] + this.rand() * (spec.speedRange[1] - spec.speedRange[0])) * speedBoost;
    const up = (spec.upwardBias[0] + this.rand() * (spec.upwardBias[1] - spec.upwardBias[0])) * speedBoost;
    const radialSpread = 0.35 + 0.65 * this.rand();
    const horizSpeed = speed * radialSpread * 0.48;

    layer.px[i] = cx + (this.rand() - 0.5) * 0.16;
    layer.py[i] = cy + (this.rand() - 0.3) * 0.16;
    layer.pz[i] = cz + (this.rand() - 0.5) * 0.16;
    layer.vx[i] = dirX * horizSpeed;
    layer.vy[i] = up;
    layer.vz[i] = dirZ * horizSpeed;

    layer.rx[i] = this.rand() * Math.PI * 2;
    layer.ry[i] = this.rand() * Math.PI * 2;
    layer.rz[i] = this.rand() * Math.PI * 2;
    layer.wx[i] = (this.rand() - 0.5) * 2 * spec.spinSpeed;
    layer.wy[i] = (this.rand() - 0.5) * 2 * spec.spinSpeed;
    layer.wz[i] = (this.rand() - 0.5) * 2 * spec.spinSpeed;

    layer.lifetime[i] = spec.lifetimeRange[0] + this.rand() * (spec.lifetimeRange[1] - spec.lifetimeRange[0]);
    layer.baseScale[i] = spec.sizeRange[0] + this.rand() * (spec.sizeRange[1] - spec.sizeRange[0]);
  }

  private seedAllParticles(speedBoost: number): void {
    const cut = this.computeCutPoint();
    for (const layer of this.layers) {
      for (let i = 0; i < layer.spec.count; i++) {
        this.spawnParticle(layer, i, cut, speedBoost);
        if (speedBoost > 1.2) {
          layer.age[i] = this.rand() * 0.12;
        }
      }
    }
  }

  private stepLayer(layer: LayerRuntime, dt: number, cutPoint: [number, number, number], canRespawn: boolean): number {
    const { spec } = layer;
    const n = spec.count;
    const dampXZ = Math.exp(-spec.drag * dt);
    const dampY = Math.exp(-spec.drag * 0.55 * dt);
    const swirl = spec.swirl ?? 0;
    const [tx, , tz] = this.site.targetPos;
    const groundY = this.site.groundY;
    const weight = Math.max(this.site.intensity ?? 1, this.burstRemaining > 0 ? 1 : 0);
    let aliveCount = 0;

    for (let i = 0; i < n; i++) {
      layer.age[i] += dt;
      if (layer.age[i] >= layer.lifetime[i]) {
        if (canRespawn) {
          layer.age[i] = 0;
          this.spawnParticle(layer, i, cutPoint, 1.0);
        } else {
          DUMMY.scale.setScalar(0);
          DUMMY.updateMatrix();
          layer.mesh.setMatrixAt(i, DUMMY.matrix);
          continue;
        }
      }
      aliveCount++;

      let vx = layer.vx[i] * dampXZ;
      let vy = layer.vy[i] * dampY - spec.gravity * dt;
      let vz = layer.vz[i] * dampXZ;

      if (swirl !== 0) {
        const dx = layer.px[i] - tx;
        const dz = layer.pz[i] - tz;
        const r = Math.hypot(dx, dz) + 0.05;
        vx += (-dz / r) * swirl * dt;
        vz += (dx / r) * swirl * dt;
      }

      let px = layer.px[i] + vx * dt;
      let py = layer.py[i] + vy * dt;
      let pz = layer.pz[i] + vz * dt;

      const floorY = groundY + layer.baseScale[i] * 0.35;
      if (py < floorY && vy < 0 && spec.bounce > 0) {
        py = floorY;
        vy = -vy * spec.bounce;
        vx *= 0.72;
        vz *= 0.72;
        layer.wx[i] *= 0.68;
        layer.wy[i] *= 0.68;
        layer.wz[i] *= 0.68;
      }

      layer.px[i] = px;
      layer.py[i] = py;
      layer.pz[i] = pz;
      layer.vx[i] = vx;
      layer.vy[i] = vy;
      layer.vz[i] = vz;

      layer.rx[i] += layer.wx[i] * dt;
      layer.ry[i] += layer.wy[i] * dt;
      layer.rz[i] += layer.wz[i] * dt;

      const u = Math.min(1, layer.age[i] / Math.max(0.05, layer.lifetime[i]));
      const popIn = Math.min(1, u / 0.09);
      const fadeOut = u > 0.62 ? 1 - Math.pow((u - 0.62) / 0.38, 2) : 1;
      const puff = spec.geometry === 'dustCloud' ? 0.68 + 0.85 * u : 1.0;
      const s = layer.baseScale[i] * popIn * fadeOut * puff * Math.max(0.25, weight);

      DUMMY.position.set(px, py, pz);
      const stretch = spec.stretchByVelocity ?? 1;
      const speed = Math.hypot(vx, vy, vz);
      if (stretch > 1.05 && speed > 0.05) {
        TMP_DIR.set(vx / speed, vy / speed, vz / speed);
        DUMMY.quaternion.setFromUnitVectors(FORWARD_Z, TMP_DIR);
        const vMag = Math.min(2.4, 1 + speed * 0.14 * (stretch - 1));
        DUMMY.scale.set(s, s, s * vMag);
      } else {
        DUMMY.rotation.set(layer.rx[i], layer.ry[i], layer.rz[i]);
        DUMMY.scale.setScalar(s);
      }
      DUMMY.updateMatrix();
      layer.mesh.setMatrixAt(i, DUMMY.matrix);
    }

    layer.mesh.instanceMatrix.needsUpdate = true;
    return aliveCount;
  }

  private updateToolBeams(cutPoint: [number, number, number], showBeams: boolean): void {
    const tb = this.preset.toolBeam;
    const origins = this.site.toolOrigins;
    const pulse = 0.8 + 0.35 * Math.sin(this.clock * tb.pulseFreq);
    const weight = this.site.intensity ?? 1;

    for (let i = 0; i < this.beams.length; i++) {
      const pair = this.beams[i];
      const muzzle = this.muzzleFlares[i];
      if (!showBeams || i >= origins.length || weight <= 0.05) {
        pair.core.visible = false;
        pair.sheath.visible = false;
        muzzle.visible = false;
        continue;
      }
      const orig = origins[i];
      const rawDx = cutPoint[0] - orig[0];
      const rawDz = cutPoint[2] - orig[2];
      const rawHoriz = Math.hypot(rawDx, rawDz) || 1;
      const perpX = -rawDz / rawHoriz;
      const perpZ = rawDx / rawHoriz;
      const sideOffset = origins.length >= 2 ? (i === 0 ? 1 : -1) * 0.035 : 0;

      TMP_START.set(orig[0], orig[1], orig[2]);
      TMP_END.set(cutPoint[0] + perpX * sideOffset, cutPoint[1], cutPoint[2] + perpZ * sideOffset);
      TMP_DIR.subVectors(TMP_END, TMP_START);
      const len = TMP_DIR.length();
      if (len < 0.05) {
        pair.core.visible = false;
        pair.sheath.visible = false;
        muzzle.visible = false;
        continue;
      }
      TMP_DIR.divideScalar(len);
      TMP_QUAT.setFromUnitVectors(UP_AXIS, TMP_DIR);

      const midX = (TMP_START.x + TMP_END.x) * 0.5;
      const midY = (TMP_START.y + TMP_END.y) * 0.5;
      const midZ = (TMP_START.z + TMP_END.z) * 0.5;
      const rCore = tb.beamRadius * pulse * weight;
      const rSheath = rCore * 2.3;

      pair.core.visible = true;
      pair.core.position.set(midX, midY, midZ);
      pair.core.quaternion.copy(TMP_QUAT);
      pair.core.scale.set(rCore, len, rCore);

      pair.sheath.visible = true;
      pair.sheath.position.set(midX, midY, midZ);
      pair.sheath.quaternion.copy(TMP_QUAT);
      pair.sheath.scale.set(rSheath, len, rSheath);

      muzzle.visible = true;
      muzzle.position.set(orig[0], orig[1], orig[2]);
      muzzle.rotation.set(this.clock * 7, this.clock * 11, 0);
      muzzle.scale.setScalar((0.042 + 0.012 * pulse) * weight);
    }

    if (showBeams && weight > 0.05) {
      this.impactFlare.visible = true;
      this.impactFlare.position.set(cutPoint[0], cutPoint[1], cutPoint[2]);
      this.impactFlare.rotation.set(this.clock * 9, this.clock * 13, 0);
      this.impactFlare.scale.setScalar((0.12 + 0.05 * pulse) * weight);
    } else {
      this.impactFlare.visible = false;
    }

    const ringPhase = (this.clock * 1.65) % 1;
    const showRing = showBeams || this.burstRemaining > 0;
    this.shockRing.visible = showRing;
    if (showRing) {
      const [tx, , tz] = this.site.targetPos;
      this.shockRing.position.set(tx, this.site.groundY + 0.035, tz);
      const ringRadius = this.burstRemaining > 0 ? 0.45 + (1 - this.burstRemaining / this.burstDuration) * 1.45 : 0.32 + ringPhase * 0.78;
      this.shockRing.scale.set(ringRadius, 1, ringRadius);
      this.ringMat.opacity = (1 - ringPhase) * 0.78;
    }
  }

  /** Steps physics and returns true while any particle or beam is still alive. */
  step(dt: number): boolean {
    if (!(dt > 0)) return true; // paused (0) or NaN: freeze this frame instead of poisoning the clock
    const clampedDt = Math.min(0.05, Math.max(0.001, dt));
    this.clock += clampedDt;
    if (this.burstRemaining > 0) {
      this.burstRemaining = Math.max(0, this.burstRemaining - clampedDt);
    }
    const canRespawn = this.active || this.burstRemaining > 0;
    const cutPoint = this.computeCutPoint();
    this.updateToolBeams(cutPoint, this.active && this.burstRemaining <= 0);

    let totalAlive = 0;
    for (const layer of this.layers) {
      totalAlive += this.stepLayer(layer, clampedDt, cutPoint, canRespawn);
    }
    return canRespawn || totalAlive > 0;
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.mesh.dispose();
      layer.material.dispose();
    }
    this.beamGeo.dispose();
    this.beamCoreMat.dispose();
    this.beamSheathMat.dispose();
    this.ringMat.dispose();
    this.group.clear();
  }
}
