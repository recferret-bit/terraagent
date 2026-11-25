import type { ArchetypeLightSource } from './archetypeLights';

type P = [number, number, number];
type Row = [string, P, P, number, number?, number?, number?];

/** One fixture. `pos` is the bulb; `target` is the ground or work the fixture actually faces. */
function src(id: string, pos: P, target: P, color: number, intensity = 1.15, range = 9, pool = 2.1): ArchetypeLightSource {
  return {
    id, pos, target, color, intensity, range,
    coneTopRadius: 0.12, coneBottomRadius: Math.min(pool, 1.55), poolRadius: pool,
  };
}

function rig(rows: readonly Row[]): ArchetypeLightSource[] {
  return rows.map(([id, pos, target, color, intensity, range, pool]) => src(id, pos, target, color, intensity, range, pool));
}

const AMBER = 0xffc56b;
const CYAN = 0x9ee6ff;
const CRIMSON = 0xff4466;

/**
 * Night projectors for every colony building. Each entry sits on that building's own bulb.
 * None of these is a copied four-corner flood. Mesh-only glows (rings, strips) are not listed.
 */
export const BUILDING_LIGHT_RIGS: Readonly<Record<string, readonly ArchetypeLightSource[]>> = {
  'building.commandHub': rig([
    ['airlock header', [-0.2, 0.825, 2.08], [-0.2, 0.02, 4.6], AMBER, 1.2, 10, 2.4],
    ['antenna beacon', [1.35, 6.46, -1.75], [1.0, 0.02, -1.4], CRIMSON, 1.05, 8, 1.8],
  ]),
  'building.claimBeacon': rig([
    ['beacon crystal', [0, 2.75, 0], [0, 0.02, 1.8], CYAN, 1.2, 8, 1.9],
  ]),
  'building.pylon': rig([
    ['grid core', [0, 5.55, 0], [0, 0.02, 0], CYAN, 1.1, 8.5, 2.0],
  ]),
  'building.capacitor': rig([
    ['terminal sphere', [0, 3.7, 0.45], [0, 0.02, 1.8], CYAN, 1.1, 7.5, 1.7],
  ]),
  'building.solar': rig([
    ['inverter beacon', [0.45, 0.92, 1.86], [0, 0.02, 3.4], CYAN, 1.05, 7.5, 1.8],
  ]),
  'building.wind': rig([
    ['aviation light', [0, 6.72, 0], [0, 0.02, 0], CRIMSON, 1.05, 8, 1.7],
  ]),
  'building.coalGen': rig([
    ['furnace ember', [-0.3, 0.65, 0.73], [-0.3, 0.02, 2.4], AMBER, 1.25, 8, 2.0],
    ['stack flue', [-0.3, 5.4, -0.3], [-0.3, 0.02, -0.3], AMBER, 0.95, 7, 1.5],
  ]),
  'building.mine': rig([
    ['derrick beacon', [0, 5.95, 0], [0, 0.02, 2.2], AMBER, 1.15, 9, 2.0],
  ]),
  'building.waterPump': rig([
    ['tower beacon', [0, 4.29, -0.2], [0, 0.02, 1.6], AMBER, 1.1, 8, 1.8],
  ]),
  'building.supplyDepot': rig([
    ['shutter header', [-0.1, 1.1, 0.46], [-0.1, 0.02, 2.6], AMBER, 1.15, 8, 2.1],
  ]),
  'building.tradeHub': rig([
    ['customs status', [0.8, 0.95, -0.02], [-0.85, 0.02, 1.4], CYAN, 1.1, 8, 1.9],
    ['gantry beacon', [1.68, 2.84, 1.65], [0.95, 0.02, 1.05], AMBER, 1.05, 8, 1.8],
  ]),
  'building.droneArray': rig([
    ['tower deck beacon', [0, 2.96, 0.12], [0.3, 0.02, 1.6], CRIMSON, 1.1, 8, 1.8],
  ]),
  'building.roboticsFactory': rig([
    ['bay door header', [-2.3, 1.5, 1.05], [-2.3, 0.02, 3.2], AMBER, 1.15, 9, 2.2],
  ]),
  'building.turret': rig([
    ['barbette hazard', [0, 0.75, 0.15], [0, 0.02, 3.4], AMBER, 1.1, 8, 1.8],
  ]),
  'building.laserTower': rig([
    ['aperture lens', [0, 2.3, 0.91], [0, 1.4, 5.2], CRIMSON, 1.2, 9, 1.4],
  ]),
  'building.rocket': rig([
    ['gantry aviation', [2.38, 10.15, 0], [2.3, 0.02, 0], CRIMSON, 1.05, 9, 1.8],
  ]),
  'building.sensorArray': rig([
    ['sensor cabin header', [-0.15, 0.88, 1.10], [-0.15, 0.02, 3.2], 0x22d3ee, 1.05, 7, 1.7],
  ]),
};

/** Ids that must have an explicit rig. Kept next to the table so a new building cannot inherit another rig. */
export const BUILDING_LIGHT_IDS: readonly string[] = Object.keys(BUILDING_LIGHT_RIGS);
