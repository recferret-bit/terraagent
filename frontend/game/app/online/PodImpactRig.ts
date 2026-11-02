import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, smoother, smoothstep } from '../../descent/math';

/** Forward egress direction from the pod bay down the ramp onto the spawn hex center `(wx, wz)`. */
export const POD_EGRESS_DIR = new THREE.Vector3(0.6, 0, 0.8).normalize();
/** Yaw angle (rad) of the pod bay and egress ramp facing `POD_EGRESS_DIR`. */
export const POD_EGRESS_YAW = Math.atan2(POD_EGRESS_DIR.x, POD_EGRESS_DIR.z);
/** Distance (m) behind the spawn hex center `(wx, wz)` where the pod touches down and leaves its crater. */
export const POD_LAND_OFFSET_M = 2.6;

export interface PodImpactRigUpdate {
  readonly time: number;
  readonly pos: THREE.Vector3;
  readonly yaw: number;
  readonly craterVisible: boolean;
  /** Seconds elapsed since touchdown (`0` before touchdown). */
  readonly sinceTouchdown: number;
  /** Whether the articulated opening pod rig is visible (true during `'egress'`). */
  readonly egressRigVisible: boolean;
  /** `0..1` petal & ramp opening progress during `'egress'`. */
  readonly podOpenProgress: number;
  /** `0..1` pod retraction/dismantle progress at the end of `'egress'`. */
  readonly podDismantleProgress: number;
}

interface DebrisChunk {
  mesh: THREE.Mesh;
  ang: number;
  r0: number;
  speed: number;
  vy: number;
  rotSpeed: THREE.Vector3;
}

interface PetalHinge {
  pivot: THREE.Group;
  isFront: boolean;
}

/**
 * 3D impact crater, touchdown shockwave/debris burst, and articulated 4-petal conical opening pod shell
 * that blooms open 2 seconds after touchdown so the hero explorer robot can roll out down the ramp.
 */
export class PodImpactRig {
  readonly root = new THREE.Group();
  readonly craterGroup = new THREE.Group();
  readonly waveGroup = new THREE.Group();
  readonly egressGroup = new THREE.Group();

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private emberMat!: THREE.MeshStandardMaterial;
  private shockwaveMesh!: THREE.Mesh;
  private shockwaveMat!: THREE.MeshBasicMaterial;
  private dustRingMesh!: THREE.Mesh;
  private dustRingMat!: THREE.MeshBasicMaterial;
  private readonly flyingDebris: DebrisChunk[] = [];
  private readonly petals: PetalHinge[] = [];
  private rampPivot!: THREE.Group;
  private coreLightMat!: THREE.MeshStandardMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.root.name = 'pod-impact-rig';
    this.craterGroup.name = 'pod-impact-crater';
    this.waveGroup.name = 'pod-impact-waves';
    this.egressGroup.name = 'pod-egress-rig';
    this.craterGroup.visible = false;
    this.waveGroup.visible = false;
    this.egressGroup.visible = false;

    this.buildCrater();
    this.buildWaves();
    this.buildEgressPod();

