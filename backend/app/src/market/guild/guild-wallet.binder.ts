import { Injectable } from '@nestjs/common';
import { AgentWalletPort } from '../../near/application/ports/agent-wallet.port.js';
import { GuildProvisionError } from './guild-error.js';
import {
  accountName,
  GUILD_GAS_ALLOWANCE,
  GUILD_KEY_METHODS,
  GUILD_KEY_RECEIVER,
  GUILD_PARENT,
  opId,
  publicKeyOf,
  type RosterNpc,
} from './guild-plan.js';

/** Sub-account plus one limited key. Repeated calls use a stable `opId`, so the wallet port does not insert twice. */
@Injectable()
export class GuildWalletBinder {
  constructor(private readonly wallet: AgentWalletPort) {}

  async ensureAccount(npc: RosterNpc): Promise<string> {
    const created = await this.wallet.createSubAccount({
      opId: opId(npc.id, 'sub'),
      parent: GUILD_PARENT,
      name: accountName(npc.accountId),
    });
    if (created.accountId !== npc.accountId) {
      throw new GuildProvisionError('account_mismatch', `Expected ${npc.accountId}, wallet returned ${created.accountId}`);
    }
    return created.accountId;
  }

  /** NEAR principal is the finite subsidy float. Zero leaves the key with no token cap, so nothing is minted. */
  async ensureKey(npc: RosterNpc, quote: bigint): Promise<string> {
    const publicKey = publicKeyOf(npc.id);
    const tokens = quote > 0n ? [{ token: 'NEAR', allowance: quote.toString() }] : [];
    await this.wallet.addLimitedKey({
      opId: opId(npc.id, 'key'),
      accountId: npc.accountId,
      publicKey,
      allowance: GUILD_GAS_ALLOWANCE,
      receiverId: GUILD_KEY_RECEIVER,
      methodNames: [...GUILD_KEY_METHODS],
      ...(tokens.length > 0 ? { tokens } : {}),
    });
    return publicKey;
  }
}
