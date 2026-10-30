import { CoreException } from '../../../core/errors/index.js';
import type { AppEnv } from '../../../core/tokens.js';
import type { ChainReadPort } from '../../application/ports/chain-read.port.js';
import { MockChainReadAdapter } from '../adapters/chain-read/mock-chain-read.adapter.js';

/** The mock ChainRead adapter for dev tools; 404 in production and when ChainRead is bound to a real adapter. */
export function requireMockChainRead(env: AppEnv, chainRead: ChainReadPort): MockChainReadAdapter {
  if (env.NODE_ENV === 'production' || !(chainRead instanceof MockChainReadAdapter)) {
    throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
  }
  return chainRead;
}
