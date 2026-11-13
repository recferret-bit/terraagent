import { parseEnv } from '@terra/config';
import { describe, expect, it } from 'vitest';
import { NEAR_ERROR_CODES } from '../../src/near/domain/errors';
import { nearAdapterFor, nearAdapterKey } from '../../src/near/infrastructure/adapter-selection';
import { composeSubAccountId, parseTokenAmount } from '../../src/near/infrastructure/adapters/mock/agent-wallet-input';
import {
  availableOf,
  decimalToBigInt,
  nextAllowance,
  type AllowanceTotals,
} from '../../src/near/infrastructure/adapters/mock/agent-wallet-ledger';
import { nearAdapters, nearEnvFor } from '../../src/near/infrastructure/near-infrastructure.module';
import { AgentWalletPort } from '../../src/near/application/ports/agent-wallet.port';
import { MockAgentWalletAdapter } from '../../src/near/infrastructure/adapters/mock/agent-wallet.adapter';
import { TestnetAgentWalletAdapter } from '../../src/near/infrastructure/adapters/real/testnet-agent-wallet.adapter';
import { UNIT_APP_ENV } from '../unit-app-env';

const SIX_HUNDRED: AllowanceTotals = { allowance: 600n, reserved: 0n, spent: 0n };

describe('W15-03 allowance arithmetic', () => {
  it('reserve 300, consume 200, release 100 leaves spent 200 and available 400', () => {
    const held = nextAllowance(SIX_HUNDRED, 'reserve', 300n);
    expect(held).toEqual({ allowance: 600n, reserved: 300n, spent: 0n });
    expect(availableOf(held)).toBe(300n);
    expect(SIX_HUNDRED.reserved).toBe(0n);

    const settled = nextAllowance(held, 'consume', 200n);
    // 600 - 100 reserved - 200 spent. Available is not 400 until the leftover hold is released.
    expect(settled).toEqual({ allowance: 600n, reserved: 100n, spent: 200n });
    expect(availableOf(settled)).toBe(300n);

    const closed = nextAllowance(settled, 'release', 100n);
    expect(closed).toEqual({ allowance: 600n, reserved: 0n, spent: 200n });
    expect(availableOf(closed)).toBe(400n);
  });

  it('rejects a reserve past available and a consume or release past reserved', () => {
    expect(() => nextAllowance(SIX_HUNDRED, 'reserve', 601n)).toThrowError(/NEAR_ALLOWANCE_EXHAUSTED|available/);
    const held = nextAllowance(SIX_HUNDRED, 'reserve', 300n);
    expect(() => nextAllowance(held, 'consume', 301n)).toThrowError(/reserved/);
    expect(() => nextAllowance(held, 'release', 301n)).toThrowError(/reserved/);
    expect(held).toEqual({ allowance: 600n, reserved: 300n, spent: 0n });
  });

  it('treats zero and the exact remainder as boundaries', () => {
    expect(nextAllowance(SIX_HUNDRED, 'reserve', 0n)).toEqual(SIX_HUNDRED);
    const full = nextAllowance(SIX_HUNDRED, 'reserve', 600n);
    expect(availableOf(full)).toBe(0n);
    expect(() => nextAllowance(full, 'reserve', 1n)).toThrowError(/available/);
    const spent = nextAllowance(full, 'consume', 600n);
    expect(spent).toEqual({ allowance: 600n, reserved: 0n, spent: 600n });
    expect(availableOf(spent)).toBe(0n);
    expect(nextAllowance(spent, 'release', 0n)).toEqual(spent);
    expect(nextAllowance(spent, 'consume', 0n)).toEqual(spent);
  });

  it('parses decimal columns and rejects a bad amount without touching gas', () => {
    expect(decimalToBigInt('600')).toBe(600n);
    expect(decimalToBigInt('600.90')).toBe(600n);
    expect(decimalToBigInt({ toFixed: () => '400' })).toBe(400n);
    expect(parseTokenAmount('0')).toBe(0n);
    expect(() => parseTokenAmount('-1')).toThrowError(/NEAR_INVALID_INPUT|Invalid token amount/);
    expect(() => parseTokenAmount('01')).toThrowError(/Invalid token amount/);
    expect(NEAR_ERROR_CODES.NEAR_ALLOWANCE_EXHAUSTED.status).toBe(409);
    expect(NEAR_ERROR_CODES.NEAR_KEY_REVOKED.status).toBe(409);
    expect(NEAR_ERROR_CODES.NEAR_INVALID_INPUT.status).toBe(400);
  });
});

describe('W15-03 sub-account names and adapter selection', () => {
  it('joins name and parent inside the NEAR account-id rules', () => {
    expect(composeSubAccountId('npc.terraagent.mock', 'guild-1')).toBe('guild-1.npc.terraagent.mock');
    expect(composeSubAccountId('near', 'a'.repeat(59))).toHaveLength(64);
    expect(() => composeSubAccountId('near', 'a'.repeat(60))).toThrowError(/outside NEAR account-id rules/);
    expect(() => composeSubAccountId('npc.terraagent.mock', 'Guild')).toThrowError(/outside NEAR account-id rules/);
    expect(() => composeSubAccountId('BAD', 'guild-1')).toThrowError(/outside NEAR account-id rules/);
  });

  it('selects the mock by default, binds testnet/mainnet when requested, and fails closed without NEAR_ALLOW_MAINNET', () => {
    expect(nearAdapterKey('AgentWallet')).toBe('NEAR_ADAPTER_AGENT_WALLET');
    expect(nearAdapterFor('AgentWallet', {})).toBe('mock');
    expect(nearAdapterFor('AgentWallet', { NEAR_MODE: 'mock' })).toBe('mock');
    expect(nearAdapterFor('AgentWallet', { NEAR_ADAPTER_AGENT_WALLET: 'mock' })).toBe('mock');
    expect(nearAdapterFor('AgentWallet', { NEAR_MODE: 'testnet', NEAR_ADAPTER_AGENT_WALLET: 'mock' })).toBe('mock');
    expect(nearAdapterFor('AgentWallet', { NEAR_MODE: 'testnet' })).toBe('testnet');
    expect(nearAdapterFor('AgentWallet', { NEAR_MODE: 'mainnet' })).toBe('mainnet');
    expect(
      nearAdapters.some(
        (a) => a.port === AgentWalletPort && a.kind === 'mock' && a.useClass === MockAgentWalletAdapter,
      ),
    ).toBe(true);
    expect(
      nearAdapters.some(
        (a) => a.port === AgentWalletPort && a.kind === 'testnet' && a.useClass === TestnetAgentWalletAdapter,
      ),
    ).toBe(true);
    expect(
      nearAdapters.some(
        (a) => a.port === AgentWalletPort && a.kind === 'mainnet' && a.useClass === TestnetAgentWalletAdapter,
      ),
    ).toBe(true);
    expect(() =>
      parseEnv([nearEnvFor(nearAdapters)], { ...UNIT_APP_ENV, NEAR_ADAPTER_AGENT_WALLET: 'testnet' }),
    ).not.toThrow();
    expect(() =>
      parseEnv([nearEnvFor(nearAdapters)], { ...UNIT_APP_ENV, NEAR_ADAPTER_AGENT_WALLET: 'mainnet' }),
    ).toThrow(/NEAR_ALLOW_MAINNET/);
    expect(() =>
      parseEnv([nearEnvFor(nearAdapters)], {
        ...UNIT_APP_ENV,
        NEAR_ADAPTER_AGENT_WALLET: 'mainnet',
        NEAR_ALLOW_MAINNET: '1',
      }),
    ).not.toThrow();
  });
});
