import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import {
  cancelTruceHandler,
  devOfferTruceHandler,
  proposeTruceHandler,
  respondTruceHandler,
} from './handlers';
import { stepDiplomacy } from './operations';

export * from './store';
export * from './rules';
export * from './operations';
export * from './handlers';

export const diplomacySystem = defineSystem({
  id: 'diplomacy.manager',
  slot: 11,
  wave: 'W18',
  run(state, ctx) {
    stepDiplomacy(state, ctx);
  },
});

export const diplomacy = defineSimModule({
  id: 'diplomacy',
  wave: 'W18',
  systems: [diplomacySystem],
  handlers: [proposeTruceHandler, respondTruceHandler, cancelTruceHandler, devOfferTruceHandler],
});

export default diplomacy;
