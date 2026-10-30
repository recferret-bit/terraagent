import { Module } from '@nestjs/common';
import type { EnvSection } from '@terra/config';
import { z } from 'zod';
import { OutboxModule, env as outboxEnv } from './application/outbox/outbox.module.js';
import { NearInfrastructureModule, nearEnv } from './infrastructure/near-infrastructure.module.js';

/** One env section per module: the port-binding guard plus the chain outbox variables. */
export const env = { name: nearEnv.name, schema: z.intersection(nearEnv.schema, outboxEnv.schema) } as unknown as EnvSection;

/** NEAR integration (W00 skeleton: the port bindings and the chain outbox; other application and domain services arrive with their waves). */
@Module({ imports: [NearInfrastructureModule, OutboxModule], exports: [NearInfrastructureModule, OutboxModule] })
export class NearModule {}
