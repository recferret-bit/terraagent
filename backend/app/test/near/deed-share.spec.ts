import 'reflect-metadata';
import { DeedMetadataV1, deedTokenId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import {
  buildDeedShareUrl,
  buildDeedTwitterIntentUrl,
  DeedShareController,
  escapeHtml,
  resolveForwardedOrigin,
  type ShareReplyLike,
} from '../../src/near/deed/deed-share.controller.js';
import { DeedTelemetryService } from '../../src/near/deed/deed-telemetry.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

describe('W20-12 Deed Share URL & Twitter intent helpers', () => {
  it('builds /deed/:tokenId share URLs and Twitter intent URLs with prefilled text and link', () => {
    expect(buildDeedShareUrl('deed:col_0')).toBe('/deed/deed%3Acol_0');
    expect(buildDeedShareUrl('deed:col_0', 'https://terraagent.com/')).toBe(
      'https://terraagent.com/deed/deed%3Acol_0',
    );

    const intentUrl = buildDeedTwitterIntentUrl({
      tokenId: 'deed:col_0',
      colonyName: 'Helios Crown',
      planetId: 'pl_ocean_1',
      stage: 4,
      terraformBp: 10_000,
      settled: true,
      origin: 'https://terraagent.com',
    });
    expect(intentUrl.startsWith('https://twitter.com/intent/tweet?')).toBe(true);
    const parsed = new URL(intentUrl);
    expect(parsed.searchParams.get('url')).toBe(
      'https://terraagent.com/deed/deed%3Acol_0',
    );
    expect(parsed.searchParams.get('text')).toContain('Helios Crown');
  });
});

describe('W20-12 DeedShareController SSR & OpenGraph rendering', () => {
  it('escapes HTML entities in OpenGraph/Twitter meta tags and renders SSR share page via DeedShareController', async () => {
    expect(escapeHtml('<script>"alert(\'xss\')&"</script>')).toBe(
      '&lt;script&gt;&quot;alert(&#39;xss&#39;)&amp;&quot;&lt;/script&gt;',
    );

    const flags = new FlagsService({ TA_WAVES: '..20' } as never);
    const repo = new DeedRepository();
    const telemetry = new DeedTelemetryService(undefined, flags, repo);
    const controller = new DeedShareController(flags, repo, telemetry);

    const colonyId = 'col_0';
    const tokenId = deedTokenId(colonyId);
    const meta = DeedMetadataV1.parse({
      planet: 'pl_share_1',
      colony: colonyId,
      colonyName: 'Vanguard <Alpha> & "Prime"',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 8000,
      status: 'settled',
      settled: true,
      version: 3,
      imageUrl: `/v1/near/deed/${encodeURIComponent(tokenId)}/image.png?v=3`,
    });

    await repo.upsertInitialMint({
      colonyId,
      planetId: 'pl_share_1',
      playerId: 'secret_player_123',
      accountId: 'col-0.owner.terraagent.mock',
      tokenId,
      metadata: meta,
      opId: `deed-mint:${colonyId}`,
    });

    const headers = new Map<string, string>();
    let endedBody = '';
    const res: ShareReplyLike = {
      setHeader: ((k: string, v: string | number | readonly string[]) => {
        headers.set(k.toLowerCase(), String(v));
        return res as never;
      }) as ShareReplyLike['setHeader'],
      end: ((chunk?: unknown) => {
        endedBody = String(chunk ?? '');
        return res as never;
      }) as ShareReplyLike['end'],
    };

    const html = await controller.getSharePage('deed-col_0', res);
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(endedBody).toBe(html);
    expect(html).toContain('property="og:image" content="/v1/near/deed/deed%3Acol_0/image.png?v=1"');
    expect(html).toContain('rel="canonical" href="/deed/deed%3Acol_0"');
    expect(html).toContain('href="/assets/deed-entry.css"');
    expect(html).toContain('src="/assets/deed-entry.js"');
    expect(html).toContain('rel="icon" href="/favicon.ico"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('Vanguard &lt;Alpha&gt; &amp; &quot;Prime&quot;');
    expect(html).not.toContain('<Alpha>');
    expect(html).not.toContain('secret_player_123');
    expect(html).toContain('Colonize on TerraAgent');
    expect(html).toContain('https://twitter.com/intent/tweet?');
    expect(telemetry.recordedEvents).toHaveLength(1);
    expect(telemetry.recordedEvents[0]?.name).toBe('deed_shared');
    expect(telemetry.recordedEvents[0]?.props).toMatchObject({
      colonyId: 'col_0',
      planetId: 'pl_share_1',
      tokenId: 'deed:col_0',
    });
  });

  it('throws 404 when W20 flag is disabled or deed is missing', async () => {
    const flagsOff = new FlagsService({ TA_WAVES: '..19' } as never);
    const repo = new DeedRepository();
    const controllerOff = new DeedShareController(flagsOff, repo);
    await expect(controllerOff.getSharePage('deed:col_0')).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });

    const flagsOn = new FlagsService({ TA_WAVES: '..20' } as never);
    const controllerOn = new DeedShareController(flagsOn, repo);
    await expect(controllerOn.getSharePage('deed:missing')).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });
  });
});

