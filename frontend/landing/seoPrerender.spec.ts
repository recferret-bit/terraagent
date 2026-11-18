// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLandingJsonLd, prerenderLandingHtml } from './seoPrerender';

describe('Landing build-time SEO pre-renderer & JSON-LD', () => {
  it('injects @graph JSON-LD (WebSite, Organization, VideoGame, FAQPage) and pre-renders sections without banned strings', () => {
    const landingPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../landing.html');
    const sourceHtml = fs.readFileSync(landingPath, 'utf8');
    const builtHtml = prerenderLandingHtml(sourceHtml);

    expect(builtHtml).toContain('application/ld+json');
    expect(builtHtml).toContain('"@type":"WebSite"');
    expect(builtHtml).toContain('"@type":"Organization"');
    expect(builtHtml).toContain('"@type":"VideoGame"');
    expect(builtHtml).toContain('"@type":"FAQPage"');

    const schema = buildLandingJsonLd();
    const graph = schema['@graph'] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(4);
    expect(graph.map((g) => g['@type'])).toEqual(['WebSite', 'Organization', 'VideoGame', 'FAQPage']);

    document.body.innerHTML = '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(builtHtml, 'text/html');
    expect(doc.querySelectorAll('#director-scenarios')).toHaveLength(1);
    expect(doc.querySelectorAll('#economics-board')).toHaveLength(1);
    expect(doc.querySelectorAll('#protocol-board')).toHaveLength(1);
    expect(doc.querySelectorAll('#contracts-board')).toHaveLength(1);
    expect(doc.querySelector('#director-scenarios')?.children.length).toBeGreaterThan(0);
    expect(doc.querySelector('#economics-board')?.children.length).toBeGreaterThan(0);
    expect(doc.querySelector('#protocol-board')?.children.length).toBeGreaterThan(0);
    expect(doc.querySelector('#contracts-board')?.children.length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('#contracts-board .acct-pill')).toHaveLength(4);
    expect(builtHtml).toContain('$100 Trade');
    expect(builtHtml).toContain('$101.50');

    const text = doc.body.textContent ?? '';
    for (const banned of [
      '403 AI_STAKING_FORBIDDEN',
      'ACID Capped',
      'sha256(model:req:res)',
      'token_diff',
      'HTTP 403',
      'ED25519+SECP256K1-EIP191',
      'NEAR-SDK 5.7',
      '11 / 11 PORTS',
      '0 Burst Re-Trigger Tokens',
      'WebCrypto ECDSA',
      'standalone intent verifier crate',
      'Bitte AI, HOT, HERE, Nightly, or Sender',
    ]) {
      expect(text).not.toContain(banned);
    }

    // Idempotent if called twice.
    expect(prerenderLandingHtml(builtHtml)).toBe(builtHtml);
  });
});
