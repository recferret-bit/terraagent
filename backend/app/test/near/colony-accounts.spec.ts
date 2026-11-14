import { MOCK_ACCOUNT_ROOT } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { accountRootFromOwner } from '../../src/near/identity/colony-account-write';

describe('accountRootFromOwner external sub-account namespace guard', () => {
  it('keeps external user sub-accounts (sub.alice.testnet / sub.alice.near) on fallbackRoot instead of unowned parent', () => {
    expect(accountRootFromOwner('sub.alice.testnet', 'co_01hxyz', {})).toBe('terraagent.testnet');
    expect(accountRootFromOwner('deep.sub.alice.testnet', 'co_01hxyz', { NEAR_ROOT_ACCOUNT: 'terraagent.testnet' })).toBe(
      'terraagent.testnet',
    );
    expect(accountRootFromOwner('sub.alice.near', 'co_01hxyz', { NEAR_ROOT_ACCOUNT: 'terraagent.near' })).toBe(
      'terraagent.near',
    );
    expect(accountRootFromOwner('guild.bob.near', 'co_01hxyz', {})).toBe('terraagent.near');

    // Reject suffix-spoofing lookalike roots (`evil-terraagent.testnet` does NOT end with `.terraagent.testnet`):
    expect(accountRootFromOwner('pilot.evil-terraagent.testnet', 'co_01hxyz', {})).toBe('terraagent.testnet');
    expect(accountRootFromOwner('pilot.notterraagent.near', 'co_01hxyz', {})).toBe('terraagent.near');

    // Mainnet .tg / .sweat / aurora accounts resolve to terraagent.near (never unowned parent or MOCK_ACCOUNT_ROOT):
    expect(accountRootFromOwner('alice.tg', 'co_01hxyz', {})).toBe('terraagent.near');
    expect(accountRootFromOwner('sub.alice.tg', 'co_01hxyz', {})).toBe('terraagent.near');
    expect(accountRootFromOwner('alice.sweat', 'co_01hxyz', {})).toBe('terraagent.near');
    expect(accountRootFromOwner('aurora', 'co_01hxyz', {})).toBe('terraagent.near');
  });

  it('preserves controlled fallbackRoot and *.fallbackRoot sub-namespaces when within colonyNameBudget', () => {
    expect(accountRootFromOwner('pilot.terraagent.testnet', 'co_01hxyz', {})).toBe('terraagent.testnet');
    expect(accountRootFromOwner('pilot.pilots.terraagent.testnet', 'co_01hxyz', {})).toBe('pilots.terraagent.testnet');
    expect(accountRootFromOwner('  Pilot.Pilots.TerraAgent.Near  ', 'co_01hxyz', {})).toBe('pilots.terraagent.near');

    // Custom configured NEAR_ROOT_ACCOUNT:
    const customEnv = { NEAR_ROOT_ACCOUNT: 'custom-root.testnet' };
    expect(accountRootFromOwner('pilot.custom-root.testnet', 'co_01hxyz', customEnv)).toBe('custom-root.testnet');
    expect(accountRootFromOwner('pilot.pilots.custom-root.testnet', 'co_01hxyz', customEnv)).toBe(
      'pilots.custom-root.testnet',
    );
    expect(accountRootFromOwner('sub.alice.testnet', 'co_01hxyz', customEnv)).toBe('custom-root.testnet');

    // Falls back to fallbackRoot when controlled sub-namespace is too deep for 64-char NEAR account ID budget:
    const longColonyId = 'co_01arz3ndektsv4rrffq69g5fav';
    const deepControlledOwner = 'commander-long-stem.tier1.pilots.terraagent.testnet';
    expect(accountRootFromOwner(deepControlledOwner, longColonyId, {})).toBe('terraagent.testnet');

    // Implicit 64-hex & Mock accounts:
    const implicitHex = 'a'.repeat(64);
    expect(accountRootFromOwner(implicitHex, 'co_01hxyz', { NEAR_MODE: 'testnet' })).toBe('terraagent.testnet');
    expect(accountRootFromOwner(implicitHex, 'co_01hxyz', { NEAR_MODE: 'mainnet' })).toBe('terraagent.near');
    expect(accountRootFromOwner(implicitHex, 'co_01hxyz', { NEAR_MODE: 'mock' })).toBe(MOCK_ACCOUNT_ROOT);
    expect(accountRootFromOwner('pilot.terraagent.mock', 'co_01hxyz', {})).toBe(MOCK_ACCOUNT_ROOT);
  });
});
