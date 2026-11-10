import { BountyPaidData } from '../bounty';
import { defineEvent } from './define';

export const BountyPaidDataSchema = BountyPaidData;

export const event = defineEvent({
  kind: 'bountyPaid',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: BountyPaidData,
  summary: 'Escrow released the reward to the claimer (W22-02, NEAR-111).',
});
