/**
 * Player lines for the four F5 codes. Duplicated from `NEAR_ERROR_CODES` in
 * `backend/app/src/near/domain/errors.ts` (the client does not import the server).
 */
export const NEAR_PLAYER_ERRORS = {
  NEAR_PROVIDER_REJECTED: 'That sign-in could not be confirmed. Try again.',
  NEAR_NAME_TAKEN: 'That Pilot ID is already in use.',
  NEAR_RELAY_FAILED: "Couldn't save to orbit. Retrying.",
  NEAR_RELAY_RECEIVER_NOT_ALLOWED: 'That save is not allowed for this colony.',
} as const;

export type NearPlayerErrorCode = keyof typeof NEAR_PLAYER_ERRORS;

export function nearPlayerText(code: string): string | undefined {
  if (!Object.hasOwn(NEAR_PLAYER_ERRORS, code)) return undefined;
  return NEAR_PLAYER_ERRORS[code as NearPlayerErrorCode];
}
