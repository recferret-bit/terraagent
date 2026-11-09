import { describe, expect, it } from 'vitest';
import { versionReloadUrl } from './VersionMismatchNotice';

describe('version mismatch reload destination', () => {
  it('rejoins the running scenario planet and preserves identity and playback settings', () => {
    const url = new URL(versionReloadUrl('https://game.test/play.html?scenario=w07&as=pilot&predict=0&waves=..07', 'pl_current'));
    expect(url.searchParams.has('scenario')).toBe(false);
    expect(Object.fromEntries(url.searchParams)).toEqual({ as: 'pilot', predict: '0', waves: '..07', join: 'pl_current' });
  });

  it.each([
    ['https://game.test/play.html?join=pl_current&as=pilot', 'pl_current'],
    ['https://game.test/play.html?planet=dune&skip=1', 'pl_current'],
    ['https://game.test/play.html?host=local&scenario=w07', 'local'],
    ['https://game.test/play.html?scenario=w07', null],
  ])('preserves the existing destination when no scenario conversion is needed: %s', (href, planet) => {
    expect(versionReloadUrl(href, planet)).toBe(href);
  });
});
