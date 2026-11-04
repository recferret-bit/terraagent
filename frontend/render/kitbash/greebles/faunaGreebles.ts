import * as THREE from 'three';
import { KitbashBuilder, KitbashRegistry, type MaterialZoneId, type PartOptions } from '../KitbashRegistry';
import { rbox, cyl, sph, mirror, type V3 } from './unitParts';

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function limbStrut(
  b: KitbashBuilder,
  a: V3,
  c: V3,
  r: number,
  zone: MaterialZoneId,
  opts: PartOptions = {},
  rEnd = r,
): void {
  const va = new THREE.Vector3(...a);
  const vc = new THREE.Vector3(...c);
  const dir = vc.clone().sub(va);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = va.clone().add(vc).multiplyScalar(0.5);
  b.addPart(cyl(rEnd, r, len, 6), zone, {
    ...opts,
    position: mid.toArray() as V3,
    rotation: [e.x, e.y, e.z],
  });
}

export interface BugLegRigParams {
  hx?: number;
  hy?: number;
  zPairs?: [number, number, number];
  footSpreadX?: number;
  footSpreadZ?: number;
  rHip?: number;
  rFemur?: number;
  rKnee?: number;
  rTibia?: number;
  rFoot?: number;
  kneeSpurs?: boolean;
}

/**
 * Reusable 6-legged insect locomotion rig (`animType = 6` femur + `animType = 16` tibia/tarsus)
 * coupled to `SpiderBody` (`animType = 9`) at thorax hip sockets with alternating tripod phase
 * across the three leg pairs (`phase = (px >= 0 ? 0 : π) + pz * 4.9`).
 */
KitbashRegistry.registerGreeble('bugSixLegs', (params: BugLegRigParams, b: KitbashBuilder) => {
  const hx = Math.max(0.25, params.hx ?? 0.26);
  const hy = params.hy ?? 0.62;
  const zPairs = params.zPairs ?? [0.34, 0.0, -0.34];
  const footSpreadX = params.footSpreadX ?? 0.11;
  const footSpreadZ = params.footSpreadZ ?? 1.60;
  const rHip = params.rHip ?? 0.088;
  const rFemur = params.rFemur ?? 0.032;
  const rKnee = params.rKnee ?? 0.068;
  const rTibia = params.rTibia ?? 0.022;
  const rFoot = params.rFoot ?? 0.074;

  mirror((s) => {
    zPairs.forEach((hz, idx) => {
      const hip: V3 = [hx * s, hy, hz];
      const knee: V3 = [2 * hx * s, hy + 0.24, 1.5 * hz];
      const femurStart: V3 = [(hx + rHip * 0.72) * s, hy + 0.045, hz * 1.08];
      const femurEnd: V3 = [(2 * hx - 0.024) * s, hy + 0.22, hz * 1.46];
      const tibiaStart: V3 = [(2 * hx + 0.008) * s, hy + 0.21, hz * 1.50];
      const footTop: V3 = [(2 * hx + footSpreadX) * s, 0.07, hz * footSpreadZ];

      const femurAnim = { animType: 6 as const, animPivot: hip };
      const tibiaAnim = { animType: 16 as const, animPivot: hip };

      b.addPart(sph(rHip, 6, 5), 'frameGunmetal', { name: `leg hip ${idx + 1}`, position: hip, ...femurAnim });
      limbStrut(b, femurStart, femurEnd, rFemur, 'rubberDark', { name: `leg femur ${idx + 1}`, ...femurAnim }, rFemur * 1.15);
      b.addPart(sph(rKnee, 6, 5), 'frameGunmetal', { name: `leg knee ${idx + 1}`, position: knee, ...tibiaAnim });
      if (params.kneeSpurs && idx === 0) {
        b.addPart(box(0.055, 0.04, 0.085), 'hullSecondary', {
          name: `leg knee spur ${idx + 1}`,
          position: [knee[0], knee[1] + rKnee * 0.78, knee[2]],
          ...tibiaAnim,
        });
      }
      limbStrut(b, tibiaStart, footTop, rTibia, 'rubberDark', { name: `leg tibia ${idx + 1}`, ...tibiaAnim }, rTibia * 1.35);
      b.addPart(cyl(rFoot * 0.78, rFoot, 0.08, 6), 'rubberDark', {
        name: `leg foot ${idx + 1}`,
        position: [footTop[0], 0.04, footTop[2]],
        ...tibiaAnim,
      });
      b.addPart(cyl(rFoot * 0.88, rFoot * 0.88, 0.026, 6), 'hullSecondary', {
        name: `leg foot rim ${idx + 1}`,
        position: [footTop[0], 0.075, footTop[2]],
        ...tibiaAnim,
      });
    });
  });
});

