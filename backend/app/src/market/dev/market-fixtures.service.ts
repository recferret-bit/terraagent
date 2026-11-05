import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { parseDisplayAmount, type MarketTokenKey, type ResourceKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { W13_FIXTURES } from '@terra/scenarios/w13-markets';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { GamePlanets } from '../../game/game-planets.service.js';
import { kekEnv } from '../../near/identity/colony-accounts.js';
import { loadKekRing } from '../../near/keystore/kek.js';
import { KeyStore } from '../../near/keystore/keys.js';
import { resolveMarketAccountId } from '../orders/colony-account.js';
import { ensureCustodialAccount } from './market-accounts.bootstrap.js';
import { MarketFaucetService } from './market-faucet.service.js';

export interface ScenarioCreatedBusEvent { readonly planetId: string; readonly scenario: string }
export interface ScenarioSeatedBusEvent { readonly planetId: string; readonly playerId: string; readonly colonyIndex: number }

declare module '../../bus/channels.js' {
  interface BusChannels {
    'dev.scenario.created': ScenarioCreatedBusEvent;
    'dev.scenario.seated': ScenarioSeatedBusEvent;
  }
}

const PLAN = 'w13-fixture-plan:';
const SEAT = 'w13-fixture-seat:';
const isUnique = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

/**
 * Demo-story fixtures of the `w13` seed scenario (W13-35, step 1; dev/demo only): A holds 600 water in orbit, B holds 20
 * mock USDC. Those balances live in Postgres (the mock verifier ledger), so they are written when a dev session is seated
 * on the scenario's colony: the colony's mock chain account gets a custodial signing key, the verifier balance is credited
 * through the faucet path (a labelled `organic: false` fixture note) and the in-orbit water is mirrored into the sim with
 * `dev.cargoGrant` so the sim pre-check passes. Idempotent: one marker row per (planet, colony) in `chain.mock_chain_intent`
 * makes a reload, a reconnect or a second seat a no-op.
 */
@Injectable()
export class MarketFixtures implements OnModuleInit {
  private readonly log = new Logger(MarketFixtures.name);

  constructor(
    private readonly bus: EventBus,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly faucet: MarketFaucetService,
    private readonly planets: GamePlanets,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'production' || !databaseEnabled(this.env)) return;
    this.bus.on('dev.scenario.created', (e) => this.onCreated(e), { module: 'MarketFixtures' });
    this.bus.on('dev.scenario.seated', (e) => this.onSeated(e), { module: 'MarketFixtures' });
  }

  private async mark(opId: string, diff: Record<string, unknown>): Promise<boolean> {
    try {
      await this.prisma.mockChainIntent.create({ data: { id: `fixture-${randomUUID()}`, signer: 'fixture.w13', status: 'executed', opId, diff: { organic: false, funding: 'fixture', ...diff } as never } });
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }

  async onCreated(e: ScenarioCreatedBusEvent): Promise<void> {
    if (e.scenario !== 'w13') return;
    await this.mark(`${PLAN}${e.planetId}`, { kind: 'w13FixturePlan', planetId: e.planetId });
  }

  async onSeated(e: ScenarioSeatedBusEvent): Promise<void> {
    try {
      const plan = await this.prisma.mockChainIntent.findUnique({ where: { opId: `${PLAN}${e.planetId}` }, select: { id: true } });
      const fixture = W13_FIXTURES[e.colonyIndex];
      if (!plan || !fixture) return;
      if (!(await this.mark(`${SEAT}${e.planetId}:${e.colonyIndex}`, { kind: 'w13FixtureSeat', planetId: e.planetId, colonyIndex: e.colonyIndex }))) return;
      const accountId = await resolveMarketAccountId(this.prisma, `col_${e.colonyIndex}`, e.playerId, e.planetId, e.colonyIndex);
      await ensureCustodialAccount(this.prisma, new KeyStore(loadKekRing(kekEnv(this.env))), accountId, { playerId: e.playerId, slot: `col_${e.colonyIndex}` });
      for (const [resource, units] of Object.entries(fixture.inOrbit ?? {})) {
        await this.faucet.fund(accountId, resource as MarketTokenKey, BigInt(units));
        await this.mirrorInOrbit(e, resource as ResourceKey, units);
      }
      if (fixture.usdc) await this.faucet.fund(accountId, 'USDC', parseDisplayAmount('USDC', fixture.usdc));
      this.log.log(`w13 fixtures applied to ${accountId} (${e.planetId} colony ${e.colonyIndex}): ${JSON.stringify(fixture)} (mock, fixture)`);
    } catch (err) {
      this.log.warn(`w13 fixtures failed for ${e.planetId} colony ${e.colonyIndex}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async mirrorInOrbit(e: ScenarioSeatedBusEvent, resource: ResourceKey, amount: number): Promise<void> {
    const out = await this.planets.submit(e.planetId, {
      colonyIndex: e.colonyIndex, source: 'dev', commandId: `w13fx-${e.colonyIndex}-${Date.now().toString(36)}`, kind: 'dev.cargoGrant', args: { colonyIndex: e.colonyIndex, resource, amount },
    } as never);
    if ((out as { code?: string }).code) throw new Error(`dev.cargoGrant rejected: ${(out as { code?: string }).code}`);
  }
}
