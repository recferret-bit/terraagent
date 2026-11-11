import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { IntentsBalanceReadPort } from '../../../application/ports/intents-balance-read.port.js';
import { MockIntentsBalanceReadAdapter } from '../mock/intents-balance-read.adapter.js';

/** Companion read adapter for `NEAR_ADAPTER_INTENTS=testnet` (`near-infrastructure.module.ts`). */
@Injectable()
export class TestnetIntentsBalanceReadAdapter extends MockIntentsBalanceReadAdapter {
  constructor(@Inject(PRISMA) prisma: PrismaClient) {
    super(prisma);
  }
}

export const adapter = adapterOf({
  port: IntentsBalanceReadPort,
  kind: 'testnet',
  useClass: TestnetIntentsBalanceReadAdapter,
});
