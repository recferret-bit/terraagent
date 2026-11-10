import { TreasuryProposalFailedData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryProposalFailedDataSchema = TreasuryProposalFailedData;

export const event = defineEvent({
  kind: 'treasuryProposalFailed',
  wave: 'W22',
  severity: 'warn',
  audience: 'player',
  data: TreasuryProposalFailedData,
  summary: 'A treasury proposal was rejected or expired. No funds moved (W22-01, NEAR-102).',
});
