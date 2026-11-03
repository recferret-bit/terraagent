import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { delegateReceiptFields } from '../../src/near/infrastructure/adapters/relayer/mock-relayer.adapter';

const accountId = 'co_abc.test-pilot.terraagent.mock';

describe('delegateReceiptFields', () => {
  it('adds nothing for a non-JSON delegate', () => {
    expect(delegateReceiptFields('delegate-bytes')).toEqual({});
  });

  it('copies action and account_id from a JSON delegate', () => {
    const signed = JSON.stringify({ action: 'storage_deposit', account_id: accountId });
    expect(delegateReceiptFields(signed)).toEqual({ action: 'storage_deposit', account_id: accountId });
  });

  it('ignores JSON that is not an object of those strings', () => {
    expect(delegateReceiptFields('[]')).toEqual({});
    expect(delegateReceiptFields('null')).toEqual({});
    expect(delegateReceiptFields('{')).toEqual({});
    expect(delegateReceiptFields(JSON.stringify({ action: 1, account_id: { id: accountId } }))).toEqual({});
  });
});
