import { Global, Module } from '@nestjs/common';
import { defineEnv } from '@terra/config';
import { FlagSpecError, parseWaves } from '@terra/contracts';
import { z } from 'zod';
import { FlagsService } from './flags.service';

/** `TA_WAVES`: `all` (default), `..07`, or `00,01,07`. A malformed value aborts boot instead of enabling waves. */
export const env = defineEnv('flags', {
  TA_WAVES: z
    .string()
    .optional()
    .superRefine((v, ctx) => {
      try {
        parseWaves(v);
      } catch (e) {
        if (e instanceof FlagSpecError) ctx.addIssue({ code: 'custom', message: e.message });
        else throw e;
      }
    }),
});

/** Wave feature flags (PRODUCT_WAVES §3). Global so the gateway, data compiler and dev tools can inject it. */
@Global()
@Module({ providers: [FlagsService], exports: [FlagsService] })
export class FlagsModule {}
