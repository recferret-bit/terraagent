import { defineParityCase } from './_define';

/**
 * W07 First Contact engine parity (`W00-58` / `W07-32`):
 * Both hosts build a Robotics Factory, Drone Control Array, Autocannon, Laser Tower, and queue Recon drones while
 * three passive species hives step their deterministic resident wandering.
 */
export default defineParityCase({
  scenario: 'w07',
  ticks: 300,
  log: [
    { atTick: 1, kind: 'enqueueTask', args: { task: { kind: 'build', building: 'roboticsFactory', q: 4, r: -4 } } },
    { atTick: 2, kind: 'enqueueTask', args: { task: { kind: 'build', building: 'droneControlArray', q: 2, r: -3 } } },
    { atTick: 3, kind: 'enqueueTask', args: { task: { kind: 'build', building: 'autocannon', q: 6, r: -2 } } },
    { atTick: 4, kind: 'enqueueTask', args: { task: { kind: 'build', building: 'laserTower', q: 6, r: -3 } } },
    { atTick: 5, kind: 'setRally', args: { q: 7, r: -2 } },
  ],
});
