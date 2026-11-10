import { DeedMetadataV1 } from '@terra/contracts';
import type { FlagsService } from '../../../flags/flags.service.js';
import type {
  ChainOutboxRepository,
  ClaimedRow,
  OutboxEntry,
} from '../../application/outbox/chain-outbox.repository.js';
import type { MintDeedForColonyInput } from '../deed-mint-outbox.service.js';
import type { StoredDeedRecord } from '../deed.repository.js';

export function buildInitialDeedMetadata(
  flags: FlagsService,
  input: MintDeedForColonyInput,
  tokenId: string,
): DeedMetadataV1 {
  return DeedMetadataV1.parse({
    planet: input.planetId,
    colony: input.colonyId,
    ...(input.colonyName ? { colonyName: input.colonyName } : {}),
    ...(input.planetType ? { planetType: input.planetType } : {}),
    ...(flags.has('W08') ? { stage: input.stage ?? 0 } : {}),
    ...(flags.has('W05') ? { terraformBp: input.terraformBp ?? 0 } : {}),
    ...(input.territoryHexes && input.territoryHexes.length > 0
      ? { territoryHexes: [...input.territoryHexes] }
      : {}),
    status: 'active',
    settled: false,
    version: 1,
    imageUrl: `/v1/near/deed/${encodeURIComponent(tokenId)}/image.png?v=1`,
  });
}

export function buildDeedMintOutboxPayload(
  opId: string,
  tokenId: string,
  record: StoredDeedRecord,
  colonyId: string,
  planetId: string,
): OutboxEntry {
  return {
    opId,
    port: 'DeedNft',
    method: 'mint',
    payload: {
      collection: 'deed',
      tokenId,
      ownerAccountId: record.accountId,
      owner: record.accountId,
      metadata: record.metadata,
      metadataJson: JSON.stringify(record.metadata),
      colonyId,
      planetId,
    },
  };
}

export async function enqueueDeedMintIfPending(
  outbox: ChainOutboxRepository | undefined,
  opId: string,
  tokenId: string,
  record: StoredDeedRecord,
  colonyId: string,
  planetId: string,
  tx?: Parameters<ChainOutboxRepository['enqueue']>[1],
): Promise<void> {
  if (!outbox || record.chainState === 'ACTIVE') return;
  await outbox.enqueue(
    buildDeedMintOutboxPayload(opId, tokenId, record, colonyId, planetId),
    tx,
  );
}

export function extractMintRowColonyId(row: ClaimedRow): string | null {
  if (typeof row.payload.colonyId === 'string' && row.payload.colonyId.length > 0) {
    return row.payload.colonyId;
  }
  if (row.opId.startsWith('deed-mint:')) {
    return row.opId.slice('deed-mint:'.length);
  }
  return null;
}
