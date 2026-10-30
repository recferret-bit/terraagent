import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { ensureColonyLedger } from './ledger';

export * from './ledger';

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
  systems: [ledgerInitSystem],
});
