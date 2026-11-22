import { authenticateFastAuthEmailPopup, isFastAuthPopupCancelled } from './fastAuthSpa';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PilotEmailBoxCallbacks {
  readonly isBusy: () => boolean;
  readonly isDisposed: () => boolean;
  readonly getMode: () => 'signin' | 'signup';
  readonly allowOfflineLocalAuth?: boolean;
  readonly onCloseDialog: () => void;
  readonly onToken: (hit: { provider: 'email'; token: string }) => void;
  readonly onGuestError: (message: string) => void;
}

export function buildPilotEmailFastAuthBox(cb: PilotEmailBoxCallbacks): HTMLElement {
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

  const startEmailAuth = (): void => {
    if (cb.isBusy()) return;
    const clean = emailInput.value.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      inlineErr.textContent = 'Enter a valid email address.';
      inlineErr.style.display = 'block';
      return;
    }
    inlineErr.style.display = 'none';
    const mode = cb.getMode();
    cb.onCloseDialog();
    if (cb.allowOfflineLocalAuth) {
      cb.onToken({ provider: 'email', token: clean });
      return;
    }
    void authenticateFastAuthEmailPopup({ email: clean, mode })
      .then((res) => {
        cb.onToken({ provider: 'email', token: res.idToken });
      })
      .catch((err: unknown) => {
        if (cb.isDisposed()) return;
        if (isFastAuthPopupCancelled(err)) {
          cb.onGuestError('Sign-in was cancelled.');
          return;
        }
        cb.onGuestError(
          err instanceof Error && err.message ? err.message : 'FastAuth Email sign-in could not be completed.',
        );
      });
  };

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startEmailAuth();
  });
  emailBtn.onclick = startEmailAuth;
  box.append(emailInput, inlineErr, emailBtn);
  return box;
}
