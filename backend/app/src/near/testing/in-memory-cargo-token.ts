import { CargoTokenPort, type BurnCargoInput, type CargoBalanceInput, type MintCargoInput, type TransferCargoInput } from '../application/ports/cargo-token.port';
import { NearException } from '../domain/errors';
import type { ChainReceipt, TokenAmount } from '../domain/types';
import { InMemoryChain } from './in-memory-chain';

/** In-memory `CargoTokenPort` for unit tests (NEAR §1a rule 8): a Map ledger of BigInt balances, writes idempotent by `opId`. */
export class InMemoryCargoToken extends CargoTokenPort {
  private readonly ledger = new Map<string, bigint>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  async mint(input: MintCargoInput): Promise<ChainReceipt> {
    return this.chain.write(input.opId, () => this.add(input.to, input.tokenId, BigInt(input.amount))).receipt;
  }

  async burn(input: BurnCargoInput): Promise<ChainReceipt> {
    return this.chain.write(input.opId, () => this.sub(input.from, input.tokenId, BigInt(input.amount))).receipt;
  }

  async transfer(input: TransferCargoInput): Promise<ChainReceipt> {
    return this.chain.write(input.opId, () => {
      const amount = BigInt(input.amount);
      this.sub(input.from, input.tokenId, amount);
      this.add(input.to, input.tokenId, amount);
    }).receipt;
  }

  async balanceOf(input: CargoBalanceInput): Promise<TokenAmount> {
    return String(this.ledger.get(key(input.accountId, input.tokenId)) ?? 0n);
  }

  private add(account: string, token: string, amount: bigint): void {
    this.ledger.set(key(account, token), (this.ledger.get(key(account, token)) ?? 0n) + amount);
  }

  private sub(account: string, token: string, amount: bigint): void {
    const have = this.ledger.get(key(account, token)) ?? 0n;
    if (have < amount) throw new NearException('NEAR_INSUFFICIENT_BALANCE', { details: { account, token, have: String(have), need: String(amount) } });
    this.ledger.set(key(account, token), have - amount);
  }
}

const key = (account: string, token: string) => `${account}\u0000${token}`;
