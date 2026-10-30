import { adapterOf } from '../../../../src/ports/adapters.js';
import { ChainReadPort } from '../../../../src/near/application/ports/chain-read.port.js';

export class FixtureChainRead {}
export const adapter = adapterOf({ port: ChainReadPort, kind: 'mock', useClass: FixtureChainRead });
export const testnet = adapterOf({ port: ChainReadPort, kind: 'testnet', useClass: class TestnetChainRead {} });
