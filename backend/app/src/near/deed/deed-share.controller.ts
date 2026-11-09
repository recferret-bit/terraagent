import {
  Controller,
  Get,
  Inject,
  Optional,
  Param,
  Res,
} from '@nestjs/common';
import type { PublicDeedResponse } from '@terra/contracts';
import type { ServerResponse } from 'node:http';
import { CoreException } from '../../core/errors/index.js';
import { FlagsService } from '../../flags/flags.service.js';
import { DeedTelemetryService } from './deed-telemetry.service.js';
import { DeedRepository } from './deed.repository.js';

export interface ShareReplyLike extends Partial<ServerResponse> {
  header?: (name: string, value: string) => unknown;
  type?: (contentType: string) => unknown;
  send?: (body: string) => unknown;
}

export interface ShareTwitterIntentOptions {
  readonly tokenId: string;
  readonly colonyName?: string;
  readonly planetId?: string;
  readonly stage?: number;
  readonly terraformBp?: number;
  readonly settled?: boolean;
  readonly origin?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDeedShareUrl(tokenId: string, origin?: string): string {
  const cleanOrigin = origin ? origin.trim().replace(/\/+$/, '') : '';
  const cleanToken = tokenId.trim();
  return `${cleanOrigin}/deed/${encodeURIComponent(cleanToken)}`;
}

export function buildDeedTwitterIntentUrl(
  opts: ShareTwitterIntentOptions,
): string {
  const name = opts.colonyName?.trim() || opts.tokenId.trim();
  const stage =
    typeof opts.stage === 'number' && Number.isFinite(opts.stage)
      ? Math.max(0, Math.min(10, Math.trunc(opts.stage)))
      : 0;
  const bp =
    typeof opts.terraformBp === 'number' && Number.isFinite(opts.terraformBp)
      ? Math.max(0, Math.min(10_000, Math.trunc(opts.terraformBp)))
      : 0;
  const pct = Math.round(bp / 100);
  const badge = opts.settled ? 'Settled Colony Deed' : 'Colony Deed';
  const planetPart = opts.planetId?.trim() ? ` on ${opts.planetId.trim()}` : '';
  const text = `${name}${planetPart} — Stage S${stage} ${badge} (${pct}% Terraformed) on TerraAgent #NEAR`;
  const shareUrl = buildDeedShareUrl(opts.tokenId, opts.origin);
  const params = new URLSearchParams({ text, url: shareUrl });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function renderHistoryItemsHtml(deed: PublicDeedResponse): string {
  if (deed.history.length === 0) {
    return `<li class="deed-share-history-item"><span>v${deed.version}</span><span>Colony Deed minted</span></li>`;
  }
  return deed.history
    .map((h) => {
      const txPart = h.txHash ? ` · <code>${escapeHtml(h.txHash)}</code>` : '';
      return `<li class="deed-share-history-item"><strong>v${h.version}</strong> — ${escapeHtml(h.change)}${txPart}</li>`;
    })
    .join('\n          ');
}

function renderShareHeadHtml(opts: {
  escTitle: string;
  escDesc: string;
  escImageUrl: string;
  escCanonical: string;
}): string {
  return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${opts.escTitle}</title>
  <meta name="description" content="${opts.escDesc}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="TerraAgent" />
  <meta property="og:title" content="${opts.escTitle}" />
  <meta property="og:description" content="${opts.escDesc}" />
  <meta property="og:image" content="${opts.escImageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${opts.escCanonical}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${opts.escTitle}" />
  <meta name="twitter:description" content="${opts.escDesc}" />
  <meta name="twitter:image" content="${opts.escImageUrl}" />
  <link rel="stylesheet" href="/design/css/tokens.css" />
  <link rel="stylesheet" href="/design/css/base.css" />
</head>`;
}

export function renderDeedShareHtml(deed: PublicDeedResponse): string {
  const meta = deed.metadata;
  const colonyName = meta.colonyName ?? meta.colony;
  const stage = Math.max(0, Math.min(10, Math.trunc(meta.stage ?? 0)));
  const terraformBp = Math.max(0, Math.min(10_000, Math.trunc(meta.terraformBp ?? 0)));
  const terraformPct = Math.round(terraformBp / 100);
  const settled = Boolean(deed.settled || meta.settled);
  const statusUpper = (deed.status || meta.status).toUpperCase();
  const badgeText = settled ? 'SETTLED DEED' : `${statusUpper} DEED`;

  const title = `${colonyName} — Stage S${stage} Colony Deed | TerraAgent`;
  const description = `Terraform ${terraformPct}% · Status: ${statusUpper}${settled ? ' (Settled)' : ''} · Planet ${deed.planetId} · Token ${deed.tokenId} on NEAR`;
  const imageUrl = `/v1/near/deed/${encodeURIComponent(deed.tokenId)}/image.png?v=${deed.version}`;
  const twitterIntentUrl = buildDeedTwitterIntentUrl({
    tokenId: deed.tokenId,
    colonyName,
    planetId: deed.planetId,
    stage,
    terraformBp,
    settled,
  });

  const escColony = escapeHtml(colonyName);
  const escToken = escapeHtml(deed.tokenId);
  const escBadge = escapeHtml(badgeText);
  const escImageUrl = escapeHtml(imageUrl);
  const headHtml = renderShareHeadHtml({
    escTitle: escapeHtml(title),
    escDesc: escapeHtml(description),
    escImageUrl,
    escCanonical: escapeHtml(buildDeedShareUrl(deed.tokenId)),
  });

  return `<!doctype html>
<html lang="en">
${headHtml}
<body>
  <div id="app" data-token-id="${escToken}">
    <main class="container" data-testid="deed-share-page">
      <header class="plate-sm" data-testid="deed-share-header">
        <p class="eyebrow">TERRAAGENT // COLONY DEED SHARE</p>
        <h1 class="h2">${escColony}</h1>
        <span class="badge" data-testid="deed-share-badge">${escBadge} · v${deed.version}</span>
      </header>
      <section class="plate card" data-testid="deed-share-card">
        <img src="${escImageUrl}" width="1200" height="630" alt="${escColony} — ${escBadge}" data-testid="deed-share-image" />
        <dl data-testid="deed-share-stats">
          <div><dt class="label">COLONY</dt><dd>${escColony}</dd></div>
          <div><dt class="label">PLANET</dt><dd>${escapeHtml(deed.planetId)}</dd></div>
          <div><dt class="label">STAGE</dt><dd>S${stage}</dd></div>
          <div><dt class="label">TERRAFORM</dt><dd>${terraformPct}%</dd></div>
          <div><dt class="label">TOKEN ID</dt><dd class="mono">${escToken}</dd></div>
          <div><dt class="label">OWNER ACCOUNT</dt><dd class="mono">${escapeHtml(deed.ownerAccountId)}</dd></div>
          <div><dt class="label">CONTRACT</dt><dd class="mono">${escapeHtml(deed.contractId)}</dd></div>
        </dl>
        <div data-testid="deed-share-actions">
          <a class="btn btn-primary" href="/play.html" data-testid="deed-colonize-cta">Colonize on TerraAgent</a>
          <a class="btn btn-ghost" href="${escapeHtml(twitterIntentUrl)}" target="_blank" rel="noopener noreferrer" data-testid="deed-share-x-btn">Share on X</a>
        </div>
      </section>
      <section class="plate card" data-testid="deed-share-history">
        <h2 class="h3">Metadata History</h2>
        <ul>
          ${renderHistoryItemsHtml(deed)}
        </ul>
      </section>
    </main>
  </div>
  <script type="module" src="/game/pages/deed/main.ts"></script>
</body>
</html>`;
}

function sendHtmlResponse(res: ShareReplyLike | undefined, html: string): string {
  if (!res) return html;
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
  } else if (typeof res.header === 'function') {
    res.header('content-type', 'text/html; charset=utf-8');
    res.header('cache-control', 'no-cache');
  }
  if (typeof res.end === 'function' && typeof res.setHeader === 'function') {
    res.end(html);
  } else if (typeof res.send === 'function') {
    res.send(html);
  }
  return html;
}

/**
 * Public SSR OpenGraph & Twitter Card Colony Deed share page (`GET /deed/:tokenId` and `GET /v1/deed/:tokenId`, W20-12).
 */
@Controller()
export class DeedShareController {
  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(DeedRepository) private readonly deeds: DeedRepository,
    @Optional()
    @Inject(DeedTelemetryService)
    private readonly telemetry?: DeedTelemetryService,
  ) {}

  @Get(['deed/:tokenId', 'v1/deed/:tokenId'])
  async getSharePage(
    @Param('tokenId') rawTokenId: string,
    @Res() res?: ShareReplyLike,
  ): Promise<string> {
    if (!this.flags.has('W20')) {
      throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawTokenId);
    } catch {
      decoded = rawTokenId;
    }
    const record = await this.deeds.findByTokenId(decoded);
    if (!record) {
      throw new CoreException('DEED_NOT_FOUND', {
        status: 404,
        message: 'Deed not found',
      });
    }

    await this.telemetry?.trackEvent('deed_shared', {
      colonyId: record.colonyId,
      planetId: record.planetId,
      tokenId: record.tokenId,
      channel: 'share_page',
    });

    const publicDeed = this.deeds.toPublicDeedResponse(record);
    const html = renderDeedShareHtml(publicDeed);
    return sendHtmlResponse(res, html);
  }
}
