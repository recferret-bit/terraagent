import { BountyRefundedData } from '../bounty';
import { defineEvent } from './define';

export const BountyRefundedDataSchema = BountyRefundedData;

export const event = defineEvent({
  kind: 'bountyRefunded',
  wave: 'W22',
  severity: 'warn',
  audience: 'player',
  data: BountyRefundedData,
  summary: 'An expired, cancelled, or failed bounty returned its reward to the poster (W22-02, NEAR-110).',
});
