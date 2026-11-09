import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../../../frontend/game/core/registry/types.js';
import { defineFeature } from '../../../../frontend/game/core/registry/types.js';
import { CommandRunner } from '../../../../frontend/game/dev/console/runner.js';
import { DEED_DEV_COMMANDS } from '../../../../frontend/game/features/deed/devCommands.js';
import { DevCommandRegistry } from '../../src/dev/dev-command.registry.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedDevCommand } from '../../src/near/deed/deed-dev.command.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import { MockIdentityAdapter } from '../../src/near/infrastructure/adapters/identity/mock-identity.adapter.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { StakingService } from '../../src/near/staking/staking.service.js';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking.js';

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
    services: services as FeatureContext['services'],
  }).run(line);
  return res?.kind === 'text' ? res.text : '';
}

function createServerCmdHarness() {
  const registry = new DevCommandRegistry({ NODE_ENV: 'test' } as never);
  const flags = new FlagsService({ TA_WAVES: 'W05,W08,W12,W20' });
  const deeds = new DeedRepository();
  const mintService = new DeedMintOutboxService(flags, deeds);
  const projector = new DeedProjectorService(flags, deeds);
  const debounce = new DeedDebounceService(flags, deeds, projector, mintService);
  const settledService = new DeedSettledService(flags, deeds, projector, debounce, mintService);
  const identityPort = new MockIdentityAdapter({ NODE_ENV: 'test' } as never);
  const claimService = new AccountClaimService(flags, identityPort, { NODE_ENV: 'test' } as never);
  const stakingPort = new InMemoryStaking();
  const positionSync = new StakingPositionSyncService(stakingPort, undefined, undefined, flags);
  const stakingService = new StakingService(
    flags,
    stakingPort,
    deeds,
    claimService,
    positionSync,
  );
  const devCmd = new DeedDevCommand(
    registry,
    flags,
    deeds,
    mintService,
    projector,
    debounce,
    settledService,
    claimService,
    stakingService,
  );
  debounce.onModuleInit();
  devCmd.onModuleInit();

  return { registry };
}

describe('W20-27 Dev-console commands (unit)', () => {
  it('registers and executes all 5 commands on the server DevCommandRegistry', async () => {
    const { registry } = createServerCmdHarness();

    const showRes = (await registry.run('deed.show', {})) as Record<string, unknown>;
    expect(showRes).toMatchObject({
      colonyId: 'col_0',
      tokenId: 'deed:col_0',
      version: 1,
      status: 'active',
      settled: false,
      stage: 4,
      terraformBp: 4000,
    });

    const bumpRes = (await registry.run('deed.bump', {
      field: 'terraform',
      value: 10,
    })) as Record<string, unknown>;
    expect(bumpRes).toMatchObject({
      colonyId: 'col_0',
      tokenId: 'deed:col_0',
      change: 'Terraform 50 %',
      pendingState: 'pending',
    });

    const settleRes = (await registry.run('deed.settle', {})) as Record<string, unknown>;
    expect(settleRes).toMatchObject({
      colonyId: 'col_0',
      tokenId: 'deed:col_0',
      settled: true,
    });

    const fundRes = (await registry.run('stake.fund', { near: 100 })) as Record<string, unknown>;
    expect(fundRes).toMatchObject({
      walletBalanceNear: '100',
    });

    const claimRes = (await registry.run('account.claim', { mock: true })) as Record<
      string,
      unknown
    >;
    expect(claimRes).toMatchObject({
      colonyId: 'col_0',
      claimedByAccountId: 'pilot.mock',
    });
  });

  it('runs all 5 commands in the client CommandRunner and prints one-line results', async () => {
    const { registry } = createServerCmdHarness();
    const devServer = vi.fn(async (name: string, args: unknown) => registry.run(name, args));
    const session = { planetId: () => 'planet_w20' };

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
