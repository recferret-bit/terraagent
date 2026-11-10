import { BountyPostedData } from '../bounty';
import { defineEvent } from './define';

export const BountyPostedDataSchema = BountyPostedData;

export const event = defineEvent({
  kind: 'bountyPosted',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: BountyPostedData,
  summary: 'A colony posted a bounty and the reward is held in escrow (W22-02, NEAR-110).',
});
