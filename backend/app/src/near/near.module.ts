import { Module } from '@nestjs/common';
import type { EnvSection } from '@terra/config';
import { z } from 'zod';
import { OutboxModule, env as outboxEnv } from './application/outbox/outbox.module.js';
import { CargoExportOutboxService } from './cargo/cargo-export-outbox.js';
import { CargoImportOutboxService } from './cargo/cargo-import-outbox.js';
import { CargoStatusController } from './cargo/cargo-status.controller.js';
import { CargoStatusService } from './cargo/cargo-status.service.js';
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

/** One env section per module: the port-binding guard plus the chain outbox variables. */
export const env = { name: nearEnv.name, schema: z.intersection(nearEnv.schema, outboxEnv.schema) } as unknown as EnvSection;

/** NEAR integration: port bindings, chain outbox, dev chain routes, mock OAuth, social login, relay status, and `/v1/near/health`. */
@Module({
  controllers: [
    CargoStatusController,
    ChainDevController,
    ChainExplorerController,
    MockOauthController,
    NearHealthController,
    RelayStatusController,
    SocialAuthController,
  ],
  providers: [
    CargoExportOutboxService,
    CargoImportOutboxService,
    CargoStatusService,
    ColonyAccounts,
    RelayStatusService,
    SocialAuthService,
    SocialLink,
    NearMockCommand,
  ],
  imports: [NearInfrastructureModule, OutboxModule],
  exports: [
    CargoExportOutboxService,
    CargoImportOutboxService,
    CargoStatusService,
    NearInfrastructureModule,
    OutboxModule,
    SocialLink,
  ],
})
export class NearModule {}
