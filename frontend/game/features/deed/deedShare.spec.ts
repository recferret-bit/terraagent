import { describe, expect, it } from 'vitest';
import {
  buildDeedImageUrl,
  buildDeedSharePath,
  buildDeedShareUrl,
  buildDeedTwitterIntentText,
  buildDeedTwitterIntentUrl,
  extractDeedTokenIdFromLocation,
} from './deedShare';

describe('W20-12 Frontend Deed Share URL & Twitter intent helpers', () => {
  it('builds /deed/:tokenId share URLs, image URLs, and Twitter intent URLs', () => {
    expect(buildDeedSharePath('deed:col_0')).toBe('/deed/deed%3Acol_0');
    expect(buildDeedShareUrl('deed-col_0', 'http://localhost:3000')).toBe(
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

    const clientIntentUrl = buildDeedTwitterIntentUrl({
      tokenId: 'deed:col_0',
      colonyName: 'Aegis Spire',
      stage: 2,
      terraformBp: 4000,
      origin: 'https://terraagent.com',
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
        pathname: '/play.html',
        search: '',
      }),
    ).toBeNull();
    expect(() => buildDeedSharePath('   ')).toThrow(/tokenId is required/);
    expect(() => buildDeedImageUrl('')).toThrow(/tokenId is required/);
  });
});
