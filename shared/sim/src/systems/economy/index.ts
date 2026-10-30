import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { constructionSystem, demolishHandler } from './construction';
import { resourceShortageSystem } from './events';
import { ensureColonyLedger } from './ledger';

export * from './ledger';
export * from './construction';
export * from './events';

const ledgerInitSystem = defineSystem({
  id: 'economy.ledger',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    for (const colony of state.colonies) {
      const hadLedger = colony.stock !== undefined && colony.caps !== undefined && colony.production !== undefined;
      ensureColonyLedger(colony);
      if (!hadLedger) colony.changedAt = ctx.tick;
    }
  },
});

export default defineSimModule({
  id: 'economy',
  wave: 'W02',
  systems: [constructionSystem, ledgerInitSystem, resourceShortageSystem],
  handlers: [demolishHandler],
});
