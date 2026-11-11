/** `errorCode` from a JSON envelope. A body that is not JSON is a null code, not a throw. */
export async function readApiErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { errorCode?: unknown; error?: { code?: unknown } };
    if (typeof body?.errorCode === 'string') return body.errorCode;
    if (typeof body?.error?.code === 'string') return body.error.code;
  } catch {
    return null;
  }
  return null;
}

/**
 * One planet-scoped POST. A missing planet id is a no-op.
 * A thrown fetch (offline) is shown as `REQUEST_FAILED`; the catch is the UI signal, not a swallowed error.
 */
export async function sendPlanetRequest(
  planetId: string | null,
  run: (planetId: string) => Promise<Response>,
  fail: (code: string) => void,
): Promise<boolean> {
  if (!planetId) return false;
  try {
    const res = await run(planetId);
    if (!res.ok) {
      fail((await readApiErrorCode(res)) ?? 'REQUEST_FAILED');
      return false;
    }
  } catch {
    fail('REQUEST_FAILED');
    return false;
  }
  return true;
}
