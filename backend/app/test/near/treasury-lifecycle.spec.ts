import { describe, expect, it } from 'vitest';
import { daoCreateOpId } from '../../src/near/treasury/lifecycle';
import { daoAccountIdFor } from '../../src/near/treasury/policy';

describe('planet dao opId and slug', () => {
  it('builds dao-create:{planetId} and keeps lowercase dots in the account', () => {
    expect(daoCreateOpId('pl_dune')).toBe('dao-create:pl_dune');
    expect(daoCreateOpId('dune.alpha')).toBe('dao-create:dune.alpha');
    expect(daoCreateOpId('pl_01JKHAR0NDVNEST00000000000')).toBe('dao-create:pl_01JKHAR0NDVNEST00000000000');
    expect(daoAccountIdFor('dune.alpha')).toBe('dune.alpha.dao.mock');
    expect(daoAccountIdFor('Dune.Alpha')).toBe('dune.alpha.dao.mock');
  });
});
