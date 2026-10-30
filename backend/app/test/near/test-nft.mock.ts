import { BaseNep171MockAdapter } from '../../src/near/infrastructure/mock/nep171.base';

/** Test-only subclass: proves the base is reusable for any collection (the deed mock does the same). */
export class TestNftMock extends BaseNep171MockAdapter {
  protected readonly collection = 'test';
  protected readonly portName = 'TestNft';
}
