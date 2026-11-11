import { BountyExpiredData } from '../bounty';
import { defineEvent } from './define';

export const BountyExpiredDataSchema = BountyExpiredData;

export const event = defineEvent({
  kind: 'bountyExpired',
  wave: 'W22',
  severity: 'warn',
  audience: 'player',
  data: BountyExpiredData,
  summary: 'A bounty passed `expiresAt` without being completed (W22-02, NEAR-110).',
});
