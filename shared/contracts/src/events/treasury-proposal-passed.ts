import { TreasuryProposalPassedData } from '../treasury';
import { defineEvent } from './define';

export const TreasuryProposalPassedDataSchema = TreasuryProposalPassedData;

export const event = defineEvent({
  kind: 'treasuryProposalPassed',
  wave: 'W22',
  severity: 'info',
  audience: 'player',
  data: TreasuryProposalPassedData,
  summary: 'A treasury proposal passed and its cost left the DAO (W22-01, NEAR-102).',
});
