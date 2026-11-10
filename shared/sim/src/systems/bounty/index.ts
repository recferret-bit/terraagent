import { defineSimModule } from '../define';
import { bountyClaimHandler, bountyPaidHandler, bountyPostHandler } from './handlers';

export { BOUNTY_BLOB, bountyAudience, bountyColonyId, readBounty, type BountyBlobValue, type BountyRecord, type BountyState } from './blob';
export { noteClearNestHit } from './damage';
export { resolveClearNests } from './resolve';

/**
 * clear_nest tracking (W22-20, NEAR-111).
 * `applyDamage` calls `noteClearNestHit` when a hive loses HP. No per-tick system.
 * The sim does not move cargo. `bountyRefunded` / `bountyCompleted` are the signals the server pays on.
 */
export default defineSimModule({
  id: 'bounty',
  wave: 'W22',
  handlers: [bountyPostHandler, bountyClaimHandler, bountyPaidHandler],
});
