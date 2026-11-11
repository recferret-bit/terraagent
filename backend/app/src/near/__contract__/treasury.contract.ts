import type { TreasuryDaoPort } from '../application/ports/treasury-dao.port';
import { defineNearContract } from './harness';
import { treasurySuite } from './treasury.suite';

/** Port contract for `TreasuryDaoPort`. W23-37 runs this same suite against the real DAO. */
export const contract = defineNearContract<TreasuryDaoPort>({
  port: 'TreasuryDao',
  helpers: () => ({}),
  suite: treasurySuite,
});
