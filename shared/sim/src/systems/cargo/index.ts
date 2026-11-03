import { defineSimModule } from '../define';
import {
  devCargoCapResetHandler,
  devCargoGrantHandler,
  devTradehubSpawnHandler,
} from './dev-commands';
import { devContactFakeHandler } from './unlock';

export * from './caps';
export * from './dev-commands';
export * from './unlock';

export default defineSimModule({
  id: 'cargo',
  wave: 'W10',
  handlers: [
    devContactFakeHandler,
    devTradehubSpawnHandler,
    devCargoCapResetHandler,
    devCargoGrantHandler,
  ],
});
