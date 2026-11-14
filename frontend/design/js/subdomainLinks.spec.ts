// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSubdomainHref, rewriteSubdomainLinks } from './subdomainLinks';

describe('resolveSubdomainHref across standalone docs subdomains and localhost', () => {
  it('rewrites cross-surface hrefs on whitepaper.terraagent.fun while preserving same-origin and hash links', () => {
    const host = 'whitepaper.terraagent.fun';
    expect(resolveSubdomainHref('/', host)).toBe('https://terraagent.fun/');
    expect(resolveSubdomainHref('/landing.html', host)).toBe('https://terraagent.fun/');
    expect(resolveSubdomainHref('/landing.html#protocol', host)).toBe('https://terraagent.fun/#protocol');
    expect(resolveSubdomainHref('/play.html', host)).toBe('https://play.terraagent.fun/');
    expect(resolveSubdomainHref('/play.html?planet=dune&skip=1', host)).toBe(
      'https://play.terraagent.fun/play.html?planet=dune&skip=1',
    );
    expect(resolveSubdomainHref('/trade.html', host)).toBe('https://play.terraagent.fun/trade.html');
    expect(resolveSubdomainHref('/me.html', host)).toBe('https://play.terraagent.fun/me.html');
    expect(resolveSubdomainHref('/me', host)).toBe('https://play.terraagent.fun/me.html');
    expect(resolveSubdomainHref('/deed', host)).toBe('https://play.terraagent.fun/deed.html');
    expect(resolveSubdomainHref('/deed?tokenId=deed:col_0', host)).toBe(
      'https://play.terraagent.fun/deed.html?tokenId=deed:col_0',
    );
    expect(resolveSubdomainHref('/deed.html', host)).toBe('https://play.terraagent.fun/deed.html');
    expect(resolveSubdomainHref('/deed/token-1', host)).toBe('https://play.terraagent.fun/deed/token-1');
    expect(resolveSubdomainHref('/dev/economy-sim', host)).toBe('https://play.terraagent.fun/dev/economy-sim/');
    expect(resolveSubdomainHref('/dev/economy-sim?seed=alpha', host)).toBe(
      'https://play.terraagent.fun/dev/economy-sim/?seed=alpha',
    );
    expect(resolveSubdomainHref('/dev/economy-sim/', host)).toBe('https://play.terraagent.fun/dev/economy-sim/');
    expect(resolveSubdomainHref('/dev/chain/', host)).toBe('https://devchain.terraagent.fun/');
    expect(resolveSubdomainHref('/dev/chain/tx/mock%3A1', host)).toBe(
      'https://devchain.terraagent.fun/dev/chain/tx/mock%3A1',
    );
    expect(resolveSubdomainHref('/playground.html', host)).toBe('https://playground.terraagent.fun/');
    expect(resolveSubdomainHref('/playground.html?inspect=worker', host)).toBe(
      'https://playground.terraagent.fun/playground.html?inspect=worker',
    );
    expect(resolveSubdomainHref('/pitchdeck/', host)).toBe('https://pitchdeck.terraagent.fun/');
    expect(resolveSubdomainHref('/design/', host)).toBe('https://design.terraagent.fun/');
    expect(resolveSubdomainHref('/design/foundations.html', host)).toBe(
      'https://design.terraagent.fun/design/foundations.html',
    );
    expect(resolveSubdomainHref('/v1/near/protocol', host)).toBe('https://api.terraagent.fun/v1/near/protocol');
    expect(resolveSubdomainHref('/v1/signature/cht_123', host)).toBe(
      'https://cloud-api.near.ai/v1/signature/cht_123',
    );
    expect(resolveSubdomainHref('/whitepaper/', host)).toBeNull();
    expect(resolveSubdomainHref('#sec-01', host)).toBeNull();
    expect(resolveSubdomainHref('https://testnet.nearblocks.io/address/res.terraagent.testnet', host)).toBeNull();
  });

  it('rewrites cross-surface hrefs on pitchdeck.terraagent.fun without rewriting /pitchdeck/', () => {
    const host = 'pitchdeck.terraagent.fun';
    expect(resolveSubdomainHref('/', host)).toBe('https://terraagent.fun/');
    expect(resolveSubdomainHref('/landing.html', host)).toBe('https://terraagent.fun/');
    expect(resolveSubdomainHref('/whitepaper/', host)).toBe('https://whitepaper.terraagent.fun/');
    expect(resolveSubdomainHref('/whitepaper/#sec-02', host)).toBe('https://whitepaper.terraagent.fun/#sec-02');
    expect(resolveSubdomainHref('/play.html?planet=oceanForest&deploy=1', host)).toBe(
      'https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1',
    );
    expect(resolveSubdomainHref('/v1/near/status', host)).toBe('https://api.terraagent.fun/v1/near/status');
    expect(resolveSubdomainHref('/pitchdeck/', host)).toBeNull();
  });

  it('rewrites /landing.html on design.terraagent.fun while keeping root-relative /design/*.html intact', () => {
    const host = 'design.terraagent.fun';
    expect(resolveSubdomainHref('/landing.html', host)).toBe('https://terraagent.fun/');
    expect(resolveSubdomainHref('/design/index.html', host)).toBeNull();
    expect(resolveSubdomainHref('/design/foundations.html', host)).toBeNull();
    expect(resolveSubdomainHref('/design/storybook.html', host)).toBeNull();
    expect(resolveSubdomainHref('/design/motion.html', host)).toBeNull();
  });

  it('leaves all hrefs untouched on localhost, 127.0.0.1, and apex terraagent.fun', () => {
    for (const host of ['localhost', '127.0.0.1', 'terraagent.fun', 'play.terraagent.fun']) {
      expect(resolveSubdomainHref('/landing.html', host)).toBeNull();
      expect(resolveSubdomainHref('/play.html?planet=dune&skip=1', host)).toBeNull();
      expect(resolveSubdomainHref('/trade.html', host)).toBeNull();
      expect(resolveSubdomainHref('/design/foundations.html', host)).toBeNull();
      expect(resolveSubdomainHref('/v1/near/protocol', host)).toBeNull();
    }
  });

  it('rewrites dynamically mounted DOM links on whitepaper.terraagent.fun and skips localhost', () => {
    const container = document.createElement('div');
    const playLink = document.createElement('a');
    playLink.setAttribute('href', '/play.html?planet=dune&skip=1');
    const simLink = document.createElement('a');
    simLink.setAttribute('href', '/dev/economy-sim/');
    const railLink = document.createElement('a');
    railLink.setAttribute('href', '#sec-03');
    container.append(playLink, simLink, railLink);

    rewriteSubdomainLinks(container, 'localhost');
    expect(playLink.getAttribute('href')).toBe('/play.html?planet=dune&skip=1');

    rewriteSubdomainLinks(container, 'whitepaper.terraagent.fun');
    expect(playLink.getAttribute('href')).toBe('https://play.terraagent.fun/play.html?planet=dune&skip=1');
    expect(simLink.getAttribute('href')).toBe('https://play.terraagent.fun/dev/economy-sim/');
    expect(railLink.getAttribute('href')).toBe('#sec-03');
  });
});

describe('design docs HTML pages avoid relative 404 links on design.terraagent.fun', () => {
  const designDir = resolve(import.meta.dirname, '..');

  it('uses root-relative /design/*.html hrefs, loads js/nav.js, and keeps landing description current', () => {
    for (const page of ['index.html', 'foundations.html', 'storybook.html', 'motion.html']) {
      const html = readFileSync(resolve(designDir, page), 'utf8');
      expect(html, `${page} must load js/nav.js`).toContain('<script type="module" src="js/nav.js"></script>');
      expect(html, `${page} must not use bare relative inter-page hrefs`).not.toMatch(
        /href="(?:index|foundations|storybook|motion)\.html"/,
      );
    }

    const indexHtml = readFileSync(resolve(designDir, 'index.html'), 'utf8');
    expect(indexHtml).toContain(
      'terraagent.fun with a live 3D WebGL orbital planet, Thalassa hex colony, and TerraAgent Protocol board.',
    );
    expect(indexHtml).not.toContain('Canvas 2D hex colony');
  });
});
