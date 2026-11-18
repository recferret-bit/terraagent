import { Controller, Get, Inject, Optional, Query } from '@nestjs/common';
import { TeeAttestationStore, type StoredTeeAttestation } from './tee-attestation.store.js';

@Controller(['near/ai', 'ai'])
export class AiAttestationController {
  constructor(@Optional() @Inject(TeeAttestationStore) private readonly store?: TeeAttestationStore) {}

  @Get('attestations')
  async list(
    @Query('colonyId') colonyId?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ readonly colonyId: string; readonly attestations: readonly StoredTeeAttestation[] }> {
    const cid = (colonyId ?? '').trim();
    if (!cid || !this.store) return { colonyId: cid, attestations: [] };
    const limit = Number(limitRaw ?? '10');
    const attestations = await this.store.listForColony(cid, Number.isFinite(limit) ? limit : 10);
    return { colonyId: cid, attestations };
  }
}
