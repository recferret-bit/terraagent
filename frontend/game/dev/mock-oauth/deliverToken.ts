/** A minted mock token is either posted to the game window or, with no opener, left in this window's hash. */
export type TokenDelivery = 'posted' | 'redirected';

/**
 * Same-origin `window.opener` only. Reading `location` throws for a cross-origin opener; that is not our game window.
 */
export function sameOriginOpener(win: Window): Window | null {
  const opener = win.opener as Window | null;
  if (!opener) return null;
  try {
    if (opener.location.origin !== win.location.origin) return null;
    return opener;
  } catch {
    return null;
  }
}

/**
 * Popup path: `postMessage` the token and close. Does not navigate the opener (the game page).
 * No opener (the mock page was opened directly): redirect this window to `back#mock_token=`.
 */
export function deliverMintedToken(win: Window, provider: 'google' | 'x', token: string, back: string): TokenDelivery {
  const opener = sameOriginOpener(win);
  if (opener) {
    opener.postMessage({ type: 'terra:mock-token', provider, token }, win.location.origin);
    win.close();
    return 'posted';
  }
  const dest = new URL(back, win.location.origin);
  win.location.assign(`${dest.pathname}${dest.search}#mock_token=${encodeURIComponent(token)}`);
  return 'redirected';
}
