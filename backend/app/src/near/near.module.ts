import { Module } from '@nestjs/common';
import type { EnvSection } from '@terra/config';
import { z } from 'zod';
import { OutboxModule, env as outboxEnv } from './application/outbox/outbox.module.js';
import { NotifyModule } from '../notify/notify.module.js';
import { CargoExportOutboxService } from './cargo/cargo-export-outbox.js';
import { CargoImportOutboxService } from './cargo/cargo-import-outbox.js';
import { CargoStatusController } from './cargo/cargo-status.controller.js';
import { CargoStatusService } from './cargo/cargo-status.service.js';
import { FreeVerifierService } from './cargo/free-verifier.service.js';
import { ChainDevController } from './infrastructure/dev/chain-dev.controller.js';
import { ChainExplorerController } from './infrastructure/dev/chain-explorer.controller.js';
import { NearHealthController } from './infrastructure/dev/near-health.controller.js';
import { NearInfrastructureModule, nearEnv } from './infrastructure/near-infrastructure.module.js';
import { MockOauthController } from './identity/mock-oauth.controller.js';
import { SocialAuthController } from './identity/social-auth.controller.js';
import { ColonyAccounts } from './identity/colony-accounts.js';
import { RelayStatusController } from './identity/relay-status.controller.js';
import { RelayStatusService } from './identity/relay-status.service.js';
import { SocialAuthService } from './identity/social-auth.service.js';
import { SocialLink } from './identity/social-link.js';
import { NearMockCommand } from './infrastructure/dev/near-mock.command.js';
import { NearDeedController, PublicDeedController } from './deed/deed.controller.js';
import { DeedDebounceService } from './deed/deed-debounce.service.js';
import { DeedDevCommand } from './deed/deed-dev.command.js';
import { DeedImageRendererService } from './deed/deed-image.renderer.js';
import { DeedLifecycleService } from './deed/deed-lifecycle.service.js';
import { DeedMintOutboxService } from './deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from './deed/deed-projector.service.js';
import { DeedSettledService } from './deed/deed-settled.service.js';
import { DeedShareController } from './deed/deed-share.controller.js';
import { DeedTelemetryService } from './deed/deed-telemetry.service.js';
import { DeedRepository } from './deed/deed.repository.js';
import { AccountClaimController } from './staking/account-claim.controller.js';
import { AccountClaimService } from './staking/account-claim.service.js';
import { StakingController } from './staking/staking.controller.js';
import { StakingPoolsController } from './staking/staking-pools.controller.js';
import { StakingPositionSyncService } from './staking/staking-position-sync.service.js';
import { StakingService } from './staking/staking.service.js';

/** One env section per module: the port-binding guard plus the chain outbox variables. */
export const env = { name: nearEnv.name, schema: z.intersection(nearEnv.schema, outboxEnv.schema) } as unknown as EnvSection;

/** NEAR integration: port bindings, chain outbox, dev chain routes, mock OAuth, social login, relay status, and `/v1/near/health`. */
@Module({
  controllers: [
    AccountClaimController,
    CargoStatusController,
    ChainDevController,
    ChainExplorerController,
    DeedShareController,
    MockOauthController,
    NearDeedController,
    NearHealthController,
    PublicDeedController,
    RelayStatusController,
    SocialAuthController,
    StakingController,
    StakingPoolsController,
  ],
  providers: [
    AccountClaimService,
    CargoExportOutboxService,
    CargoImportOutboxService,
    CargoStatusService,
    DeedDebounceService,
    DeedDevCommand,
    DeedImageRendererService,
    DeedLifecycleService,
    DeedMintOutboxService,
    DeedProjectorService,
    DeedRepository,
    DeedSettledService,
    DeedTelemetryService,
    FreeVerifierService,
    ColonyAccounts,
    RelayStatusService,
    SocialAuthService,
    SocialLink,
    StakingPositionSyncService,
    StakingService,
    NearMockCommand,
  ],
  imports: [NearInfrastructureModule, OutboxModule, NotifyModule],
  exports: [
    AccountClaimService,
    CargoExportOutboxService,
    CargoImportOutboxService,
    CargoStatusService,
    DeedDebounceService,
    DeedDevCommand,
    DeedImageRendererService,
    DeedLifecycleService,
    DeedMintOutboxService,
    DeedProjectorService,
    DeedRepository,
    DeedSettledService,
    DeedTelemetryService,
    FreeVerifierService,
    NearInfrastructureModule,
    OutboxModule,
    SocialLink,
    StakingPositionSyncService,
    StakingService,
  ],
})
export class NearModule {}
