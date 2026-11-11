/** Postgres agent-wallet persistence shared across adapters. Implementation lives outside `adapters/`. */
export {
  applyAllowanceMove,
  insertLimitedKey,
  insertSubAccount,
  loadKeyStatus,
  revokeLimitedKey,
} from '../../../agent-wallet/store.js';
