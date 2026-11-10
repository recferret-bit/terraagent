import { Inject, Injectable, Optional } from '@nestjs/common';
import { DeedMetadataV1, deedTokenId } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { DeedRepository } from './deed.repository.js';
import {
  DEED_CARD_HEIGHT,
  DEED_CARD_WIDTH,
  type DeedVisualVariant,
  renderDeedCardPng,
  renderDeedCardSvg,
  resolveDeedVariant,
} from './parts/deed-card-render.js';

export {
  DEED_CARD_HEIGHT,
  DEED_CARD_WIDTH,
  type DeedVisualVariant,
  renderDeedCardPng,
  renderDeedCardSvg,
  resolveDeedVariant,
};

const MAX_CACHE_ENTRIES = 256;

export interface CachedDeedImage {
  readonly png: Buffer;
  readonly svg: string;
  readonly etag: string;
  readonly renderedAt: number;
}

export interface RenderedDeedImageResult {
  readonly png: Buffer;
  readonly svg: string;
  readonly etag: string;
  readonly cached: boolean;
  readonly version: number;
}

@Injectable()
export class DeedImageRendererService {
  private readonly deeds: DeedRepository;
  private readonly flags?: FlagsService;
  private readonly cache = new Map<string, CachedDeedImage>();

  constructor(
    @Inject(DeedRepository) deedsOrFlags: DeedRepository | FlagsService,
    @Optional() @Inject(FlagsService) flagsOrDeeds?: FlagsService | DeedRepository,
  ) {
    if (typeof (deedsOrFlags as FlagsService)?.has === 'function') {
      this.flags = deedsOrFlags as FlagsService;
      this.deeds = flagsOrDeeds as DeedRepository;
    } else {
      this.deeds = deedsOrFlags as DeedRepository;
      this.flags = flagsOrDeeds as FlagsService | undefined;
    }
  }

  async renderForToken(tokenId: string): Promise<RenderedDeedImageResult> {
    if (this.flags && !this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }

    const record =
      (await this.deeds.findByTokenId(tokenId)) ??
      (await this.deeds.findByColonyId(tokenId));
    if (!record) {
      throw new CoreException('DEED_NOT_FOUND', {
        status: 404,
        message: 'Deed not found',
      });
    }

    const version = record.metadataVersion || record.metadata.version || 1;
    const status = record.status ?? record.metadata.status;
    const settled = Boolean(record.settled || record.metadata.settled);
    const meta: DeedMetadataV1 = {
      ...record.metadata,
      status,
      settled,
      version,
    };

    const key = `${record.tokenId}:v${version}:${status}:${settled ? 1 : 0}:${meta.terraformBp ?? 0}:${meta.stage ?? 0}`;
    const hit = this.cache.get(key);
    if (hit) {
      return {
        png: hit.png,
        svg: hit.svg,
        etag: hit.etag,
        cached: true,
        version,
      };
    }

    const svg = renderDeedCardSvg(meta, {
      tokenId: record.tokenId,
      ownerAccountId: record.accountId,
    });
    const png = renderDeedCardPng(meta);
    const etag = `"deed-${record.tokenId}-v${version}-${status}-${settled ? 1 : 0}"`;

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { png, svg, etag, renderedAt: Date.now() });

    return {
      png,
      svg,
      etag,
      cached: false,
      version,
    };
  }

  invalidate(tokenId: string): void {
    const normalized = deedTokenId(tokenId);
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${normalized}:`) || key.startsWith(`${tokenId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
