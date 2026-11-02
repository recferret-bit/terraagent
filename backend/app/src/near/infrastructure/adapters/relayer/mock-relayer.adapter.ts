import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters';
import { RelayerPort, type SubmitMetaTxInput } from '../../../application/ports/relayer.port';
import type { ChainReceipt } from '../../../domain/types';
import { MockChainBase } from '../../mock/mock-chain.base';
import { assertRelayAllowed, relayTxHash } from './relay-rules';

/** Mock NEP-366 relayer: allow-list, then one Postgres receipt per signed action. */
@Injectable()
export class MockRelayerAdapter extends MockChainBase implements RelayerPort {
  async submitMetaTx(input: SubmitMetaTxInput): Promise<ChainReceipt> {
    const parsed = assertRelayAllowed(input);
    // Content hash is the mock opId, so a second submit of the same action returns the stored receipt.
    return this.call('Relayer', 'submitMetaTx', relayTxHash(parsed), async (tx) => {
      await this.ensureAccount(tx, parsed.signerId);
      return { signerId: parsed.signerId, receiverId: parsed.receiverId, opId: parsed.opId, method: 'submitMetaTx' };
    });
  }
}

export const adapter = adapterOf({ port: RelayerPort, kind: 'mock', useClass: MockRelayerAdapter });
