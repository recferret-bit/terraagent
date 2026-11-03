import { describe, expect, it } from 'vitest';
import { NEAR_ERROR_CODES, NearException } from '../../src/near/domain/errors';

describe('W06 error codes', () => {
  it('maps each F5 code to its HTTP status and a player-facing line', () => {
    const expected = {
      NEAR_PROVIDER_REJECTED: { status: 401, description: 'That sign-in could not be confirmed. Try again.' },
      NEAR_NAME_TAKEN: { status: 409, description: 'That Pilot ID is already in use.' },
      NEAR_RELAY_FAILED: { status: 503, description: "Couldn't save to orbit. Retrying." },
      NEAR_RELAY_RECEIVER_NOT_ALLOWED: { status: 403, description: 'That save is not allowed for this colony.' },
    } as const;
    const banned = /wallet|gas|transaction|seed phrase|private key/i;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const err = new NearException(code);
      expect(err.status).toBe(expected[code].status);
      expect(err.message).toBe(expected[code].description);
      expect(NEAR_ERROR_CODES[code]).toEqual(expected[code]);
      expect(err.message).not.toMatch(banned);
    }
  });
});
