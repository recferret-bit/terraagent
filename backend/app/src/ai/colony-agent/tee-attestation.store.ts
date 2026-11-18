import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import type { LlmAttestation } from '../../ports/llm-provider.port.js';
import type { AgentDirective } from './colony-agent-types.js';

export interface StoredTeeAttestation {
  readonly id: string;
  readonly colonyId: string;
  readonly planetId: string;
  readonly chatId: string;
  readonly model: string;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly signingAlgo: string;
  readonly signingAddress: string | null;
  readonly signature: string | null;
  readonly signatureText: string;
  readonly signatureKind: string;
  readonly verified: boolean;
  readonly cryptoVerified: boolean;
  readonly directiveJson: unknown;
  readonly createdAt: string;
}

const MAX_MEM_ROWS = 200;

@Injectable()
export class TeeAttestationStore {
  private readonly mem: StoredTeeAttestation[] = [];

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
  ) {}

  async record(entry: {
    readonly colonyId: string;
    readonly planetId: string;
    readonly model: string;
    readonly directive: AgentDirective;
    readonly attestation: LlmAttestation;
  }): Promise<StoredTeeAttestation> {
    const signatureKind = entry.attestation.signatureKind ?? 'provider_tee';
    const signatureText =
      entry.attestation.signedText ??
      (signatureKind === 'gateway'
        ? `${entry.attestation.requestHash}:${entry.attestation.responseHash}`
        : `${entry.model}:${entry.attestation.requestHash}:${entry.attestation.responseHash}`);
    const row: StoredTeeAttestation = {
      id: `tee_${randomUUID().slice(0, 12)}`,
      colonyId: entry.colonyId,
      planetId: entry.planetId,
      chatId: entry.attestation.chatId,
      model: entry.model,
      requestHash: entry.attestation.requestHash,
      responseHash: entry.attestation.responseHash,
      signingAlgo: entry.attestation.signingAlgo ?? 'ecdsa',
      signingAddress: entry.attestation.signingAddress ?? null,
      signature: entry.attestation.signature ?? null,
      signatureText,
      signatureKind,
      verified: entry.attestation.verified,
      cryptoVerified: entry.attestation.cryptoVerified ?? false,
      directiveJson: entry.directive,
      createdAt: new Date().toISOString(),
    };
    this.mem.unshift(row);
    if (this.mem.length > MAX_MEM_ROWS) this.mem.length = MAX_MEM_ROWS;

    if (this.prisma && this.env && databaseEnabled(this.env)) {
      await this.prisma.directorTeeAttestation
        .create({
          data: {
            id: row.id,
            colonyId: row.colonyId,
            planetId: row.planetId,
            chatId: row.chatId,
            model: row.model,
            requestHash: row.requestHash,
            responseHash: row.responseHash,
            signingAlgo: row.signingAlgo,
            signingAddress: row.signingAddress,
            signature: row.signature,
            signatureText: row.signatureText,
            signatureKind: row.signatureKind,
            verified: row.verified,
            cryptoVerified: row.cryptoVerified,
            directiveJson: row.directiveJson as object,
          },
        })
        .catch(() => undefined);
    }
    return row;
  }

  async listForColony(colonyId: string, limit = 10): Promise<StoredTeeAttestation[]> {
    const cap = Math.max(1, Math.min(50, limit));
    if (this.prisma && this.env && databaseEnabled(this.env)) {
      const rows = await this.prisma.directorTeeAttestation
        .findMany({
          where: { colonyId },
          orderBy: { createdAt: 'desc' },
          take: cap,
        })
        .catch(() => null);
      if (rows) {
        return rows.map((r) => ({
          id: r.id,
          colonyId: r.colonyId,
          planetId: r.planetId,
          chatId: r.chatId,
          model: r.model,
          requestHash: r.requestHash,
          responseHash: r.responseHash,
          signingAlgo: r.signingAlgo,
          signingAddress: r.signingAddress,
          signature: r.signature,
          signatureText:
            r.signatureText ??
            (r.signatureKind === 'gateway'
              ? `${r.requestHash}:${r.responseHash}`
              : `${r.model}:${r.requestHash}:${r.responseHash}`),
          signatureKind: r.signatureKind,
          verified: r.verified,
          cryptoVerified: r.cryptoVerified,
          directiveJson: r.directiveJson,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    }
    return this.mem.filter((r) => r.colonyId === colonyId).slice(0, cap);
  }
}
