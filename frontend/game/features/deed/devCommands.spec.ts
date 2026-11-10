import { describe, expect, it, vi } from 'vitest';
import { defineFeature, type FeatureContext } from '../../core/registry/types';
import { CommandRunner } from '../../dev/console/runner';
import { DEED_DEV_COMMANDS } from './devCommands';

const deedDevFeature = defineFeature({
  id: 'deed-dev-test',
  wave: 'W20',
  devCommands: [...DEED_DEV_COMMANDS],
});

async function runClientCmd(
  line: string,
  services: Partial<FeatureContext['services']> = {},
  host: FeatureContext['host'] = 'server',
): Promise<string> {
  const res = await new CommandRunner([deedDevFeature], {
    flags: new Set(['W20']),
    host,
    services: { track: () => {}, ...services } as FeatureContext['services'],
  }).run(line);
  return res?.kind === 'text' ? res.text : '';
}

describe('W20-27 Client Dev-console commands (unit)', () => {
  it('runs all 5 commands in the client CommandRunner and prints one-line results', async () => {
    const devServer = vi.fn(async (name: string) => {
      if (name === 'deed.show') {
        return {
          tokenId: 'deed:col_0',
          colonyId: 'col_0',
          version: 1,
          status: 'active',
          settled: false,
          stage: 4,
          terraformBp: 4000,
          pendingState: 'FINAL',
          accountId: 'planet_w20-col_0.terraagent.mock',
        };
      }
      if (name === 'deed.bump') {
        return {
          tokenId: 'deed:col_0',
          change: 'Terraform 50 %',
          pendingState: 'pending',
        };
      }
      if (name === 'deed.settle') {
        return {
          tokenId: 'deed:col_0',
          version: 2,
          txHash: 'mock:settle1',
        };
      }
      if (name === 'stake.fund') {
        return {
          accountId: 'pilot.mock',
          walletBalanceNear: '100',
          txHash: 'mock:fund1',
        };
      }
      return {
        colonyId: 'col_0',
        accountId: 'planet_w20-col_0.terraagent.mock',
        claimedByAccountId: 'pilot.mock',
        txHash: 'mock:claim1',
      };
    });
    const session = { planetId: () => 'planet_w20' } as FeatureContext['services']['session'];

    const outShow = await runClientCmd('deed.show', { devServer, session });
    expect(outShow).toContain('deed:col_0 (col_0) v1 active · Stage 4 · Terraform 40%');

    const outBump = await runClientCmd('deed.bump terraform 10', { devServer, session });
    expect(outBump).toContain('deed.bump terraform 10: Terraform 50 % (pending)');

    const outSettle = await runClientCmd('deed.settle', { devServer, session });
    expect(outSettle).toContain('settled deed:col_0');

    const outFund = await runClientCmd('stake.fund 100', { devServer, session });
    expect(outFund).toContain('balance 100 NEAR');

    const outClaim = await runClientCmd('account.claim --mock', { devServer, session });
    expect(outClaim).toContain('-> pilot.mock');
  });

  it('rejects invalid arguments and local host with clear usage/host errors', async () => {
    const devServer = vi.fn(async () => ({}));
    expect(await runClientCmd('deed.bump unknown 10', { devServer })).toContain('usage:');
    expect(await runClientCmd('deed.bump terraform', { devServer })).toContain('usage:');
    expect(await runClientCmd('stake.fund -5', { devServer })).toContain('usage:');
    expect(await runClientCmd('account.claim --badflag', { devServer })).toContain('usage:');
    expect(await runClientCmd('deed.show', {}, 'local')).toContain('host_unavailable');
  });
});
