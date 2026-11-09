import 'reflect-metadata';
import { DeedMetadataV1, deedTokenId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildDeedImageUrl,
  buildDeedSharePath,
  buildDeedShareUrl as buildClientShareUrl,
  buildDeedTwitterIntentText,
  buildDeedTwitterIntentUrl as buildClientTwitterIntentUrl,
  extractDeedTokenIdFromLocation,
} from '../../../../frontend/game/features/deed/deedShare.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import {
  buildDeedShareUrl,
  buildDeedTwitterIntentUrl,
  DeedShareController,
  escapeHtml,
  renderDeedShareHtml,
  type ShareReplyLike,
} from '../../src/near/deed/deed-share.controller.js';
import { DeedTelemetryService } from '../../src/near/deed/deed-telemetry.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

describe('W20-12 Deed Share URL & Twitter intent helpers', () => {
  it('builds /deed/:tokenId share URLs, image URLs, and Twitter intent URLs with prefilled text and link', () => {
    expect(buildDeedSharePath('deed:col_0')).toBe('/deed/deed%3Acol_0');
    expect(buildDeedShareUrl('deed:col_0')).toBe('/deed/deed%3Acol_0');
    expect(buildDeedShareUrl('deed:col_0', 'https://terraagent.com/')).toBe(
      'https://terraagent.com/deed/deed%3Acol_0',
    );
    expect(buildClientShareUrl('deed-col_0', 'http://localhost:3000')).toBe(
      'http://localhost:3000/deed/deed-col_0',
    );
    expect(buildDeedImageUrl('deed:col_0', 3)).toBe(
      '/v1/near/deed/deed%3Acol_0/image.png?v=3',
    );

    const text = buildDeedTwitterIntentText({
      tokenId: 'deed:col_0',
      colonyName: 'Helios Crown',
      planetId: 'pl_ocean_1',
      stage: 4,
      terraformBp: 10_000,
      settled: true,
    });
    expect(text).toContain('Helios Crown on pl_ocean_1');
    expect(text).toContain('Stage S4 Settled Colony Deed (100% Terraformed)');

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

    const clientIntentUrl = buildClientTwitterIntentUrl({
      tokenId: 'deed:col_0',
      colonyName: 'Aegis Spire',
      stage: 2,
      terraformBp: 4000,
    });
    expect(clientIntentUrl).toContain('https://twitter.com/intent/tweet?');
  });

  it('extracts tokenId from query params or /deed/:tokenId pathname and rejects blank inputs', () => {
    expect(
      extractDeedTokenIdFromLocation({
        pathname: '/deed.html',
        search: '?tokenId=deed:col_7',
      }),
    ).toBe('deed:col_7');
    expect(
      extractDeedTokenIdFromLocation({
        pathname: '/deed/deed%3Acol_9',
        search: '',
      }),
    ).toBe('deed:col_9');
    expect(
      extractDeedTokenIdFromLocation({
        pathname: '/v1/deed/deed-col_0',
        search: '',
      }),
    ).toBe('deed-col_0');
    expect(
      extractDeedTokenIdFromLocation({
        pathname: '/play.html',
        search: '',
      }),
    ).toBeNull();
    expect(() => buildDeedSharePath('   ')).toThrow(/tokenId is required/);
    expect(() => buildDeedImageUrl('')).toThrow(/tokenId is required/);
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
      setHeader: (k, v) => {
        headers.set(k.toLowerCase(), String(v));
      },
      end: ((chunk?: unknown) => {
        endedBody = String(chunk ?? '');
      }) as ShareReplyLike['end'],
    };

    const html = await controller.getSharePage('deed-col_0', res);
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(endedBody).toBe(html);
    expect(html).toContain('property="og:image" content="/v1/near/deed/deed%3Acol_0/image.png?v=1"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('Vanguard &lt;Alpha&gt; &amp; &quot;Prime&quot;');
    expect(html).not.toContain('<Alpha>');
    expect(html).not.toContain('secret_player_123');
    expect(html).toContain('Colonize on TerraAgent');
    expect(html).toContain('https://twitter.com/intent/tweet?');
    expect(telemetry.recordedEvents).toHaveLength(1);
    expect(telemetry.recordedEvents[0]?.name).toBe('deed_shared');

    const rendered = renderDeedShareHtml(
      repo.toPublicDeedResponse((await repo.findByTokenId(tokenId))!),
    );
    expect(rendered).toContain('og:description');
  });

  it('throws 404 DEED_NOT_FOUND for unknown token and 404 NOT_FOUND when W20 flag is off', async () => {
    const flagsOn = new FlagsService({ TA_WAVES: '..20' } as never);
    const repo = new DeedRepository();
    const controllerOn = new DeedShareController(flagsOn, repo);

    await expect(controllerOn.getSharePage('deed:missing')).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });

    const flagsOff = new FlagsService({ TA_WAVES: '..19' } as never);
    const controllerOff = new DeedShareController(flagsOff, repo);
    await expect(controllerOff.getSharePage('deed:col_0')).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
  });
});
