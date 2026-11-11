import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import type { DbClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { FlagsService } from '../../flags/flags.service.js';
import { GuildProvisionError } from './guild-error.js';
import { GuildNpcRepository } from './guild-npc.repository.js';
import {
  assertT1Cargo,
  draftOf,
  loadPolicy,
  quoteAtomic,
  type GuildAllocation,
  type GuildPolicy,
  type RosterNpc,
} from './guild-plan.js';
import { GuildTradeKeyBinder } from './guild-trade-key.binder.js';
import { GuildWalletBinder } from './guild-wallet.binder.js';
import { TIER1_RESOURCES } from './maker/pairs.js';

/**
 * Boot provisioning for the Guild roster (W15-05). One sub-account, one limited key, one bot API key
 * and one allocation id per NPC. A second call returns that row. Refill does not raise the budget.
 * W15 off does nothing. Real treasury cargo is not minted.
 */
@Injectable()
export class GuildProvisionService implements OnModuleInit {
  private readonly log = new Logger(GuildProvisionService.name);

  constructor(
    private readonly flags: FlagsService,
    private readonly store: GuildNpcRepository,
    private readonly wallet: GuildWalletBinder,
    private readonly keys: GuildTradeKeyBinder,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  /** A down database must not stop the rest of the app (the dead-url market boot still has to come up). */
  async onModuleInit(): Promise<void> {
    if (!this.enabled()) return;
    await this.provision().catch((err: unknown) => {
      this.log.warn(`guild provision skipped: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async provision(): Promise<readonly GuildAllocation[]> {
    if (!this.enabled()) return [];
    const policy = this.policy();
    const ready = await this.ready(policy);
    if (ready) return this.seedColdStartIfRequested(ready);
    const out: GuildAllocation[] = [];
    for (const npc of policy.roster) out.push(await this.ensureKnown(npc, policy));
    return this.seedColdStartIfRequested(out);
  }

  private async seedColdStartIfRequested(rows: readonly GuildAllocation[]): Promise<readonly GuildAllocation[]> {
    if (this.env?.TA_SEED_RIVAL_AI !== '1' && this.env?.TA_SEED_RIVAL_AI !== 'true') return rows;
    const updated: GuildAllocation[] = [];
    for (const row of rows) {
      let current = row;
      if (current.inventory.lines.length === 0) {
        for (const res of TIER1_RESOURCES) {
          current = (await this.allocateFixtureCargo(current.npcId, res, 2500)) ?? current;
        }
      }
      updated.push(current);
    }
    return updated;
  }

  async ensureNpc(npcId: string): Promise<GuildAllocation | null> {
    if (!this.enabled()) return null;
    const policy = this.policy();
    const npc = policy.roster.find((row) => row.id === npcId);
    if (!npc) throw new GuildProvisionError('unknown_npc', `No Guild NPC ${npcId}`);
    return this.ensureKnown(npc, policy);
  }

  /** Refused. The stored quote budget and the spend and loss counters stay as they are. */
  async refill(npcId: string, extraAtomic: string): Promise<GuildAllocation | null> {
    if (!this.enabled()) return null;
    if (!/^(0|[1-9]\d{0,77})$/.test(extraAtomic)) throw new GuildProvisionError('bad_amount', 'Refill amount is not an atomic decimal');
    this.known(npcId);
    const row = await this.store.find(npcId);
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${npcId} is not provisioned`);
    return row;
  }

  /**
   * Mock cargo only, labelled `fixture`. Amount 0 writes nothing. This does not credit the treasury or the verifier.
   */
  async allocateFixtureCargo(npcId: string, resource: string, amount: number): Promise<GuildAllocation | null> {
    if (!this.enabled()) return null;
    this.known(npcId);
    assertT1Cargo(resource, amount);
    const row = await this.store.find(npcId);
    if (!row) throw new GuildProvisionError('not_provisioned', `Guild NPC ${npcId} is not provisioned`);
    if (amount === 0) return row;
    return this.store.appendFixture(npcId, resource, amount);
  }

  private enabled(): boolean {
    return this.flags.has('W15') && databaseEnabled(this.env);
  }

  private policy(): GuildPolicy {
    const policy = loadPolicy((wave) => this.flags.has(wave));
    if (policy.cashEnabled !== 0) throw new GuildProvisionError('cash_on', 'Guild provisioning does not enable cash bids');
    return policy;
  }

  private known(npcId: string): void {
    const policy = this.policy();
    if (!policy.roster.some((row) => row.id === npcId)) throw new GuildProvisionError('unknown_npc', `No Guild NPC ${npcId}`);
  }

  private async ready(policy: GuildPolicy): Promise<readonly GuildAllocation[] | null> {
    const rows = await this.store.list();
    const byId = new Map(rows.map((row) => [row.npcId, row]));
    if (!policy.roster.every((npc) => byId.has(npc.id))) return null;
    return policy.roster.map((npc) => byId.get(npc.id)!);
  }

  private ensureKnown(npc: RosterNpc, policy: GuildPolicy): Promise<GuildAllocation> {
    return this.store.withLock(npc.id, (db) => this.insertIfAbsent(db, npc, policy));
  }

  private async insertIfAbsent(db: DbClient, npc: RosterNpc, policy: GuildPolicy): Promise<GuildAllocation> {
    const existing = await this.store.find(npc.id, db);
    if (existing) return existing;
    const quote = quoteAtomic(policy, await this.store.allocatedAtomic(db));
    await this.wallet.ensureAccount(npc);
    const publicKey = await this.wallet.ensureKey(npc, quote);
    const tradeKeyId = await this.keys.ensure(npc, policy);
    return this.store.insert({ ...draftOf(npc, policy, quote, tradeKeyId), publicKey }, db);
  }
}
