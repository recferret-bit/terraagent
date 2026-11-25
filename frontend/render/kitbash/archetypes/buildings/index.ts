// Registers colony building archetypes. Order here is the ArchetypeCatalog.list() order.
import * as THREE from 'three';
import { ArchetypeCatalog } from '../../catalog';
import { commandHub, claimBeacon, HUB_UPLINK_TRIM, HUB_GOLD_TRIM, HUB_GOLD_TRIM_PARTS } from './hub';
import { pylon, capacitor, solar, wind, coalGen } from './power';
import { mine, waterPump, supplyDepot } from './industry';
import { tradeHub } from './trade';
import { droneArray, roboticsFactory, turret, laserTower } from './tech';
import { sensorArray } from './sensorArray';
import { rocket } from './rocket';

/** Footprints are in 2 m tiles (1x1 = 2m x 2m). Front of every building faces +Z. */
const reg = (id: string, label: string, create: () => THREE.BufferGeometry, footprint: [number, number], notes: string) =>
  ArchetypeCatalog.register({ id, label, category: 'building', create, footprint, notes: `${notes} Footprint in 2 m tiles.` });

reg('building.commandHub', 'Command Hub', commandHub, [3, 3], 'Hero: domed hull, armored airlock hood, flank cooling fins, roof field-comms aerial, tilted antenna beacon, rotating radar dish, tanks, guy cables.');
reg('building.commandHub.uplink', 'Command Hub (Tier 1-2 Uplink)', () => commandHub({ uplink: true, zones: { hullSecondary: HUB_UPLINK_TRIM } }), [3, 3], 'W28-12 staking prestige: orbital azure trim, tri-pylon focusing cage with dual halos, flank telemetry pods, larger spinning Quantum Dish and cyan uplink beam.');
reg('building.commandHub.gold', 'Command Hub (Tier 3+ Gold)', () => commandHub({ uplink: true, citadel: true, zones: { hullSecondary: HUB_GOLD_TRIM }, trimParts: HUB_GOLD_TRIM_PARTS }), [3, 3], 'W28-12 staking prestige: towering 4-rib sovereign gold cathedral spire, triple halo crowns, corner obelisks, grand entry portico and gold-cyan orbital beam.');
reg('building.claimBeacon', 'Claim Beacon', claimBeacon, [1, 1], 'Obelisk w/ spinning crystal, bobbing rings, banner.');
reg('building.pylon', 'Pylon', pylon, [1, 1], 'Lattice power pylon, insulator crossarms, sagging line cables.');
reg('building.capacitor', 'Capacitor', capacitor, [1, 1], 'Three cyan-banded cells with bus cables.');
reg('building.solar', 'Solar Array', solar, [2, 2], 'Two tilted hex-cell wings, inverter box, tracker mast.');
reg('building.wind', 'Wind Turbine', wind, [2, 2], 'Vertical-axis rotor (animType 1) on mast.');
reg('building.coalGen', 'Coal Generator', coalGen, [2, 2], 'Boiler drum, 3 stacks, hopper, conveyor, ember door.');
reg('building.mine', 'Mine', mine, [2, 2], 'Derrick with spinning drill string (animType 1), ore bin, hut.');
reg('building.waterPump', 'Water Pump', waterPump, [1, 1], 'Spherical water tower, pump house, pipes.');
reg('building.supplyDepot', 'Supply Depot', supplyDepot, [2, 2], 'Vaulted warehouse, crates, gantry crane.');
reg('building.tradeHub', 'Inter-Colony Trade Hub', tradeHub, [2, 2], 'Orbital cargo pad, logistics hall, container gantry, rotating uplink dish.');
reg('building.droneArray', 'Drone Control Array', droneArray, [2, 2], 'Tower + 3 rotating dishes, pads, hovering drone (animType 2).');
reg('building.sensorArray', 'Sensor Array', sensorArray, [2, 2], 'Low-profile Lanza 3D planar phased-array radar with IFF top bar, tactical shelter, cryo-cooler and 3 antennas (animType 1).');
reg('building.roboticsFactory', 'Robotics Factory', roboticsFactory, [4, 3], 'Sawtooth hall, roof gantry arm, conveyor w/ robot torso.');
reg('building.turret', 'Turret', turret, [1, 1], 'Target-driven turret head, independently aimed twin barrels and shot-driven recoil.');
reg('building.laserTower', 'Laser Tower', laserTower, [1, 1], 'Optical focus column, plasma rings, target-driven laser emitter head, power cell.');
reg('building.rocket', 'Rocket', rocket, [3, 3], 'Hero landmark: rocket on pad with lattice gantry, fuel sphere, umbilicals.');
