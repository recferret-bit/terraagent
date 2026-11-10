import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { APP_ENV, type AppEnv } from '../../../core/tokens.js';
import type { FlagsService } from '../../../flags/flags.service.js';
import type { TradePrincipal } from '../../trade/trade-auth.js';
import { TradeKeysService } from '../../trade/trade-keys.service.js';
import { GuildProvisionError } from '../guild-error.js';
import { GuildNpcRepository } from '../guild-npc.repository.js';
import { ownerIdOf } from '../guild-plan.js';
import { GuildMakerService } from '../maker/guild-maker.service.js';
import { fundingEnabled, inventoryCapOf } from './caps.js';
import { GuildFundingRepository } from './funding.repository.js';

/**
 * Per-NPC guild kill (W15-12). Sets `killed` for `allowQuote`, then calls W13's kill switch for this
 * NPC's trade key so unsubmitted requests and resting orders are reconciled there. The W13 body is not copied.
 */
@Injectable()
export class GuildKillSwitch {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly npcs: GuildNpcRepository,
    private readonly funding: GuildFundingRepository,
    private readonly flags: FlagsService,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async killGuild(npcId: string): Promise<{ npcId: string; keyId: string; killed: true }> {
    if (!fundingEnabled(this.flags, this.env)) throw new GuildProvisionError('not_provisioned', 'Guild funding is off');
    const row = await this.npcs.find(npcId);
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${npcId} is not provisioned`);
    await this.funding.markKilled(
      npcId,
      inventoryCapOf((wave) => this.flags.has(wave)),
    );
    await this.cancelQuotes(npcId);
    const keys = this.moduleRef.get(TradeKeysService, { strict: false });
    await keys.kill(principal(npcId), { keyId: row.tradeKeyId });
    return { npcId, keyId: row.tradeKeyId, killed: true };
  }

  /** The maker is optional here so a funding test can construct the switch without the loop. */
  private async cancelQuotes(npcId: string): Promise<void> {
    const maker = this.maker();
    if (maker) await maker.onKilled(npcId);
  }

  private maker(): GuildMakerService | null {
    try {
      const found = this.moduleRef.get(GuildMakerService, { strict: false });
      return typeof found?.onKilled === 'function' ? found : null;
    } catch {
      return null;
    }
  }
}

function principal(npcId: string): TradePrincipal {
  const ownerId = ownerIdOf(npcId);
  return {
    actorKind: 'player',
    ownerId,
    ownerRef: `player:${ownerId}`,
    key: null,
    scopes: ['read', 'trade', 'manage'],
    colonyFor: async () => null,
  };
}
