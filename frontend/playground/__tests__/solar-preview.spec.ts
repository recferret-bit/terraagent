import { describe, expect, it } from 'vitest';
import { getDayNightParams } from '@terra/render/core/dayNightConfig';
import { pinStorybookSolar, STORYBOOK_DAY_HOUR, STORYBOOK_NIGHT_HOUR } from '../stage/solarPreview';

describe('storybook solar preview', () => {
  it('puts the sun up for day and at midnight for night without leaving the clock running', () => {
    pinStorybookSolar(false);
    expect(getDayNightParams().timeOfDay).toBe(STORYBOOK_DAY_HOUR);
    expect(getDayNightParams().timeScale).toBe(0);

    pinStorybookSolar(true);
    expect(getDayNightParams().timeOfDay).toBe(STORYBOOK_NIGHT_HOUR);
    expect(getDayNightParams().timeScale).toBe(0);
  });
});
