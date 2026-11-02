import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters';
import { RelayerPort, type SubmitMetaTxInput } from '../../../application/ports/relayer.port';
import type { ChainReceipt } from '../../../domain/types';
import { MockChainBase } from '../../mock/mock-chain.base';
import { runRelayed, SignerLane } from './nonce-lane';
import { assertRelayAllowed, relayTxHash, type RelaySubmit } from './relay-rules';

/** Mock NEP-366 relayer: allow-list, then one Postgres receipt per signer nonce. */
@Injectable()
export class MockRelayerAdapter extends MockChainBase implements RelayerPort {
  private readonly lane = new SignerLane();

  async submitMetaTx(input: SubmitMetaTxInput): Promise<ChainReceipt> {
    const parsed = assertRelayAllowed(input);
    return runRelayed(this.lane, parsed.signerId, (nonce) => this.submitAt(parsed, nonce));
  }

  /**
   * The stored opId is the action hash plus this nonce. A failed call writes nothing, so the retry
   * (next nonce) is a new receipt; a replay of the same action and the same nonce returns the stored one.
   */
  private submitAt(parsed: RelaySubmit, nonce: bigint): Promise<ChainReceipt> {
    const n = nonce.toString();
    return this.call('Relayer', 'submitMetaTx', `${relayTxHash(parsed)}:${n}`, async (tx) => {
      await this.ensureAccount(tx, parsed.signerId);
      return { signerId: parsed.signerId, receiverId: parsed.receiverId, opId: parsed.opId, method: 'submitMetaTx', nonce: n };
    });
  }
}

export const adapter = adapterOf({ port: RelayerPort, kind: 'mock', useClass: MockRelayerAdapter });
