// Registers colony building archetypes. Order here is the ArchetypeCatalog.list() order.
import * as THREE from 'three';
import { ArchetypeCatalog } from '../../catalog';
import { commandHub, claimBeacon } from './hub';
import { pylon, capacitor, solar, wind, coalGen } from './power';
import { mine, waterPump, supplyDepot } from './industry';
import { droneArray, roboticsFactory, turret } from './tech';
import { rocket } from './rocket';

/** Footprints are in 2 m tiles (1x1 = 2m x 2m). Front of every building faces +Z. */
const reg = (id: string, label: string, create: () => THREE.BufferGeometry, footprint: [number, number], notes: string) =>
  ArchetypeCatalog.register({ id, label, category: 'building', create, footprint, notes: `${notes} Footprint in 2 m tiles.` });

reg('building.commandHub', 'Command Hub', commandHub, [3, 3], 'Hero: domed hull, landing pad, tilted antenna, rotating radar dish, tanks, guy cables.');
reg('building.claimBeacon', 'Claim Beacon', claimBeacon, [1, 1], 'Obelisk w/ spinning crystal, bobbing rings, banner.');
reg('building.pylon', 'Pylon', pylon, [1, 1], 'Lattice power pylon, insulator crossarms, sagging line cables.');
reg('building.capacitor', 'Capacitor', capacitor, [1, 1], 'Three cyan-banded cells with bus cables.');
reg('building.solar', 'Solar Array', solar, [2, 2], 'Two tilted hex-cell wings, inverter box, tracker mast.');
reg('building.wind', 'Wind Turbine', wind, [2, 2], 'Vertical-axis rotor (animType 1) on mast.');
reg('building.coalGen', 'Coal Generator', coalGen, [2, 2], 'Boiler drum, 3 stacks, hopper, conveyor, ember door.');
reg('building.mine', 'Mine', mine, [2, 2], 'Derrick with spinning drill string (animType 1), ore bin, hut.');
reg('building.waterPump', 'Water Pump', waterPump, [1, 1], 'Spherical water tower, pump house, pipes.');
reg('building.supplyDepot', 'Supply Depot', supplyDepot, [2, 2], 'Vaulted warehouse, crates, gantry crane.');
reg('building.droneArray', 'Drone Control Array', droneArray, [2, 2], 'Tower + 3 rotating dishes, pads, hovering drone (animType 2).');
reg('building.roboticsFactory', 'Robotics Factory', roboticsFactory, [4, 3], 'Sawtooth hall, roof gantry arm, conveyor w/ robot torso.');
reg('building.turret', 'Turret', turret, [1, 1], 'Rotating sensor head (1), twin barrels (animType 3 recoil).');
reg('building.rocket', 'Rocket', rocket, [3, 3], 'Hero landmark: rocket on pad with lattice gantry, fuel sphere, umbilicals.');
