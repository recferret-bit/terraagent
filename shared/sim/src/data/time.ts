import { defineTable } from './_define';

/**
 * Planetary day/night cycle and time-scale configuration (synced across server & client).
 * `realHoursPerDay` configures how many real-world hours (at `timeScale = 1`) one full 24h planetary solar cycle takes.
 * `timeScale` scales planetary time progression relative to real elapsed simulation time.
 * `startHour` is the initial planetary solar hour (`0..24`, where `6` = dawn, `12` = solar noon, `18` = dusk).
 */
export default defineTable({
  name: 'time',
  summary: 'Planetary solar cycle duration (real hours per day) and time scale.',
  rows: [
    {
      id: 'cycle',
      wave: 'W00',
      realHoursPerDay: 0.25,
      timeScale: 1,
      startHour: 9,
      dawnHour: 5.5,
      duskHour: 18.5,
    },
  ],
});
