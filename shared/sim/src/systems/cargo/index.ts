import { defineSimModule } from '../define';
import { devContactFakeHandler } from './unlock';

export * from './caps';
export * from './unlock';

export default defineSimModule({
  id: 'cargo',
  wave: 'W10',
  handlers: [devContactFakeHandler],
});
