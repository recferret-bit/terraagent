import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { EnvError, parseEnv } from '@terra/config';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { aiProvider } from '../../src/ai/ai-selection.js';
import { notifyAdapter } from '../../src/notify/notify-selection.js';
import { nearAdapterFor, nearAdapterKey } from '../../src/near/infrastructure/adapter-selection.js';
import { nearEnvFor, nearInfrastructureModuleFor } from '../../src/near/infrastructure/near-infrastructure.module.js';
import { discoverAdapters } from '../../src/ports/adapters.js';
import { ChainReadPort } from '../../src/near/application/ports/chain-read.port.js';
import { APP_ENV } from '../../src/core/tokens.js';
import { PORTS } from '../../src/near/application/ports/index.js';

const fixtures = join(import.meta.dirname, 'fixtures/adapters');
const base = { TA_PORT_BASE: '7380', LOG_LEVEL: 'silent' };
const envModule = (env: Record<string, string>) => {
  @Global() @Module({ providers: [{ provide: APP_ENV, useValue: env }], exports: [APP_ENV] }) class EnvModule {}
  return EnvModule;
};
const prod = { ...base, NODE_ENV: 'production' };

describe('selection truth table', () => {
  it('derives env keys', () => {
    expect(nearAdapterKey('ChainRead')).toBe('NEAR_ADAPTER_CHAIN_READ');
    expect(nearAdapterKey('BadgeNft')).toBe('NEAR_ADAPTER_BADGE_NFT');
    expect(nearAdapterKey('TreasuryDao')).toBe('NEAR_ADAPTER_TREASURY_DAO');
  });
  it.each([['testnet', 'testnet'], ['mainnet', 'mainnet'], [undefined, 'mock'], ['', 'mock'], ['mock', 'mock'], ['Mainnet', 'mock'], ['TESTNET', 'mock'], [' testnet', 'mock'], ['mainet', 'mock'], ['true', 'mock']])('NEAR %s -> %s', (v, want) => {
    expect(nearAdapterFor('ChainRead', { NEAR_ADAPTER_CHAIN_READ: v })).toBe(want);
  });
  it('is per port', () => {
    expect(nearAdapterFor('BadgeNft', { NEAR_ADAPTER_CHAIN_READ: 'mainnet' })).toBe('mock');
  });
  it.each([['zai', {}, 'mock'], ['zai', { AI_LIVE: '1' }, 'zai'], ['zai', { NODE_ENV: 'production' }, 'zai'], ['Zai', { AI_LIVE: '1' }, 'mock'], [undefined, { AI_LIVE: '1' }, 'mock'], ['mock', { NODE_ENV: 'production' }, 'mock']])('AI_PROVIDER %s %j -> %s', (v, extra, want) => {
    expect(aiProvider({ AI_PROVIDER: v, ...extra })).toBe(want);
  });
  it.each([['live', 'live'], ['webpush', 'live'], ['telegram', 'live'], ['Live', 'mock'], [undefined, 'mock'], ['email', 'mock']])('NOTIFY_ADAPTER %s -> %s', (v, want) => {
    expect(notifyAdapter({ NOTIFY_ADAPTER: v })).toBe(want);
  });
});

describe('production guard', () => {
  it('aborts boot naming every mocked port', async () => {
    const err = await createApp({ source: prod }).catch((e) => e);
    expect(err).toBeInstanceOf(EnvError);
    for (const p of PORTS) expect(err.message).toContain(p.name);
    expect(err.message).toMatch(/NEAR_ALLOW_MOCK_IN_PROD \(near\)/);
  });
  it('names only the still-mocked ports', () => {
    expect(() => parseEnv([nearEnvFor([])], { ...prod, NEAR_ADAPTER_CHAIN_READ: 'mainnet' })).toThrow(/ChainRead: "mainnet" adapter selected but none is registered/);
  });
  it('allow flags let it boot; only exact true counts', async () => {
    const allow = { ...prod, NEAR_ALLOW_MOCK_IN_PROD: 'true', AI_ALLOW_MOCK_IN_PROD: 'true', NOTIFY_ALLOW_MOCK_IN_PROD: 'true' };
    const { app } = await createApp({ source: allow });
    await app.close();
    await expect(createApp({ source: { ...allow, NEAR_ALLOW_MOCK_IN_PROD: '1' } })).rejects.toThrow(/Identity/);
    await expect(createApp({ source: { ...allow, AI_ALLOW_MOCK_IN_PROD: 'TRUE' } })).rejects.toThrow(/LlmProvider/);
  });
  it('does not block mocks outside production', async () => {
    const { app } = await createApp({ source: base });
    await app.close();
  });
  it('testnet without a registered adapter fails boot naming the port', async () => {
    const err = await createApp({ source: { ...base, NEAR_ADAPTER_CHAIN_READ: 'testnet' } }).catch((e) => e);
    expect(err).toBeInstanceOf(EnvError);
    expect(err.message).toContain('ChainRead: "testnet" adapter selected but none is registered');
  });
});

describe('adapter registry and binding', () => {
  it('binds the selected adapter for a port', async () => {
    const adapters = await discoverAdapters(fixtures);
    expect(adapters).toHaveLength(2);
    const Infra = nearInfrastructureModuleFor(adapters);
    const build = (env: Record<string, string>) => Test.createTestingModule({ imports: [envModule(env), Infra] }).compile();
    const mock = await (await build({})).resolve(ChainReadPort);
    expect(mock?.constructor.name).toBe('FixtureChainRead');
    const tn = await (await build({ NEAR_ADAPTER_CHAIN_READ: 'testnet' })).resolve(ChainReadPort);
    expect(tn.constructor.name).toBe('TestnetChainRead');
    await expect(build({ NEAR_ADAPTER_CHAIN_READ: 'mainnet' }).then((m) => m.resolve(ChainReadPort))).rejects.toThrow(/ChainRead: "mainnet" adapter selected/);
  });
  it('leaves ports without adapters unbound', async () => {
    const m = await Test.createTestingModule({ imports: [envModule({}), nearInfrastructureModuleFor([])] }).compile();
    expect(() => m.get(ChainReadPort, { strict: false })).toThrow();
  });
  it('accepts a fixture mock in the env section so selecting testnet passes', () => {
    return discoverAdapters(fixtures).then((a) => expect(() => parseEnv([nearEnvFor(a)], { ...base, NEAR_ADAPTER_CHAIN_READ: 'testnet' })).not.toThrow());
  });
});

describe('no adapter imports outside the binding modules', () => {
  it('only near/infrastructure, ai and notify import from adapters/', () => {
    const src = join(import.meta.dirname, '../../src');
    const bad: string[] = [];
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = join(d, e.name);
      if (e.isDirectory()) return walk(f);
      if (!/\.ts$/.test(e.name)) return;
      const rel = f.slice(src.length + 1);
      if (/^(near\/infrastructure|ai|notify)\//.test(rel)) return;
      if (/from\s+['"][^'"]*\/adapters\/[^'"]*['"]|import\(\s*['"][^'"]*\/adapters\//.test(readFileSync(f, 'utf8'))) bad.push(rel);
    });
    walk(src);
    expect(bad).toEqual([]);
  });
});
