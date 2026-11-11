import { BountyClaimedData } from '../bounty';
import { defineEvent } from './define';

export const BountyClaimedDataSchema = BountyClaimedData;

export const event = defineEvent({
  kind: 'bountyClaimed',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: BountyClaimedData,
  summary: 'A colony or mercenary registered as a claimer of an open bounty (W22-02, NEAR-111).',
});
