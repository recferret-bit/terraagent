import { defineSimModule } from '../define';
import {
  devCargoCapResetHandler,
  devCargoGrantHandler,
  devTradehubSpawnHandler,
} from './dev-commands';
import { cargoExportHandler } from './export';
import { cargoImportHandler } from './import';
import { devContactFakeHandler } from './unlock';

export * from './caps';
export * from './dev-commands';
export * from './unlock';
export * from './trade-hub';
export * from './state';
export * from './export';
export * from './import';

export default defineSimModule({
  id: 'cargo',
  wave: 'W10',
  handlers: [
    devContactFakeHandler,
    cargoExportHandler,
    cargoImportHandler,
    devTradehubSpawnHandler,
    devCargoCapResetHandler,
    devCargoGrantHandler,
  ],
});
