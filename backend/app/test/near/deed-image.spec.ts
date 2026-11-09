import 'reflect-metadata';
import { DeedMetadataV1, deedTokenId } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import {
  DEED_CARD_HEIGHT,
  DEED_CARD_WIDTH,
  DeedImageRendererService,
  renderDeedCardPng,
  renderDeedCardSvg,
} from '../../src/near/deed/deed-image.renderer.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';

function makeMeta(overrides: Partial<DeedMetadataV1> = {}): DeedMetadataV1 {
  return DeedMetadataV1.parse({
    planet: 'pl_ares_1',
    colony: 'col_0',
    colonyName: 'Ares Bastion',
    planetType: 'dune',
    stage: 3,
    terraformBp: 4000,
    tradeVolume: 300,
    truces: 1,
    rank: 2,
    territoryHexes: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ],
    status: 'active',
    settled: false,
    version: 1,
    imageUrl: '/v1/near/deed/deed%3Acol_0/image.png?v=1',
    ...overrides,
  });
}

describe('W20-08 Deed image renderer (unit)', () => {
  it('renders a valid 1200x630 PNG with valid magic signature and IHDR dimensions', () => {
    const png = renderDeedCardPng(makeMeta());
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBe(DEED_CARD_WIDTH);
    expect(height).toBe(DEED_CARD_HEIGHT);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it('produces distinct SVG and PNG outputs for active, settled (gold), and eliminated (grey) variants', () => {
    const activeMeta = makeMeta({ status: 'active', settled: false });
    const settledMeta = makeMeta({ status: 'settled', settled: true, stage: 4, terraformBp: 10_000 });
    const eliminatedMeta = makeMeta({ status: 'eliminated', settled: false });

    const activeSvg = renderDeedCardSvg(activeMeta);
    const settledSvg = renderDeedCardSvg(settledMeta);
    const eliminatedSvg = renderDeedCardSvg(eliminatedMeta);

    expect(activeSvg).toContain('#FF6A13');
    expect(activeSvg).toContain('ACTIVE DEED');
    expect(activeSvg).toContain('S3');
    expect(activeSvg).toContain('40%');

    expect(settledSvg).toContain('#FFCF5A');
    expect(settledSvg).toContain('SETTLED DEED');
    expect(settledSvg).toContain('S4');
    expect(settledSvg).toContain('100%');

    expect(eliminatedSvg).toContain('#5A6270');
    expect(eliminatedSvg).toContain('ELIMINATED');

    const activePng = renderDeedCardPng(activeMeta);
    const settledPng = renderDeedCardPng(settledMeta);
    const eliminatedPng = renderDeedCardPng(eliminatedMeta);

    expect(activePng.equals(settledPng)).toBe(false);
    expect(activePng.equals(eliminatedPng)).toBe(false);
    expect(settledPng.equals(eliminatedPng)).toBe(false);
  });

  it('escapes XML characters in colony name and falls back to 7-hex cluster when territoryHexes is omitted', () => {
    const meta = makeMeta({
      colonyName: 'Alpha & <Omega> "Prime" \'One\'',
      territoryHexes: undefined,
    });
    const svg = renderDeedCardSvg(meta, {
      tokenId: 'deed:col_0',
      ownerAccountId: 'col-0.terraagent.mock',
    });
    expect(svg).toContain('Alpha &amp; &lt;Omega&gt; &quot;Prime&quot; &apos;One&apos;');
    expect(svg).toContain('HEX TERRITORY (7)');
    expect(svg).toContain('col-0.terraagent.mock');
  });
});

describe('W20-08 DeedImageRendererService caching & error handling (unit)', () => {
  it('caches by version and serves second request in < 20 ms; re-renders when version bumps', async () => {
    const flags = new FlagsService({ TA_WAVES: '..20' } as never);
    const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
    const service = new DeedImageRendererService(repo, flags);

    const tokenId = deedTokenId('col_cache');
    await repo.upsertInitialMint({
      colonyId: 'col_cache',
      planetId: 'pl_1',
      playerId: 'player_1',
      accountId: 'col-cache.terraagent.mock',
      tokenId,
      metadata: makeMeta({ colony: 'col_cache', version: 1, terraformBp: 2000 }),
      opId: 'deed-mint:col_cache',
    });

    const first = await service.renderForToken(tokenId);
    expect(first.cached).toBe(false);
    expect(first.version).toBe(1);
    expect(first.png.readUInt32BE(16)).toBe(1200);
    expect(first.png.readUInt32BE(20)).toBe(630);

    const t0 = performance.now();
    const second = await service.renderForToken(tokenId);
    const elapsedMs = performance.now() - t0;

    expect(second.cached).toBe(true);
    expect(elapsedMs).toBeLessThan(20);
    expect(second.png.equals(first.png)).toBe(true);
    expect(second.etag).toBe(first.etag);

    // Bump version on the stored record -> should miss cache and re-render
    const rec = await repo.findByTokenId(tokenId);
    expect(rec).not.toBeNull();
    rec!.metadataVersion = 2;
    rec!.metadata = makeMeta({ colony: 'col_cache', version: 2, terraformBp: 6000 });

    const third = await service.renderForToken(tokenId);
    expect(third.cached).toBe(false);
    expect(third.version).toBe(2);
    expect(third.png.equals(first.png)).toBe(false);
    expect(third.svg).toContain('v2');
    expect(third.svg).toContain('60%');

    // Invalidate clears cache
    service.invalidate(tokenId);
    const fourth = await service.renderForToken(tokenId);
    expect(fourth.cached).toBe(false);
  });

  it('throws DEED_NOT_FOUND (404) for unknown token and NOT_FOUND (404) when W20 is disabled', async () => {
    const flagsOn = new FlagsService({ TA_WAVES: '..20' } as never);
    const repo = new DeedRepository({ NODE_ENV: 'test' } as never);
    const service = new DeedImageRendererService(repo, flagsOn);

    await expect(service.renderForToken('deed:unknown')).rejects.toMatchObject({
      errorCode: 'DEED_NOT_FOUND',
      status: 404,
    });

    const flagsOff = new FlagsService({ TA_WAVES: '..19' } as never);
    const disabledService = new DeedImageRendererService(repo, flagsOff);
    await expect(disabledService.renderForToken('deed:col_0')).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
      status: 404,
    });
  });
});
