import { beginEmailAuth, failEmailAuth } from '../analytics/auth';
import { authenticateFastAuthEmailPopup, isFastAuthPopupCancelled } from './fastAuthSpa';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PilotEmailBoxDeps {
  busy(): boolean;
  close(dialog: HTMLDialogElement): void;
  login(hit: { provider: string; token: string }): void;
  showGuest(message: string): void;
  isDisposed(): boolean;
}

/** Email / passkey FastAuth row inside the pilot provider dialog. */
export function buildPilotEmailBox(
  deps: PilotEmailBoxDeps,
  dialog: HTMLDialogElement,
  getMode: () => 'signin' | 'signup',
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'pilot-email-box';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'input';
  emailInput.placeholder = 'pilot@terraagent.fun';
  emailInput.dataset.testid = 'pilot-email-input';
  const inlineErr = document.createElement('span');
  inlineErr.className = 'pilot-status';
  inlineErr.style.display = 'none';
  const emailBtn = document.createElement('button');
  emailBtn.type = 'button';
  emailBtn.className = 'btn btn-ghost btn-sm';
  emailBtn.dataset.testid = 'continue-email';
  emailBtn.textContent = 'Email / Passkey (FastAuth)';
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  emailBtn.onclick = () => start();
  box.append(emailInput, inlineErr, emailBtn);
  return box;

  function start(): void {
    if (deps.busy()) return;
    const clean = emailInput.value.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      inlineErr.textContent = 'Enter a valid email address.';
      inlineErr.style.display = 'block';
      return;
    }
    inlineErr.style.display = 'none';
    const mode = getMode();
    deps.close(dialog);
    beginEmailAuth();
    void authenticateFastAuthEmailPopup({ email: clean, mode })
      .then((res) => deps.login({ provider: 'email', token: res.idToken }))
      .catch((err: unknown) => {
        if (deps.isDisposed()) return;
        failEmailAuth(err);
        if (isFastAuthPopupCancelled(err)) deps.showGuest('Sign-in was cancelled.');
        else deps.showGuest(err instanceof Error && err.message ? err.message : 'FastAuth Email sign-in could not be completed.');
      });
  }
}
