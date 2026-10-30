import { Module } from '@nestjs/common';
import { NearInfrastructureModule, nearEnv } from './infrastructure/near-infrastructure.module.js';

export const env = nearEnv;

/** NEAR integration (W00 skeleton: only the port bindings; application and domain services arrive with their waves). */
@Module({ imports: [NearInfrastructureModule], exports: [NearInfrastructureModule] })
export class NearModule {}
