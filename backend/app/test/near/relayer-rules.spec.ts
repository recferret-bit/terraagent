import { describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import { NearException } from '../../src/near/domain/errors';
import {
  assertRelayAllowed,
  receiverAllowed,
  relayTxHash,
} from '../../src/near/infrastructure/adapters/relayer/relay-rules';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';

const action = {
  opId: 'relay:1',
  signerId: 'alice.near',
  receiverId: 'res.terraagent.mock',
  signedDelegate: 'delegate-bytes',
};

describe('receiver allow-list', () => {
  it('rejects evil.near', () => {
    expect(receiverAllowed('evil.near')).toBe(false);
  });

  it('allows res, deed, bounty, planet DAOs and intents.near', () => {
    const allowed = [
      'res.terraagent.mock',
      'deed.terraagent.mock',
      'bounty.terraagent.mock',
      'p1.sputnik-dao.near',
      'p1.sputnik-dao.mock',
      'intents.near',
    ];
    for (const id of allowed) expect(receiverAllowed(id), id).toBe(true);
  });
});

describe('relayTxHash', () => {
  it('is stable for the same action and matches mock:', () => {
    const hash = relayTxHash(action);
    expect(relayTxHash(action)).toBe(hash);
    expect(hash).toMatch(MOCK_HASH_RE);
    expect(relayTxHash({ ...action, signedDelegate: 'other-delegate' })).not.toBe(hash);
  });

  it('hashes the action, not the opId', () => {
    expect(relayTxHash({ ...action, opId: 'relay:1' })).toBe(relayTxHash({ ...action, opId: 'relay:2' }));
  });
});

describe('assertRelayAllowed', () => {
  it('throws NEAR_RELAY_RECEIVER_NOT_ALLOWED for evil.near without a database', () => {
    let thrown: unknown;
    try {
      assertRelayAllowed({ ...action, receiverId: 'evil.near' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NearException);
    expect(thrown).toMatchObject({ errorCode: 'NEAR_RELAY_RECEIVER_NOT_ALLOWED' });
  });

  it('rejects a bad shape with VALIDATION_ERROR before the allow-list', () => {
    let thrown: unknown;
    try {
      assertRelayAllowed({ ...action, receiverId: 'evil.near', signedDelegate: '' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CoreException);
    expect(thrown).not.toBeInstanceOf(NearException);
    expect(thrown).toMatchObject({ errorCode: 'VALIDATION_ERROR', status: 400 });
  });
});
