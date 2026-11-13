import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import type { PlanetEventV1 } from '../../bus/channels.js';
import { EventBus } from '../../bus/event-bus.js';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { KeyStore } from '../keystore/keys.js';
import { loadKekRing, type KekEnv } from '../keystore/kek.js';
import { PlanetDaoMembershipService } from '../treasury/membership.service.js';
import { ensureColonyAccounts, type EnsureColonyAccountsInput } from './colony-account-write.js';

/**
 * Colony sub-accounts for a linked player. Guests (no `social_identity` row) are skipped.
 * The database-off path (unit tests) never seals a key. `loadKekRing` runs on the first write, not at boot (BE-34).
 */
@Injectable()
export class ColonyAccounts implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ColonyAccounts.name);
  private stop: (() => void) | null = null;
  private keyStore: KeyStore | null = null;

  constructor(
    private readonly bus: EventBus,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Optional() @Inject(PlanetDaoMembershipService) private readonly membership?: PlanetDaoMembershipService,
  ) {}

  onModuleInit(): void {
    if (this.stop) return;
    this.stop = this.bus.on('planet.event', (event) => this.onPlanet(event), { module: 'ColonyAccounts' });
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }

  /** After every social login when Postgres is on. Picks up colonies created between logins. */
  ensureForLinkedPlayer(input: EnsureColonyAccountsInput): Promise<void> {
    return this.ensure(input);
  }

  private onPlanet(event: PlanetEventV1): void {
    if (event.kind !== 'colonyFounded') return;
    const playerId = event.data.playerId;
    const colonyId = event.data.colonyId;
    if (!playerId || !colonyId) return;
    // The bus does not await this. A rejection is swallowed here so the log line cannot carry key material.
    void this.ensureFounded(event.planetId, playerId, colonyId).catch(() => {
      this.log.warn('colony sub-account was not created');
    });
  }

  private async ensureFounded(planetId: string, playerId: string, colonyId: string): Promise<void> {
    const prisma = this.database();
    if (!prisma) return;
    const social = await prisma.socialIdentity.findFirst({
      where: { playerId },
      orderBy: { createdAt: 'asc' },
      select: { subject: true, accountId: true },
    });
    if (!social) return;
    const colony = await prisma.colony.findUnique({ where: { id: colonyId }, select: { playerId: true } });
    if (colony && colony.playerId !== playerId) return;
    await ensureColonyAccounts(prisma, this.keys(), {
      playerId,
      subject: social.subject,
      ownerAccountId: social.accountId,
      colonyIds: [colonyId],
      envSource: this.env as unknown as Record<string, string | undefined>,
    });
    // The founding listener may have looked before this row existed. The same opId adds the member once.
    this.membership?.onFounded(planetId, colonyId);
  }

  private async ensure(input: EnsureColonyAccountsInput): Promise<void> {
    const prisma = this.database();
    if (!prisma) return;
    await ensureColonyAccounts(prisma, this.keys(), {
      ...input,
      envSource: input.envSource ?? (this.env as unknown as Record<string, string | undefined>),
    });
  }

  private database(): PrismaClient | null {
    return databaseEnabled(this.env) ? this.prisma : null;
  }

  private keys(): KeyStore {
    if (!this.keyStore) this.keyStore = new KeyStore(loadKekRing(kekEnv(this.env)));
    return this.keyStore;
  }
}

export function kekEnv(env: AppEnv): KekEnv {
  const bag = env as { NEAR_KEK?: unknown; NEAR_KEK_VERSION?: unknown; NEAR_KEK_RING?: unknown };
  const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  return {
    NODE_ENV: env.NODE_ENV,
    NEAR_KEK: str(bag.NEAR_KEK),
    NEAR_KEK_VERSION: str(bag.NEAR_KEK_VERSION),
    NEAR_KEK_RING: str(bag.NEAR_KEK_RING),
  };
}
