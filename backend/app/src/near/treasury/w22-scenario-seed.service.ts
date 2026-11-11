import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MOCK_ACCOUNT_ROOT } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';
import { CargoTokenPort, CARGO_MINTER_ACCOUNT, toCargoBaseUnits } from '../application/ports/cargo-token.port.js';
import { TreasuryDaoPort } from '../application/ports/treasury-dao.port.js';
import { TREASURY_COST_TOKEN } from './costs.js';
import { PlanetDaoLifecycleService } from './lifecycle.service.js';
import { kekEnv } from '../identity/colony-accounts.js';
import { loadKekRing } from '../keystore/kek.js';
import { KeyStore } from '../keystore/keys.js';

/** Whole `metals.t1` already in the DAO when Council opens (fee history, not a player debit). */
export const W22_SEEDED_FEE_METALS = 4000;

/** Whole `metals.t1` minted to each scenario colony account so a 200 bounty can escrow. */
export const W22_SEEDED_CARGO_METALS = 1000;

/** Recorded on the DAO deposit. `treasury.fund` uses a different `from` and is not this history. */
export const W22_FEE_FUNDER = 'platform.fee.terraagent.mock';

const SEATS = [0, 1] as const;

interface SeatedColony {
  readonly id: string;
  readonly playerId: string;
  readonly colonyIndex: number;
}

/**
 * Chain seed for `?scenario=w22` (W22-36). The scenario `build` cannot touch Postgres.
 * On `dev.scenario.created` this deposits the fee history and mints cargo. On
 * `dev.scenario.seated` it binds that seat's account to the player's colony row so a vote
 * and a bounty post use the same member. W22 off does nothing.
 */
@Injectable()
export class W22ScenarioSeedService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(W22ScenarioSeedService.name);
  private readonly stops: Array<() => void> = [];
  private readonly planets = new Set<string>();
  private keyStore: KeyStore | null = null;

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(PlanetDaoLifecycleService) private readonly lifecycle: PlanetDaoLifecycleService,
    @Inject(TreasuryDaoPort) private readonly dao: TreasuryDaoPort,
    @Inject(CargoTokenPort) private readonly cargo: CargoTokenPort,
    @Optional() @Inject(EventBus) private readonly bus?: EventBus,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
  ) {}

  onModuleInit(): void {
    if (!this.bus || this.stops.length > 0) return;
    this.stops.push(
      this.bus.on('dev.scenario.created', (e) => {
        if (e.scenario !== 'w22') return;
        this.planets.add(e.planetId);
        void this.seedPlanet(e.planetId).catch((err: unknown) => this.warn('seed', err));
      }, { module: 'W22ScenarioSeedService' }),
      this.bus.on('dev.scenario.seated', (e) => {
        if (!this.planets.has(e.planetId)) return;
        void this.bindSeat(e.planetId, e.playerId).catch((err: unknown) => this.warn('seat', err));
      }, { module: 'W22ScenarioSeedService' }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private ready(): boolean {
    if (!this.flags.has('W22') || !this.prisma) return false;
    return this.env === undefined || databaseEnabled(this.env);
  }

  private async seedPlanet(planetId: string): Promise<void> {
    if (!this.ready()) return;
    const ensured = await this.lifecycle.ensurePlanetDao(planetId);
    if (!ensured) return;
    await this.dao.deposit({
      opId: `w22-fee:${planetId}`,
      daoAccountId: ensured.daoAccountId,
      from: W22_FEE_FUNDER,
      tokenId: TREASURY_COST_TOKEN,
      amount: String(W22_SEEDED_FEE_METALS),
    });
    for (const index of SEATS) await this.fundSeat(ensured.daoAccountId, planetId, index);
  }

  private async fundSeat(daoAccountId: string, planetId: string, index: number): Promise<void> {
    const accountId = w22SeatAccountId(planetId, index);
    await this.dao.addMember({
      opId: `w22-member:${planetId}:${index}`,
      daoAccountId,
      member: accountId,
      canPropose: true,
    });
    await this.cargo.mint({
      opId: `w22-cargo:${planetId}:${index}`,
      to: accountId,
      tokenId: TREASURY_COST_TOKEN,
      amount: toCargoBaseUnits(W22_SEEDED_CARGO_METALS),
      caller: CARGO_MINTER_ACCOUNT,
    });
  }

  private async bindSeat(planetId: string, playerId: string): Promise<void> {
    if (!this.ready() || !this.prisma) return;
    const colony = await this.prisma.colony.findFirst({
      where: { planetId, playerId },
      select: { id: true, playerId: true, colonyIndex: true },
    });
    if (!colony) return;
    await bindW22SeatAccount(this.prisma, this.keys(), colony, w22SeatAccountId(planetId, colony.colonyIndex));
  }

  private keys(): KeyStore {
    if (!this.keyStore) this.keyStore = new KeyStore(loadKekRing(kekEnv((this.env ?? { NODE_ENV: 'development' }) as AppEnv)));
    return this.keyStore;
  }

  private warn(step: string, err: unknown): void {
    this.log.warn(`w22 scenario ${step} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** DAO member and cargo account for scenario colony `index`. Valid as an `AccountId` (no `--`). */
export function w22SeatAccountId(planetId: string, colonyIndex: number): string {
  const slug = planetId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const full = `w22-${slug}-c${colonyIndex}.${MOCK_ACCOUNT_ROOT}`;
  if (full.length <= 64) return full;
  const hash = createHash('sha256').update(planetId).digest('hex').slice(0, 12);
  return `w22-${hash}-c${colonyIndex}.${MOCK_ACCOUNT_ROOT}`;
}

/** Points the pre-seeded seat account at the player's `co_` colony so votes and escrow match. */
export async function bindW22SeatAccount(
  prisma: PrismaClient,
  keys: KeyStore,
  colony: SeatedColony,
  accountId: string,
): Promise<void> {
  const existing = await prisma.nearColonyAccount.findUnique({ where: { accountId }, select: { colonyId: true } });
  if (existing) {
    if (existing.colonyId !== colony.id) {
      await prisma.nearColonyAccount.update({
        where: { accountId },
        data: { colonyId: colony.id, playerId: colony.playerId, slot: colony.id },
      });
    }
    return;
  }
  const sealed = keys.generate().row;
  await prisma.mockChainAccount.upsert({ where: { accountId }, create: { accountId, kind: 'colony' }, update: {} });
  await prisma.nearColonyAccount.create({
    data: {
      accountId,
      playerId: colony.playerId,
      slot: colony.id,
      colonyId: colony.id,
      ownerAccountId: accountId,
      publicKey: sealed.publicKey,
      encryptedSecret: sealed.encryptedSecret,
      kekVersion: sealed.kekVersion,
    },
  });
}
