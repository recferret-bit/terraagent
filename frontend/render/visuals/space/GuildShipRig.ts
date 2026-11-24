import * as THREE from 'three';
import { createDropRig, type DropRig } from '../../descent/dropRig';
import { createFlames, type Flames, type Nozzle } from '../../descent/Flames';
import { acquireModel, tickArchetypeMesh, type FittedModel } from './placeholders';

/**
 * Scale factor mapping `createDropRig` descent-pod coordinates onto the compact 18 m `ship.guildTrader` belly collar.
 */
const HULL_SCALE = 0.35;
/** Retro plumes are authored for the drop pod (~6.5 m). This brings them cleanly under the trader's 4 VTOL nozzles. */
const FLAME_SCALE = 0.45;
/** Skids sit at the fitted root's y = 0. Clearance so a docked ship reads as hovering, not buried. */
export const GUILD_HOVER_M = 1.6;

interface PartRange {
  name: string;
  start: number;
  count: number;
}

export interface GuildShipPlace {
  x: number;
  y: number;
  z: number;
  /** Metres above the hover height. 0 when docked. */
  altitudeM: number;
  /** Group bob in metres. */
  bobM: number;
  /** 0..1 retro-flame intensity. */
  flame: number;
  /** Seconds, for the flame shader and the radar/rotor spin. */
  time: number;
  /** Radians, nose (+Z) toward the hub. */
  yaw: number;
}

/**
 * One `ship.guildTrader` on the colony scene. The drop rig's bay and clamps mount flush onto the ventral cargo collar
 * (`attachPod: false`), and retro flames emit from the ship's four physical VTOL belly nozzles.
 */
export class GuildShipRig {
  readonly root: THREE.Group;
  private readonly model: FittedModel;
  private readonly drop: DropRig;
  private readonly flames: Flames;

  constructor(biomeKey: string) {
    this.model = acquireModel('ship.guildTrader', biomeKey);
    this.root = this.model.root;
    this.root.name = 'guild-ship';
    this.drop = createDropRig(this.root, {
      biomeKey,
      carrierScale: 1 / HULL_SCALE,
      attachPod: false,
    });
    const collarAnchor = measurePartAnchor(this.model.mesh, 'belly cargo collar');
    if (collarAnchor) {
      this.drop.group.position.set(collarAnchor.cx, collarAnchor.minY + 0.02, collarAnchor.cz);
    }
    this.drop.setOpen(1.15);
    this.drop.setBayGlow(0.35);
    this.flames = createFlames(bellyNozzles(this.model.mesh, FLAME_SCALE));
    this.flames.group.scale.setScalar(FLAME_SCALE);
    this.root.add(this.flames.group);
  }

  place(p: GuildShipPlace): void {
    this.root.position.set(p.x, p.y + GUILD_HOVER_M + p.altitudeM + p.bobM, p.z);
    this.root.rotation.y = p.yaw;
    const burn = p.flame > 0.02;
    this.flames.group.visible = burn;
    this.flames.u.uI.value = p.flame;
    this.flames.u.uTime.value = p.time;
    this.drop.setBayGlow(0.35 + p.flame * 2.2);
    tickArchetypeMesh(this.model.mesh, p.time, 0);
  }

  dispose(): void {
    this.flames.dispose();
    this.drop.dispose();
    this.model.dispose();
  }
}

function measurePartBoundsInRoot(mesh: THREE.Object3D, pred: (name: string) => boolean) {
  const m = mesh as THREE.Mesh;
  const pos = m.geometry?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
  const ranges = m.geometry?.userData?.partRanges as PartRange[] | undefined;
  if (!pos || !ranges) return [];
  const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;
  const out: Array<{ cx: number; minY: number; cz: number }> = [];
  for (const r of ranges) {
    if (!pred(r.name) || r.count <= 0) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    const end = Math.min(pos.count, r.start + r.count);
    for (let i = r.start; i < end; i++) {
      const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (Number.isFinite(minY)) out.push({ cx: (minX + maxX) * 0.5, minY, cz: (minZ + maxZ) * 0.5 });
  }
  return out;
}

function measurePartAnchor(mesh: THREE.Object3D, exactName: string) {
  return measurePartBoundsInRoot(mesh, (n) => n === exactName)[0] ?? null;
}

/** Downward VTOL nozzles in flame-group space (`vtol belly nozzle` parts when available, bbox fallback otherwise). */
function bellyNozzles(mesh: THREE.Object3D, scale: number): Nozzle[] {
  const down = new THREE.Vector3(0, -1, 0);
  const matched = measurePartBoundsInRoot(mesh, (n) => n === 'vtol belly nozzle');
  if (matched.length >= 2) {
    return matched.map((b) => ({
      pos: new THREE.Vector3(b.cx / scale, (b.minY + 0.02) / scale, b.cz / scale),
      dir: down.clone(),
    }));
  }
  const box = new THREE.Box3().setFromObject(mesh);
  const spanX = box.max.x - box.min.x;
  const spanZ = box.max.z - box.min.z;
  const y = box.min.y + 0.05;
  const xs = [box.min.x + spanX * 0.32, box.max.x - spanX * 0.32];
  const zs = [box.min.z + spanZ * 0.28, box.min.z + spanZ * 0.55];
  const nozzles: Nozzle[] = [];
  for (const x of xs) {
    for (const z of zs) {
      nozzles.push({ pos: new THREE.Vector3(x / scale, y / scale, z / scale), dir: down.clone() });
    }
  }
  return nozzles;
}
