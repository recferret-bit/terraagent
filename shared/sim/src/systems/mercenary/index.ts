import { defineSimModule } from '../define';
import { mercenarySpawnHandler } from './spawn';
import { mercenarySquadSystem } from './step';

export { MERCENARY_FACTION, MERCENARY_OWNER, mercenaryAlliedTo, readMercenary } from './blob';

/**
 * Mercenary squads (W22-29, NEAR-112). `mercenary.spawn` places `robot.recon` on the poster hub edge.
 * They hold the defend area and leave at `endTick` or when every recon is dead. Supply stays with the poster at 0.
 */
export default defineSimModule({
  id: 'mercenary',
  wave: 'W22',
  handlers: [mercenarySpawnHandler],
  systems: [mercenarySquadSystem],
});
