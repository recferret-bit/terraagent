import { Module } from '@nestjs/common';
import type { EnvSection } from '@terra/config';
import { z } from 'zod';
import { OutboxModule, env as outboxEnv } from './application/outbox/outbox.module.js';
import { ChainDevController } from './infrastructure/dev/chain-dev.controller.js';
import { ChainExplorerController } from './infrastructure/dev/chain-explorer.controller.js';
import { NearHealthController } from './infrastructure/dev/near-health.controller.js';
import { NearInfrastructureModule, nearEnv } from './infrastructure/near-infrastructure.module.js';
import { MockOauthController } from './identity/mock-oauth.controller.js';
import { SocialAuthController } from './identity/social-auth.controller.js';
import { SocialAuthService } from './identity/social-auth.service.js';

/** One env section per module: the port-binding guard plus the chain outbox variables. */
export const env = { name: nearEnv.name, schema: z.intersection(nearEnv.schema, outboxEnv.schema) } as unknown as EnvSection;

/** NEAR integration: port bindings, chain outbox, dev chain routes, mock OAuth, social login, and `/v1/near/health`. */
@Module({
  controllers: [ChainDevController, ChainExplorerController, MockOauthController, NearHealthController, SocialAuthController],
  providers: [SocialAuthService],
  imports: [NearInfrastructureModule, OutboxModule],
  exports: [NearInfrastructureModule, OutboxModule],
})
export class NearModule {}
