import { Module } from '@nestjs/common';
import { ChainDevController } from './infrastructure/dev/chain-dev.controller.js';
import { NearInfrastructureModule, nearEnv } from './infrastructure/near-infrastructure.module.js';

export const env = nearEnv;

/** NEAR integration (W00 skeleton: only the port bindings; application and domain services arrive with their waves). */
@Module({ controllers: [ChainDevController], imports: [NearInfrastructureModule], exports: [NearInfrastructureModule] })
export class NearModule {}
