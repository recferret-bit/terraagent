import { defineSimModule } from '../define';
import { defendAreaSystem } from './defend';
import { bountyClaimHandler, bountyPaidHandler, bountyPostHandler } from './handlers';

export { BOUNTY_BLOB, bountyAudience, bountyColonyId, readBounty, type BountyBlobValue, type BountyRecord, type BountyState } from './blob';
export { noteClearNestHit } from './damage';
export { noteDefendBuildingLost } from './defend';
export { resolveClearNests } from './resolve';

/**
 * Bounty tracking (W22-20 clear_nest, W22-21 defend_area, NEAR-111).
 * `applyDamage` calls `noteClearNestHit` when a hive loses HP and `noteDefendBuildingLost` when a building falls.
 * `bounty.defend` (slot 11, after combat) counts claimer presence. The sim does not move cargo.
 */
export default defineSimModule({
  id: 'bounty',
  wave: 'W22',
  handlers: [bountyPostHandler, bountyClaimHandler, bountyPaidHandler],
  systems: [defendAreaSystem],
});
