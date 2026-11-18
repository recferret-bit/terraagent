// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveActiveNearNetwork,
  resolveNearNetworkConfig,
} from '../../../backend/app/src/near/infrastructure/network/near-network.config';
import { initContractsBoard } from './contractsBoard';
import { initDirectorScenarios } from './directorScenarios';
import { initEconomicsSection } from './economicsSection';
import { initProtocolSection } from './protocolSection';
import { initRoadmap } from './roadmap';

const originalFetch = globalThis.fetch;

function setupLandingDom(): void {
  document.body.innerHTML = `
    <section id="director">
      <div class="director-console">
        <div id="director-scenarios"></div>
        <div class="terminal" id="director-terminal">
          <div class="terminal-bar">
            <span data-dir-title>INITIAL</span>
            <span data-dir-attest>INITIAL</span>
          </div>
          <div class="terminal-body" data-dir-body>INITIAL</div>
        </div>
      </div>
    </section>
    <section id="protocol">
      <div id="protocol-board"></div>
    </section>
    <section id="chain">
      <div id="contracts-board"></div>
    </section>
  `;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe('Landing #director interactive trace console', () => {
  beforeEach(setupLandingDom);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('switches the #director-terminal trace on click and keyboard ArrowRight/ArrowLeft', () => {
    initDirectorScenarios();

    const cards = [...document.querySelectorAll<HTMLButtonElement>('[data-scenario-card]')];
    expect(cards).toHaveLength(4);
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('true');

    cards[1]!.click();
    expect(cards[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(cards[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-dir-title]')?.textContent).toBe('DIRECTOR TRACE · PERIMETER RAID');
    expect(document.querySelector('[data-dir-attest]')?.textContent).toBe('WAR OPT-IN VERIFIED · TEE');
    expect(document.querySelector('[data-dir-body]')?.textContent).toContain('raid(target: col_4)');

    cards[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(cards[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-dir-title]')?.textContent).toBe('DIRECTOR TRACE · SURPLUS ARBITRAGE');

    cards[3]!.click();
    expect(cards[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-dir-title]')?.textContent).toBe('DIRECTOR TRACE · BILATERAL TRUCE');
    expect(document.querySelector('[data-dir-body]')?.textContent).toContain('cancel_truce=forbidden');
  });
});

describe('Landing #chain live status board & #protocol receipts', () => {
  beforeEach(setupLandingDom);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('hydrates live /v1/near/status telemetry, formats AI badge cleanly, and updates Mainnet contract + protocol account URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nearMode: 'mainnet',
        network: 'mainnet',
        rootAccount: 'terraagent.near',
        protocolAccount: 'protocol.terraagent.near',
        explorerBaseUrl: 'https://nearblocks.io',
        contracts: { res: 'res.terraagent.near' },
        accounts: {
          protocol: 'protocol.terraagent.near',
          relayer: 'relayer.terraagent.near',
          minter: 'minter.terraagent.near',
        },
        health: { ok: true, latencyMs: 42, detail: 'block=184502910 failovers=0' },
        ports: Array.from({ length: 11 }, () => ({ mode: 'mainnet' })),
        ai: { provider: 'nearai', defaultModel: 'z-ai/glm-5.3-flash', cryptoVerification: 'ed25519+secp256k1-eip191' },
      }),
    }) as unknown as typeof fetch;

    initContractsBoard();
    await new Promise((r) => setTimeout(r, 15));

    const contractCards = document.querySelectorAll('[data-chain-item]');
    expect(contractCards).toHaveLength(6);

    const statusText = document.querySelector('[data-chain-live-status]')?.textContent ?? '';
    expect(statusText).toContain('LIVE ON MAINNET');
    expect(statusText).toContain('BLOCK #184,502,910');
    expect(statusText).toContain('NEAR.AI TEE VERIFIED');
    expect(statusText).not.toContain('ED25519+SECP256K1-EIP191');

    const jsonLink = document.querySelector<HTMLAnchorElement>('.chain-json-link');
    expect(jsonLink?.getAttribute('href')).toBe('/v1/near/status');

    const resLink = document.querySelector<HTMLAnchorElement>('[data-contract-key="res"] [data-contract-link]');
    const resTxLink = document.querySelector<HTMLAnchorElement>('[data-contract-key="res"] [data-contract-tx]');
    expect(resLink?.href).toBe('https://nearblocks.io/address/res.terraagent.near');
    expect(resLink?.textContent).toContain('res.terraagent.near');
    expect(resTxLink?.href).toBe('https://nearblocks.io/address/res.terraagent.near?tab=contract');
    expect(resTxLink?.href).not.toContain('testnet.nearblocks.io');

    const deedLink = document.querySelector<HTMLAnchorElement>('[data-contract-key="deed"] [data-contract-link]');
    expect(deedLink?.href).toBe('https://nearblocks.io/address/deed.terraagent.near');

    const rootLink = document.querySelector<HTMLAnchorElement>('[data-account-key="root"] [data-account-link]');
    const protoLink = document.querySelector<HTMLAnchorElement>('[data-account-key="protocol"] [data-account-link]');
    const relayerLink = document.querySelector<HTMLAnchorElement>('[data-account-key="relayer"] [data-account-link]');
    const minterLink = document.querySelector<HTMLAnchorElement>('[data-account-key="minter"] [data-account-link]');
    expect(rootLink?.href).toBe('https://nearblocks.io/address/terraagent.near');
    expect(rootLink?.textContent).toContain('terraagent.near');
    expect(protoLink?.href).toBe('https://nearblocks.io/address/protocol.terraagent.near');
    expect(relayerLink?.href).toBe('https://nearblocks.io/address/relayer.terraagent.near');
    expect(minterLink?.href).toBe('https://nearblocks.io/address/minter.terraagent.near');
  });
});

describe('Landing #chain NearStatusController parity & #protocol receipts', () => {
  beforeEach(setupLandingDom);
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('omits NEAR.AI TEE VERIFIED badge when /v1/near/status reports mock AI provider', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nearMode: 'testnet',
        network: 'testnet',
        rootAccount: 'terraagent.testnet',
        explorerBaseUrl: 'https://testnet.nearblocks.io',
        ports: Array.from({ length: 11 }, () => ({ mode: 'testnet' })),
        ai: { provider: 'mock', defaultModel: 'z-ai/glm-5.3-flash', attestationEnabled: true, cryptoVerification: 'ed25519+secp256k1-eip191' },
      }),
    }) as unknown as typeof fetch;

    initContractsBoard();
    await new Promise((r) => setTimeout(r, 15));

    const statusText = document.querySelector('[data-chain-live-status]')?.textContent ?? '';
    expect(statusText).toContain('LIVE ON TESTNET');
    expect(statusText).not.toContain('NEAR.AI TEE VERIFIED');

    // Verify end-to-end config parity with resolveActiveNearNetwork + resolveNearNetworkConfig (per-port Mainnet overrides)
    const envOverrides = {
      NEAR_ALLOW_MAINNET: '1',
      NEAR_ADAPTER_CHAIN_READ: 'mainnet',
      NEAR_ADAPTER_STAKING: 'mainnet',
    };
    const net = resolveActiveNearNetwork(null, envOverrides);
    const cfg = resolveNearNetworkConfig(envOverrides, net);
    expect(net).toBe('mainnet');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        nearMode: 'mock',
        network: net,
        rootAccount: cfg.rootAccount,
        protocolAccount: cfg.accounts.protocol,
        contracts: cfg.contracts,
        accounts: cfg.accounts,
        explorerBaseUrl: cfg.explorerBaseUrl,
        health: { ok: true, latencyMs: 18, detail: 'block=185000123' },
        ports: [{ mode: 'mainnet' }, { mode: 'mainnet' }, ...Array.from({ length: 9 }, () => ({ mode: 'mock' }))],
        ai: { provider: 'nearai', defaultModel: 'z-ai/glm-5.3-flash', attestationEnabled: true },
      }),
    }) as unknown as typeof fetch;
    initContractsBoard();
    await new Promise((r) => setTimeout(r, 15));
    expect(document.querySelector('[data-chain-live-status]')?.textContent).toContain('2/11 ADAPTERS LIVE (MAINNET)');
    expect(document.querySelector<HTMLAnchorElement>('[data-account-key="root"] [data-account-link]')?.href).toBe(
      'https://nearblocks.io/address/terraagent.near',
    );
  });

  it('keeps #protocol worked receipts collapsed by default and opens them when filtering a stream', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    initContractsBoard();
    initProtocolSection();
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelectorAll('[data-chain-item]')).toHaveLength(6);
    expect(document.querySelector('[data-chain-live-status]')?.textContent).toContain('LIVE ON NEAR TESTNET · FASTNEAR RPC');

    const proofs = document.querySelector<HTMLDetailsElement>('[data-proto-proofs]');
    expect(proofs?.open).toBe(false);

    document.querySelector<HTMLButtonElement>('[data-proto-filter="staking"]')!.click();
    expect(proofs?.open).toBe(true);
  });
});

