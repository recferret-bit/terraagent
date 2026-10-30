import { Controller, Get, Inject, Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { z } from 'zod';
import { APP_ENV, type AppEnv } from '../../../../../src/core/tokens';

export const env = defineEnv('probe', { PROBE_FLAG: z.enum(['on', 'off']).default('off') });

@Controller('probe')
class ProbeController {
  constructor(@Inject(APP_ENV) private readonly e: AppEnv) {}
  @Get()
  get() {
    return { flag: this.e.PROBE_FLAG };
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
