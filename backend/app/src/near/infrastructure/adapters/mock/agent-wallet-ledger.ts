/** Pure allowance math shared with the in-memory fake. Implementation lives outside `adapters/`. */
export {
  ZERO_ALLOWANCE,
  availableOf,
  decimalToBigInt,
  nextAllowance,
  toAllowanceView,
} from '../../../agent-wallet/ledger.js';
export type { AllowanceMove, AllowanceTotals } from '../../../agent-wallet/ledger.js';
