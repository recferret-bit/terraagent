import { describe, expect, it } from 'vitest';
import {
  ClaimAccountRequestSchema,
  DeedMetadataV1,
  DeedStatus,
  DeedUpdated,
  EVENT_KINDS,
  REST_ERROR_CODES,
  ServerMessage,
  StakeRequestSchema,
  StakingPoolInfo,
  StakingPositionDto,
  UnstakeRequestSchema,
  WithdrawRequestSchema,
  accountClaimOpId,
  deedFinalOpId,
  deedMetaOpId,
  deedMintOpId,
  deedSettleOpId,
  deedTokenId,
  eventDef,
  parseWaves,
  type EventKind,
} from '../src';

describe('W20-01 contracts: DeedMetadataV1 & opId helpers', () => {
  it('validates DeedMetadataV1 with full and optional wave-scoped fields, and rejects unknown fields', () => {
    const valid = DeedMetadataV1.parse({
      planet: 'pl_dune_01',
      colony: 'col-0',
      colonyName: 'Ares Prime',
      planetType: 'dune',
      stage: 4,
      terraformBp: 4000,
      tradeVolume: 1200,
      truces: 1,
      rank: 2,
      status: 'active',
      settled: false,
      version: 1,
      imageUrl: '/v1/near/deed/deed:col-0/image.png',
    });
    expect(valid.planet).toBe('pl_dune_01');
    expect(valid.walls).toBeUndefined();

    const minimal = DeedMetadataV1.parse({
      planet: 'pl_dune_01',
      colony: 'col-0',
      status: 'settled',
      settled: true,
      version: 2,
      imageUrl: '/v1/near/deed/deed:col-0/image.png',
    });
    expect(minimal.settled).toBe(true);
    expect(minimal.stage).toBeUndefined();
    expect(minimal.terraformBp).toBeUndefined();

    const base = {
      planet: 'pl_dune_01',
      colony: 'col-0',
      status: 'active' as const,
      settled: false,
      version: 1,
      imageUrl: '/v1/near/deed/deed:col-0/image.png',
    };
    expect(DeedMetadataV1.safeParse({ ...base, unknownExtraField: 'not-allowed' }).success).toBe(false);
    expect(DeedMetadataV1.safeParse({ ...base, terraformBp: 10_001 }).success).toBe(false);
    expect(DeedMetadataV1.safeParse({ ...base, version: 0 }).success).toBe(false);
  });

  it('validates DeedStatus values and deterministic opId helpers', () => {
    for (const s of ['active', 'settled', 'eliminated', 'abandoned'] as const) {
      expect(DeedStatus.parse(s)).toBe(s);
    }
    expect(DeedStatus.safeParse('invalid').success).toBe(false);
    expect(deedTokenId('col-0')).toBe('deed:col-0');
    expect(deedTokenId('deed:col-0')).toBe('deed:col-0');
    expect(deedMintOpId('col-0')).toBe('deed-mint:col-0');
    expect(deedMetaOpId('col-0', 3)).toBe('deed-meta:col-0:3');
    expect(deedFinalOpId('col-0', 4)).toBe('deed-final:col-0:4');
    expect(deedSettleOpId('col-0')).toBe('deed-settle:col-0');
    expect(accountClaimOpId('col-0')).toBe('account-claim:col-0');
  });
});

describe('W20-01 contracts: Staking DTOs, events, WS push, error codes, and flag W20', () => {
  it('validates Staking & Claim DTOs and rejects malformed inputs', () => {
    const pool = StakingPoolInfo.parse({ poolId: 'astro-stakers.pool.mock', name: 'Astro Stakers', apyBp: 900 });
    expect(pool.apyBp).toBe(900);

    const stake = StakeRequestSchema.parse({ colonyId: 'col-0', pool: 'astro-stakers.pool.mock', amount: '10' });
    expect(stake.amount).toBe('10');
    expect(StakeRequestSchema.safeParse({ pool: 'astro-stakers.pool.mock', amount: '-5' }).success).toBe(false);
    expect(StakeRequestSchema.safeParse({ pool: 'astro-stakers.pool.mock', amount: '10', stray: true }).success).toBe(false);

    expect(UnstakeRequestSchema.safeParse({ pool: 'astro-stakers.pool.mock', amount: '5' }).success).toBe(true);
    expect(WithdrawRequestSchema.safeParse({ pool: 'astro-stakers.pool.mock' }).success).toBe(true);
    expect(ClaimAccountRequestSchema.safeParse({ colonyId: 'col-0' }).success).toBe(true);

    const pos = StakingPositionDto.parse({
      colonyId: 'col-0',
      accountId: 'col-0.pilot.terraagent.mock',
      pool: 'astro-stakers.pool.mock',
      staked: '10',
      unbonding: '0',
      unbondingReadyAtMs: null,
      withdrawable: '0',
      rewards: '0.024657',
    });
    expect(pos.staked).toBe('10');
  });

  it('registers deedMinted, deedUpdated, deedSettled on wave W20 and deed.updated on ServerMessage', () => {
    const kinds: EventKind[] = ['deedMinted', 'deedUpdated', 'deedSettled'];
    for (const k of kinds) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W20');
    }

    const msg = ServerMessage.parse({
      v: 1,
      t: 'deed.updated',
      d: {
        colonyId: 'col-0',
        planetId: 'pl_dune_01',
        tokenId: 'deed:col-0',
        version: 2,
        change: 'Terraform 40 %',
        status: 'active',
        settled: false,
        metadata: {
          planet: 'pl_dune_01',
          colony: 'col-0',
          terraformBp: 4000,
          status: 'active',
          settled: false,
          version: 2,
          imageUrl: '/v1/near/deed/deed:col-0/image.png',
        },
      },
    });
    expect(msg.t).toBe('deed.updated');
    expect(DeedUpdated.safeParse(msg).success).toBe(true);
  });

  it('registers W20 error codes and wave flag W20', () => {
    for (const code of [
      'deed_not_found',
      'deed_not_settled',
      'account_not_claimed',
      'pool_not_whitelisted',
      'stake_insufficient_balance',
      'DEED_NOT_FOUND',
      'DEED_NOT_SETTLED',
      'ACCOUNT_NOT_CLAIMED',
      'POOL_NOT_WHITELISTED',
      'STAKE_INSUFFICIENT_BALANCE',
    ] as const) {
      expect(REST_ERROR_CODES).toContain(code);
    }

    expect(parseWaves('all').has('W20')).toBe(true);
    expect(parseWaves('..20').has('W20')).toBe(true);
    expect(parseWaves('..19').has('W20')).toBe(false);
  });
});
