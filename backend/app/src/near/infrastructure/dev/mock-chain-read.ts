import { CoreException } from '../../../core/errors/index.js';
import type { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { MockChainReadAdapter } from '../adapters/chain-read/mock-chain-read.adapter.js';

/** The mock ChainRead adapter for dev tools; 404 when ChainRead is bound to a real adapter (production: `DevOnlyGuard`). */
export function requireMockChainRead(chainRead: ChainReadPort): MockChainReadAdapter {
  if (!(chainRead instanceof MockChainReadAdapter)) {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  return chainRead;
}