describe('Landing HTML 01..10 structure & anti-slop copy audit', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  it('mounts cleanly against landing.html with exact 01..10 nav-to-section parity and zero orphaned #market or slop strings', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const htmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../landing.html');
    const rawHtml = fs.readFileSync(htmlPath, 'utf8');
    const bodyMatch = /<body>([\s\S]*?)<\/body>/i.exec(rawHtml);
    expect(bodyMatch?.[1]).toBeTruthy();
    document.body.innerHTML = bodyMatch![1]!.replace(/<script[\s\S]*?<\/script>/gi, '');

    expect(document.getElementById('market')).toBeNull();
    expect(document.getElementById('board')).toBeNull();
    expect(document.querySelectorAll('[data-flap]')).toHaveLength(0);

    const navHrefs = [...document.querySelectorAll<HTMLAnchorElement>('.site-header .nav a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(navHrefs).toEqual([
      '#drop', '#colony', '#economy', '#planets', '#director',
      '#economics', '#protocol', '#chain', '#roadmap', '#faq',
    ]);
    const numberedSections = [...document.querySelectorAll<HTMLElement>('main > section[id]')]
      .map((s) => `#${s.id}`)
      .filter((id) => id !== '#top');
    expect(numberedSections).toEqual(navHrefs);

    initDirectorScenarios();
    initEconomicsSection();
    initProtocolSection();
    initContractsBoard();
    initRoadmap();
    await new Promise((r) => setTimeout(r, 10));

    const renderedText = document.body.textContent ?? '';
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
    ]) {
      expect(renderedText).not.toContain(banned);
    }
  });
});
