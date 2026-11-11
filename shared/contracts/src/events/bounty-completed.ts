import { BountyCompletedData } from '../bounty';
import { defineEvent } from './define';

export const BountyCompletedDataSchema = BountyCompletedData;

export const event = defineEvent({
  kind: 'bountyCompleted',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: BountyCompletedData,
  summary: 'The bounty target was met. `claimer` is who the escrow pays (W22-02, NEAR-111).',
});
