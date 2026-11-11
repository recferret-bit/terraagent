import * as THREE from 'three';
import { createDropRig, type DropRig } from '../../descent/dropRig';
import { createFlames, type Flames, type Nozzle } from '../../descent/Flames';
import { acquireModel, tickArchetypeMesh, type FittedModel } from './placeholders';

/**
 * Guild hull vertices are already scaled by 0.35 (`ship.guildTrader`). `createDropRig` sizes itself in descent
 * world metres and then divides by `carrierScale`, so 1/0.35 puts the bay on the same scale as this hull.
 */
const HULL_SCALE = 0.35;
/** Retro plumes are authored for the drop pod (~6.5 m). This brings them under the trader's belly. */
const FLAME_SCALE = 0.45;
/** Skids sit at the fitted root's y = 0. Clearance so a docked ship reads as hovering, not buried. */
export const GUILD_HOVER_M = 1.6;

export interface GuildShipPlace {
  x: number;
  y: number;
  z: number;
  /** Metres above the hover height. 0 when docked. */
  altitudeM: number;
  /** Group bob in metres. The hull has no HoverBob channel (dishes only spin). */
  bobM: number;
  /** 0..1 retro-flame intensity. */
  flame: number;
  /** Seconds, for the flame shader and the dish spin. */
  time: number;
  /** Radians, nose (+Z) toward the hub. */
  yaw: number;
}

/**
 * One `ship.guildTrader` on the colony scene. The drop rig's bay and clamps hang under the hull (`attachPod: false`,
 * same call the descent uses). Flames point down. Callers parent `root` (the fitted group).
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
    this.drop.setOpen(0);
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

/** Four downward nozzles on the belly, in flame-group space (the group is scaled by `scale`). */
function bellyNozzles(mesh: THREE.Object3D, scale: number): Nozzle[] {
  const box = new THREE.Box3().setFromObject(mesh);
  const spanX = box.max.x - box.min.x;
  const spanZ = box.max.z - box.min.z;
  const y = box.min.y + 0.05;
  const xs = [box.min.x + spanX * 0.32, box.max.x - spanX * 0.32];
  const zs = [box.min.z + spanZ * 0.28, box.min.z + spanZ * 0.55];
  const down = new THREE.Vector3(0, -1, 0);
  const nozzles: Nozzle[] = [];
  for (const x of xs) {
    for (const z of zs) {
      nozzles.push({ pos: new THREE.Vector3(x / scale, y / scale, z / scale), dir: down.clone() });
    }
  }
  return nozzles;
}
