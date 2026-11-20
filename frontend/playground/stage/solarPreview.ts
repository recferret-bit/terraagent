import { setDayNightParams } from '@terra/render/core/dayNightConfig';

/** Sun is well up. The storybook Day button uses this so a saved night hour cannot leave the model black. */
export const STORYBOOK_DAY_HOUR = 10.5;
/** Midnight. Night uses the real solar night, then the bulbs and beams turn on. */
export const STORYBOOK_NIGHT_HOUR = 0;

/**
 * Pin the solar clock for the storybook preview. `sync` does not write the game's saved hour.
 * The clock stays paused so the preview does not drift into dusk.
 */
export function pinStorybookSolar(night: boolean): void {
  setDayNightParams({
    timeOfDay: night ? STORYBOOK_NIGHT_HOUR : STORYBOOK_DAY_HOUR,
    timeScale: 0,
  }, 'sync');
}
