import { describe, expect, it } from 'vitest';
import { NEAR_ERROR_CODES, NearException } from '../../src/near/domain/errors';

describe('W06 error codes', () => {
  it('maps each F5 code to its HTTP status and a player-facing line', () => {
    const codes = ['NEAR_PROVIDER_REJECTED', 'NEAR_NAME_TAKEN', 'NEAR_RELAY_FAILED', 'NEAR_RELAY_RECEIVER_NOT_ALLOWED'] as const;
    const banned = /wallet|gas|transaction|seed phrase|private key/i;
    for (const code of codes) {
      const err = new NearException(code);
      expect(err.status).toBe(NEAR_ERROR_CODES[code].status);
      expect(err.message).toBe(NEAR_ERROR_CODES[code].description);
      expect(err.message).not.toMatch(banned);
    }
    expect(new NearException('NEAR_PROVIDER_REJECTED').status).toBe(401);
    expect(new NearException('NEAR_RELAY_FAILED').status).toBe(503);
  });
});
