import { defineFeature } from '../../core/registry/types';
import { w01DevCommands } from './commands';

export * from './commands';

export default defineFeature({
  id: 'dev-console',
  wave: 'W01',
  devCommands: w01DevCommands,
});