export interface HiveTunnelEntranceParams {
  position?: V3;
  yaw?: number;
  width?: number;
  height?: number;
  depth?: number;
  accentZone?: MaterialZoneId;
  name?: string;
}

/**
 * Reusable 3D recessed burrow entrance assembly (`procedural-hive-3d`):
 * threshold trail apron (offset 8 mm above y = 0 so it never z-fights the mound base), flanking chitin/earth
 * arch pillars, overhanging brow lip, recessed dark `rubberDark` tunnel cavity, and bioluminescent marker.
 */
KitbashRegistry.registerGreeble('hiveTunnelEntrance', (params: HiveTunnelEntranceParams, b: KitbashBuilder) => {
  const [px, py, pz] = params.position ?? [0, 0, 1.0];
  const yaw = params.yaw ?? 0;
  const w = params.width ?? 0.56;
  const h = params.height ?? 0.48;
  const d = params.depth ?? 0.36;
  const accentZone = params.accentZone ?? 'warningAmber';
  const label = params.name ?? 'tunnel entrance';

  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
  const place = (lx: number, ly: number, lz: number): V3 => {
    const v = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
    return [px + v.x, py + v.y, pz + v.z];
  };
  const rot = (rx = 0, ry = 0, rz = 0): V3 => [rx, yaw + ry, rz];

  const pillarW = Math.max(0.11, w * 0.24);
  const innerW = w - pillarW * 0.7;

  b.addPart(rbox(w + pillarW * 1.1, 0.072, d + 0.26, 0.02, 1), 'frameGunmetal', {
    name: `${label} trail apron`,
    position: place(0, 0.044, 0.08),
    rotation: rot(),
  });
  b.addPart(rbox(innerW, h - 0.04, d * 0.72, 0.03, 1), 'rubberDark', {
    name: `${label} recessed cavity`,
    position: place(0, 0.06 + (h - 0.04) * 0.5, -0.02),
    rotation: rot(),
  });
  for (const sx of [-1, 1] as const) {
    b.addPart(rbox(pillarW, h + 0.04, d, 0.035, 1), 'hullPrimary', {
      name: `${label} arch pillar`,
      position: place(sx * (innerW * 0.5 + pillarW * 0.32), 0.06 + (h + 0.04) * 0.5, 0.02),
      rotation: rot(0, 0, -sx * 0.08),
    });
  }
  b.addPart(rbox(w + pillarW * 0.9, 0.11, d + 0.08, 0.03, 1), 'hullSecondary', {
    name: `${label} brow lip`,
    position: place(0, 0.06 + h + 0.03, 0.04),
    rotation: rot(0.1, 0, 0),
  });
  b.addPart(sph(0.052, 8, 6), accentZone, {
    name: `${label} marker light`,
    position: place(0, 0.06 + h + 0.10, d * 0.5 + 0.04),
    emissiveIntensity: 3.8,
  });
});

export interface HiveChimneyStackParams {
  position?: V3;
  height?: number;
  baseRadius?: number;
  topRadius?: number;
  accentZone?: MaterialZoneId;
  name?: string;
}

/**
 * Reusable rooted hive chimney stack with collared lip and glowing inner throat (`procedural-hive-3d`).
 */
KitbashRegistry.registerGreeble('hiveChimneyStack', (params: HiveChimneyStackParams, b: KitbashBuilder) => {
  const [x, y, z] = params.position ?? [0, 0, 0];
  const h = params.height ?? 1.20;
  const rb = params.baseRadius ?? 0.28;
  const rt = params.topRadius ?? 0.19;
  const accentZone = params.accentZone ?? 'terraformEmerald';
  const label = params.name ?? 'hive chimney';
  const topY = y + h;

  b.addPart(cyl(rt, rb, h, 10), 'hullPrimary', {
    name: `${label} column`,
    position: [x, y + h * 0.5, z],
  });
  b.addPart(cyl(rb * 0.92, rb * 0.96, 0.08, 10), 'hullSecondary', {
    name: `${label} mid band`,
    position: [x, y + h * 0.52, z],
  });
  b.addPart(cyl(rt * 1.24, rt * 1.08, 0.08, 10), 'frameGunmetal', {
    name: `${label} top lip`,
    position: [x, topY + 0.02, z],
  });
  b.addPart(cyl(rt * 0.78, rt * 0.72, 0.05, 10), accentZone, {
    name: `${label} throat light`,
    position: [x, topY + 0.065, z],
    emissiveIntensity: 3.8,
  });
});
