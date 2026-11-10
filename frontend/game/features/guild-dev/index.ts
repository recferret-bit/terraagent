import { defineFeature } from '../../core/registry/types';
import { guildDevCommands } from './commands';

/** W15 dev console. Hidden when the flag is off, and on `?host=local` (the rows live on the server). */
export default defineFeature({
  id: 'guild-dev',
  wave: 'W15',
  hostOnly: 'server',
  devCommands: [...guildDevCommands],
});
