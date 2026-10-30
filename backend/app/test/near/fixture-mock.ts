import type { DbClient } from '@terra/db';
import type { ChainReceipt } from '../../src/near/domain/types';
import { MockChainBase } from '../../src/near/infrastructure/mock/mock-chain.base';

/** Test-only adapter exercising the base class helpers. */
export class FixtureMock extends MockChainBase {
  latency = () => this.pickLatencyMs();
  fund(opId: string | undefined, account: string, token: string, amount: string): Promise<ChainReceipt> {
    return this.call('Fixture', 'fund', opId, async (tx) => {
      await this.credit(tx, account, token, amount);
      return { account, token, amount };
    });
  }
  spend(opId: string | undefined, account: string, token: string, amount: string): Promise<ChainReceipt> {
    return this.call('Fixture', 'spend', opId, async (tx: DbClient) => {
      await this.debit(tx, account, token, amount);
      return { account, token, amount };
    });
  }
}
