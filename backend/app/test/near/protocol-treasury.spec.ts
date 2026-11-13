import { describe, expect, it } from 'vitest';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { buildStakerPerksFromYocto } from '../../src/near/staking/staker-perks.js';
import { nearToYocto } from '../../src/near/staking/yocto.js';

describe('TerraAgent Protocol treasury view & staker perk helpers', () => {
  it('exposes protocolAccount on GET /v1/near/status and full fee schedule + streams on GET /v1/near/protocol', async () => {
    const ctl = new NearStatusController(undefined, {
      NEAR_MODE: 'mock',
      NEAR_NETWORK: 'testnet',
    } as never);

    const status = await ctl.status();
    expect(status.protocolAccount).toBe('protocol.terraagent.mock');
    expect(status.accounts.protocol).toBe('protocol.terraagent.testnet');

    const protocol = await ctl.protocol();
    expect(protocol.entityName).toBe('TerraAgent Protocol');
    expect(protocol.protocolAccountId).toBe('protocol.terraagent.mock');
    expect(protocol.feeSchedule).toMatchObject({
      standardPlatformFeeBp: 100,
      stakerPlatformFeeBp: 50,
      daoCarveOutShareBp: 2000,
      protocolNetStandardBp: 80,
      protocolNetStakerBp: 40,
      validatorGrossApyBp: 900,
      stakerNetApyBp: 720,
      protocolStakingYieldBp: 180,
      protocolStakingYieldShareBp: 2000,
      minStakeForPerksNear: '10',
      escrowSlashVictimShareBp: 9000,
      escrowSlashProtocolShareBp: 1000,
    });
    expect(protocol.inflows.map((s) => s.id)).toEqual([
      'market_fee',
      'staking_yield',
      'escrow_slash',
    ]);
    expect(protocol.outflows.map((s) => s.id)).toEqual(['relayer_gas', 'managed_near_ai']);
  });

  it('activates staker perks strictly at >= 10 NEAR', () => {
    const below = buildStakerPerksFromYocto(BigInt(nearToYocto(9.9)));
    expect(below.active).toBe(false);
    expect(below.managedAutopilotUnlocked).toBe(false);
    expect(below.platformFeeBp).toBe(100);

    const exact = buildStakerPerksFromYocto(BigInt(nearToYocto(10)));
    expect(exact.active).toBe(true);
    expect(exact.managedAutopilotUnlocked).toBe(true);
    expect(exact.platformFeeBp).toBe(50);
  });
});
