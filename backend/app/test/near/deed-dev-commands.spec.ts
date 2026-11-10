import { describe, expect, it } from 'vitest';
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

function createServerCmdHarness(waves = 'W05,W08,W12,W20') {
  const registry = new DevCommandRegistry({ NODE_ENV: 'test' } as never);
  const flags = new FlagsService({ TA_WAVES: waves } as never);
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

describe('W20-27 Server Dev-console commands (unit)', () => {
  it('registers and executes all 6 commands on the server DevCommandRegistry', async () => {
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

    const warpRes = (await registry.run('time.warp', { seconds: 600 })) as Record<string, unknown>;
    expect(warpRes).toMatchObject({
      seconds: 600,
      flushedDeeds: 1,
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

  it('rejects all W20 dev commands with 404 when W20 flag is disabled', async () => {
    const { registry } = createServerCmdHarness('W05,W08,W12');
    await expect(registry.run('deed.show', {})).rejects.toMatchObject({ status: 404 });
    await expect(registry.run('deed.bump', { field: 'terraform', value: 10 })).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(registry.run('deed.settle', {})).rejects.toMatchObject({ status: 404 });
    await expect(registry.run('stake.fund', { near: 100 })).rejects.toMatchObject({ status: 404 });
    await expect(registry.run('account.claim', { mock: true })).rejects.toMatchObject({
      status: 404,
    });
  });
});
