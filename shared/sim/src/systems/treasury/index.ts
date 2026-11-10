import { defineSimModule } from '../define';
import { treasuryHazardSystem } from './clock';
import { treasuryEffectHandler } from './handler';

export { TREASURY_BLOB, readTreasury, type TreasuryBlobValue, type TreasuryEffectRecord } from './blob';

/** Council effects on the planet. Duration is `untilTick` (the sim has no wall clock). */
export default defineSimModule({
  id: 'treasury',
  wave: 'W22',
  handlers: [treasuryEffectHandler],
  systems: [treasuryHazardSystem],
});
