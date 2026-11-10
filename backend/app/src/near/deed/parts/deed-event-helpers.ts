import type { DeedMetadataV1 } from '@terra/contracts';
import type { OutboxEntry } from '../../application/outbox/chain-outbox.repository.js';
import type { DeedRepository, StoredDeedRecord } from '../deed.repository.js';

export function extractEventColonyId(
  event: { colonyIds?: readonly string[] },
  data: Record<string, unknown>,
): string | null {
  if (typeof data.colonyId === 'string' && data.colonyId.length > 0) return data.colonyId;
  if (typeof event.colonyIds?.[0] === 'string' && event.colonyIds[0].length > 0) {
    return event.colonyIds[0];
  }
  if (typeof data.colonyIndex === 'number' && Number.isFinite(data.colonyIndex)) {
    return `col_${data.colonyIndex}`;
  }
  return null;
}

export async function resolveTargetDeedRecord(
  deeds: DeedRepository,
  colonyId: string,
  planetId?: string,
): Promise<StoredDeedRecord | null> {
  const direct = await deeds.findByColonyId(colonyId);
  if (direct) return direct;
  if (planetId) {
    const onPlanet = await deeds.listForPlayerOrColony({ planetId });
    if (onPlanet.length > 0) return onPlanet[0] ?? null;
  }
  if (colonyId === 'col_0' || colonyId === '0') {
    const all = await deeds.listAll();
    return all[0] ?? null;
  }
  return null;
}

export function buildDeedUpdateOutboxRow(
  record: StoredDeedRecord,
  nextMetadata: DeedMetadataV1,
  nextVersion: number,
  opId: string,
  change: string,
): OutboxEntry {
  return {
    opId,
    port: 'DeedNft',
    method: 'updateMetadata',
    payload: {
      collection: 'deed',
      tokenId: record.tokenId,
      metadata: nextMetadata,
      metadataJson: JSON.stringify(nextMetadata),
      colonyId: record.colonyId,
      planetId: record.planetId,
      version: nextVersion,
      change,
    },
  };
}