    this.root.add(this.craterGroup, this.waveGroup, this.egressGroup);
    this.scene.add(this.root);
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private buildCrater(): void {
    const pitMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.92, metalness: 0.16 }),
    );
    const slagMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.84, metalness: 0.32 }),
    );
    const rimMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x2f333c, roughness: 0.86, metalness: 0.22 }),
    );
    this.emberMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x280900,
        emissive: 0xff5a14,
        emissiveIntensity: 4.2,
        roughness: 0.6,
      }),
    );

    const pit = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(1.42, 1.56, 0.03, 24)), pitMat);
    pit.position.y = 0.015;
    pit.receiveShadow = true;

    const innerSlag = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.98, 1.08, 0.036, 20)), slagMat);
    innerSlag.position.y = 0.02;
    innerSlag.receiveShadow = true;

    const rimProfile: [number, number][] = [
      [1.26, 0.01],
      [1.48, 0.2],
      [1.72, 0.25],
      [2.02, 0.12],
      [2.36, 0.01],
    ];
    const rim = new THREE.Mesh(
      this.trackGeo(new THREE.LatheGeometry(rimProfile.map(([r, y]) => new THREE.Vector2(r, y)), 24)),
      rimMat,
    );
    rim.castShadow = false;
    rim.receiveShadow = true;

    const emberRing = new THREE.Mesh(
      this.trackGeo(new THREE.RingGeometry(0.45, 1.12, 20).rotateX(-Math.PI / 2)),
      this.emberMat,
    );
    emberRing.position.y = 0.042;
    this.craterGroup.add(pit, innerSlag, rim, emberRing);

    this.buildCraterRocksAndFissures(rimMat, slagMat);
    this.craterGroup.traverse((o) => {
      o.castShadow = false;
    });
  }

  private buildCraterRocksAndFissures(
    rimMat: THREE.MeshStandardMaterial,
    slagMat: THREE.MeshStandardMaterial,
  ): void {
    const rockGeoA = this.trackGeo(new RoundedBoxGeometry(0.42, 0.24, 0.32, 2, 0.05));
    const rockGeoB = this.trackGeo(new RoundedBoxGeometry(0.3, 0.2, 0.25, 2, 0.04));
    const streakGeo = this.trackGeo(new RoundedBoxGeometry(0.12, 0.03, 0.78, 1, 0.01));
    const crackGeo = this.trackGeo(new RoundedBoxGeometry(0.06, 0.035, 1.02, 1, 0.01));

    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI * 2) / 12 + (i % 2 === 0 ? 0.08 : -0.06);
      const r = 1.58 + (i % 3) * 0.14;
      const rock = new THREE.Mesh(i % 2 === 0 ? rockGeoA : rockGeoB, i % 3 === 0 ? slagMat : rimMat);
      rock.position.set(Math.cos(a) * r, 0.12 + (i % 2) * 0.04, Math.sin(a) * r);
      rock.rotation.set(0.32 + (i % 3) * 0.08, -a + Math.PI / 2, (i % 2 === 0 ? 1 : -1) * 0.18);
      rock.castShadow = false;
      rock.receiveShadow = true;
      this.craterGroup.add(rock);
    }

    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8 + 0.2;
      const streak = new THREE.Mesh(streakGeo, slagMat);
      streak.position.set(Math.cos(a) * 1.95, 0.04, Math.sin(a) * 1.95);
      streak.rotation.set(-0.14, Math.atan2(Math.cos(a), Math.sin(a)), 0);
      this.craterGroup.add(streak);
    }

    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.15;
      const crack = new THREE.Mesh(crackGeo, this.emberMat);
      crack.position.set(Math.cos(a) * 0.78, 0.035, Math.sin(a) * 0.78);
      crack.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      this.craterGroup.add(crack);
    }
  }

  private buildWaves(): void {
    this.shockwaveMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff8a36,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.shockwaveMesh = new THREE.Mesh(
      this.trackGeo(new THREE.RingGeometry(0.85, 1.35, 36).rotateX(-Math.PI / 2)),
      this.shockwaveMat,
    );
    this.shockwaveMesh.position.y = 0.1;

    this.dustRingMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xd7b996,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.dustRingMesh = new THREE.Mesh(
      this.trackGeo(new THREE.RingGeometry(0.7, 1.6, 32).rotateX(-Math.PI / 2)),
      this.dustRingMat,
    );
    this.dustRingMesh.position.y = 0.08;
    this.waveGroup.add(this.shockwaveMesh, this.dustRingMesh);

    const chunkGeo = this.trackGeo(new RoundedBoxGeometry(0.2, 0.14, 0.18, 1, 0.03));
    const chunkMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x383c46, roughness: 0.82, metalness: 0.25 }),
    );
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI * 2) / 10 + 0.13 * (i % 3);
      const mesh = new THREE.Mesh(chunkGeo, chunkMat);
      mesh.castShadow = true;
      this.waveGroup.add(mesh);
      this.flyingDebris.push({
        mesh,
        ang,
        r0: 0.9 + (i % 3) * 0.18,
        speed: 3.2 + (i % 4) * 0.9,
        vy: 4.4 + (i % 3) * 1.3,
        rotSpeed: new THREE.Vector3(4 + i, 6 - (i % 4), 3 + (i % 5)),
      });
    }
  }

  private buildEgressPod(): void {
    const hullPrimary = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd8dce3, roughness: 0.5, metalness: 0.35 }),
    );
    const hullSecondary = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe86a24, roughness: 0.48, metalness: 0.3 }),
    );
    const gunmetal = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x262a32, roughness: 0.55, metalness: 0.68 }),
    );
    this.coreLightMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x102838,
        emissive: 0x30d8ff,
        emissiveIntensity: 3.8,
        roughness: 0.35,
      }),
    );

    const shieldProfile: [number, number][] = [
      [0.02, 0],
      [0.7, 0.02],
      [1.15, 0.14],
      [1.32, 0.34],
      [1.3, 0.5],
      [0.02, 0.5],
    ];
    const shieldBase = new THREE.Mesh(
      this.trackGeo(new THREE.LatheGeometry(shieldProfile.map(([r, y]) => new THREE.Vector2(r, y)), 16)),
      gunmetal,
    );
    shieldBase.castShadow = true;
    const collar = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(1.34, 1.34, 0.08, 16)), hullSecondary);
    collar.position.y = 0.48;
    collar.castShadow = true;
    const deck = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.92, 0.92, 0.1, 16)), gunmetal);
    deck.position.y = 0.52;
    deck.castShadow = true;
    const seatBase = new THREE.Mesh(this.trackGeo(new RoundedBoxGeometry(0.55, 0.16, 0.45, 2, 0.04)), hullSecondary);
    seatBase.position.set(0, 0.62, -0.22);
    seatBase.castShadow = true;
    const seatBack = new THREE.Mesh(this.trackGeo(new RoundedBoxGeometry(0.68, 1.15, 0.2, 2, 0.06)), gunmetal);
    seatBack.position.set(0, 1.1, -0.5);
    seatBack.castShadow = true;
    const coreGlow = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.56, 0.56, 0.06, 12)), this.coreLightMat);
    coreGlow.position.y = 0.55;
    this.egressGroup.add(shieldBase, collar, deck, seatBase, seatBack, coreGlow);

    this.buildLandingLegsAndPetals(hullPrimary, hullSecondary, gunmetal);
  }

  private buildLandingLegsAndPetals(
    hullPrimary: THREE.MeshStandardMaterial,
    hullSecondary: THREE.MeshStandardMaterial,
    gunmetal: THREE.MeshStandardMaterial,
  ): void {
    const legGeo = this.trackGeo(new THREE.CylinderGeometry(0.055, 0.055, 1.04, 6));
    const padGeo = this.trackGeo(new THREE.CylinderGeometry(0.2, 0.22, 0.08, 8));
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
      const leg = new THREE.Mesh(legGeo, gunmetal);
      leg.castShadow = true;
      leg.position.set(Math.cos(a) * 1.33, 0.47, Math.sin(a) * 1.33);
      leg.rotation.order = 'YXZ';
      leg.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
      leg.rotation.x = -0.58;
      const pad = new THREE.Mesh(padGeo, hullSecondary);
      pad.castShadow = true;
      pad.position.set(Math.cos(a) * 1.62, 0.04, Math.sin(a) * 1.62);
      this.egressGroup.add(leg, pad);
    }

    const outer: [number, number][] = [
      [1.25, 0.48],
      [1.0, 1.3],
      [0.68, 2.3],
      [0.4, 2.95],
    ];
    const inner = outer.map(([r, y]) => [r - 0.12, y - (y > 2.9 ? 0.02 : 0)] as [number, number]).reverse();
    const prof = [...outer, ...inner].map(([r, y]) => new THREE.Vector2(r, y));
    const span = Math.PI / 2 - 0.05;
    const petalGeo = this.trackGeo(
      new THREE.LatheGeometry(prof, 8, -span / 2, span).translate(0, -0.48, -1.16),
    );
    const ribGeo = this.trackGeo(new RoundedBoxGeometry(0.09, 2.35, 0.12, 1, 0.02));
    const nozzleGeo = this.trackGeo(new THREE.CylinderGeometry(0.12, 0.2, 0.34, 8));

    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      const pivot = new THREE.Group();
      pivot.name = `pod-petal-pivot-${i}`;
      pivot.rotation.order = 'YXZ';
      pivot.position.set(Math.sin(ang) * 1.16, 0.48, Math.cos(ang) * 1.16);
      pivot.rotation.y = ang;

      const shell = new THREE.Mesh(petalGeo, i % 2 === 0 ? hullPrimary : hullSecondary);
      shell.castShadow = true;
      const rib = new THREE.Mesh(ribGeo, gunmetal);
      rib.castShadow = true;
      rib.position.set(0, 1.15, -0.36);
      rib.rotation.x = 0.33;
      const nozzle = new THREE.Mesh(nozzleGeo, gunmetal);
      nozzle.castShadow = true;
      nozzle.position.set(0, 0.2, 0.06);
      nozzle.rotation.x = 0.45;

      pivot.add(shell, rib, nozzle);
      this.egressGroup.add(pivot);
      this.petals.push({ pivot, isFront: i === 0 });
    }

    this.rampPivot = new THREE.Group();
    this.rampPivot.position.set(0, 0.5, 0.96);
    const rampPlate = new THREE.Mesh(this.trackGeo(new RoundedBoxGeometry(0.84, 0.07, 1.32, 2, 0.02)), gunmetal);
    rampPlate.castShadow = true;
    rampPlate.position.set(0, 0, 0.64);
    const stripGeo = this.trackGeo(new RoundedBoxGeometry(0.055, 0.035, 1.16, 1, 0.01));
    const stripL = new THREE.Mesh(stripGeo, this.coreLightMat);
    stripL.position.set(-0.34, 0.035, 0.64);
    const stripR = new THREE.Mesh(stripGeo, this.coreLightMat);
    stripR.position.set(0.34, 0.035, 0.64);
    this.rampPivot.add(rampPlate, stripL, stripR);
    this.egressGroup.add(this.rampPivot);
  }

  update(u: PodImpactRigUpdate): void {
    this.root.position.copy(u.pos);
    this.craterGroup.visible = u.craterVisible;

    if (u.craterVisible) {
      const punch = smoother(0, 0.14, u.sinceTouchdown);
      this.craterGroup.scale.setScalar(0.35 + 0.65 * punch);
      const cool = 1 - smoothstep(0.2, 4.5, u.sinceTouchdown);
      this.emberMat.emissiveIntensity = 4.6 * cool;
    }

    const waveActive = u.craterVisible && u.sinceTouchdown >= 0 && u.sinceTouchdown < 1.6;
    this.waveGroup.visible = waveActive;
    if (waveActive) {
      this.updateWaves(u.sinceTouchdown);
    }

    this.egressGroup.visible = u.egressRigVisible;
    if (u.egressRigVisible) {
      this.updateEgress(u.yaw, u.podOpenProgress, u.podDismantleProgress);
    }
  }

  private updateWaves(t: number): void {
    const sw = clamp(t / 0.75, 0, 1);
    this.shockwaveMesh.visible = sw < 1;
    this.shockwaveMesh.scale.setScalar(0.75 + 6.2 * smoothstep(0, 1, sw));
    this.shockwaveMat.opacity = 0.9 * (1 - sw) * (1 - sw);

    const dw = clamp(t / 1.45, 0, 1);
    this.dustRingMesh.visible = dw < 1;
    this.dustRingMesh.scale.setScalar(0.65 + 4.1 * smoothstep(0, 1, dw));
    this.dustRingMat.opacity = 0.68 * Math.sin(dw * Math.PI) * (1 - 0.5 * dw);

    for (const d of this.flyingDebris) {
      const age = clamp(t, 0, 1.35);
      const r = d.r0 + d.speed * (1 - Math.exp(-age * 2.2));
      const y = Math.max(0.06, 0.15 + d.vy * age - 0.5 * 13.5 * age * age);
      d.mesh.position.set(Math.cos(d.ang) * r, y, Math.sin(d.ang) * r);
      d.mesh.rotation.set(d.rotSpeed.x * age, d.rotSpeed.y * age, d.rotSpeed.z * age);
      const fade = 1 - smoothstep(1.0, 1.35, t);
      d.mesh.scale.setScalar(Math.max(0.001, fade));
    }
  }

  private updateEgress(yaw: number, open: number, dismantle: number): void {
    this.egressGroup.rotation.y = yaw;
    this.egressGroup.position.y = -2.3 * dismantle;
    this.egressGroup.scale.setScalar(Math.max(0.01, 1 - 0.55 * dismantle));
    this.coreLightMat.emissiveIntensity = 4.0 * open * (1 - dismantle);

    for (const p of this.petals) {
      const maxAng = p.isFront ? 1.56 : 1.44;
      p.pivot.rotation.x = maxAng * open;
    }
    this.rampPivot.rotation.x = -1.25 + 1.52 * open;
  }

  setSettled(pos?: THREE.Vector3): void {
    if (pos) this.root.position.copy(pos);
    this.waveGroup.visible = false;
    this.egressGroup.visible = false;
    if (this.craterGroup.visible) {
      this.craterGroup.scale.setScalar(1);
      this.emberMat.emissiveIntensity = 0;
    }
  }

  hide(): void {
    this.craterGroup.visible = false;
    this.waveGroup.visible = false;
    this.egressGroup.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
  }
}
