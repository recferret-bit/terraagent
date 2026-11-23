import { CLOSE_CODES } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { closeAction, terminalText, UNSUPPORTED_PROTO } from './closeCodes';

describe('close codes: protocol version mismatch', () => {
  it('an app on a newer ws protocol ends the session with a reload prompt instead of retrying', () => {
    expect(closeAction(CLOSE_CODES.bad_hello, UNSUPPORTED_PROTO)).toBe('terminal');
    expect(terminalText(CLOSE_CODES.bad_hello, UNSUPPORTED_PROTO)).toMatch(/Reload/);
  });

  it('other bad hellos still retry once', () => {
    expect(closeAction(CLOSE_CODES.bad_hello, 'bad_token')).toBe('reconnect-once');
    expect(terminalText(CLOSE_CODES.bad_hello, 'bad_token')).toBe("Couldn't join colony");
  });
});
