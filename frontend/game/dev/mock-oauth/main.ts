import { deliverMintedToken } from './deliverToken';
import './mock-oauth.css';

const FALLBACK = '/play.html';

/** Same-origin path only: one leading `/`, no `//`, no `://`, no backslash. */
function safeReturn(raw: string | null): string {
  if (raw !== null && raw.startsWith('/') && !raw.includes('//') && !raw.includes('://') && !raw.includes('\\')) return raw;
  return FALLBACK;
}

function providerOf(raw: string | null): 'google' | 'x' | 'fastauth' {
  if (raw === 'x') return 'x';
  if (raw === 'near' || raw === 'fastauth') return 'fastauth';
  return 'google';
}

function plateTitle(provider: 'google' | 'x' | 'fastauth'): string {
  if (provider === 'x') return 'X (mock)';
  if (provider === 'fastauth') return 'NEAR (mock)';
  return 'Google (mock)';
}

const params = new URLSearchParams(window.location.search);
const provider = providerOf(params.get('provider'));
const back = safeReturn(params.get('return'));

const title = document.getElementById('mo-title');
if (title) title.textContent = plateTitle(provider);

const errEl = document.getElementById('mo-err');
const preset = document.getElementById('mo-preset');
const useBtn = document.getElementById('mo-use');
const nameInput = document.getElementById('mo-name');

function say(message: string): void {
  if (errEl) errEl.textContent = message;
}

function setBusy(busy: boolean): void {
  if (preset instanceof HTMLButtonElement) preset.disabled = busy;
  if (useBtn instanceof HTMLButtonElement) useBtn.disabled = busy;
}

async function pick(subject: string): Promise<void> {
  if (subject.length < 1 || subject.length > 64) {
    say('Use 1–64 characters.');
    return;
  }
  say('');
  setBusy(true);
  try {
    const res = await fetch('/v1/dev/mock-oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, subject }),
    });
    if (!res.ok) {
      say('That sign-in could not be confirmed.');
      return;
    }
    const body = (await res.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      say('That sign-in could not be confirmed.');
      return;
    }
    deliverMintedToken(window, provider, body.token, back);
  } catch {
    say('That sign-in could not be confirmed.');
  } finally {
    setBusy(false);
  }
}

preset?.addEventListener('click', () => { void pick('test-pilot'); });
useBtn?.addEventListener('click', () => {
  const value = nameInput instanceof HTMLInputElement ? nameInput.value : '';
  void pick(value);
});
