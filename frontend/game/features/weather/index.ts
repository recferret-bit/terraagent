import { defineFeature } from '../../core/registry/types';
import { WEATHER_DEV_COMMANDS } from './commands';
import { weatherRendererDef } from './weatherRenderer';

export * from './commands';
export * from './weatherRenderer';

export const weatherFeature = defineFeature({
  id: 'weather',
  wave: 'W05',
  devCommands: WEATHER_DEV_COMMANDS,
  renderers: [weatherRendererDef],
});

export default weatherFeature;