describe('W20-12 DeedShareController forwarded origin & canonical SEO tags', () => {
  it('derives absolute https origin for canonical/OG tags ONLY when x-forwarded-proto is present while keeping <img> src root-relative', async () => {
    expect(resolveForwardedOrigin(undefined)).toBe('');
    expect(resolveForwardedOrigin({ headers: { host: 'terraagent.fun' } } as never)).toBe('');
    expect(
      resolveForwardedOrigin({
        headers: { 'x-forwarded-proto': 'https', host: 'terraagent.fun' },
      } as never),
    ).toBe('https://terraagent.fun');
    expect(
      resolveForwardedOrigin({
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': '   ', host: 'play.terraagent.fun' },
      } as never),
    ).toBe('https://play.terraagent.fun');
    expect(
      resolveForwardedOrigin({
        headers: { 'x-forwarded-proto': 'javascript', host: 'terraagent.fun' },
      } as never),
    ).toBe('');

    const flags = new FlagsService({ TA_WAVES: '..20' } as never);
    const repo = new DeedRepository();
    const controller = new DeedShareController(flags, repo);
    const tokenId = deedTokenId('col_7');
    await repo.upsertInitialMint({
      colonyId: 'col_7',
      planetId: 'pl_ocean_7',
      playerId: 'pilot_7',
      accountId: 'col-7.owner.terraagent.testnet',
      tokenId,
      metadata: DeedMetadataV1.parse({
        planet: 'pl_ocean_7',
        colony: 'col_7',
        colonyName: 'Helios Spire',
        planetType: 'oceanForest',
        stage: 6,
        terraformBp: 9000,
        status: 'active',
        settled: false,
        version: 2,
        imageUrl: `/v1/near/deed/${encodeURIComponent(tokenId)}/image.png?v=2`,
      }),
      opId: 'deed-mint:col_7',
    });

    const proxiedHtml = await controller.getSharePage('deed:col_7', undefined, {
      headers: { 'x-forwarded-proto': 'https', host: 'terraagent.fun' },
    } as never);
    expect(proxiedHtml).toContain(
      'rel="canonical" href="https://terraagent.fun/deed/deed%3Acol_7"',
    );
    expect(proxiedHtml).toContain(
      'property="og:url" content="https://terraagent.fun/deed/deed%3Acol_7"',
    );
    expect(proxiedHtml).toContain(
      'property="og:image" content="https://terraagent.fun/v1/near/deed/deed%3Acol_7/image.png?v=1"',
    );
    expect(proxiedHtml).toContain(
      'name="twitter:image" content="https://terraagent.fun/v1/near/deed/deed%3Acol_7/image.png?v=1"',
    );
    expect(proxiedHtml).toContain(
      '<img src="/v1/near/deed/deed%3Acol_7/image.png?v=1"',
    );
  });
});
