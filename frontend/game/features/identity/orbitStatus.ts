import type { FeatureContext, HudPanelInstance } from '../../core/registry/types';
import { makeBtn, makeDiv } from '../shared/dom';

const POLL_MS = 400;
const SAVING = 'Saving to orbit…';
const FAILED = "Couldn't save to orbit, retrying";

type Phase = 'off' | 'saving' | 'failed';
type RelayState = 'none' | 'pending' | 'settled' | 'failed';

interface RelayPoll {
  poll(): Promise<{ state: RelayState }>;
  retry(): Promise<{ state: 'pending' }>;
}

interface Loop {
  host: HTMLElement;
  phase: Phase;
  disposed: boolean;
  busy: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  watch: RelayPoll | null;
}

function paint(loop: Loop, onRetry: () => void): void {
  loop.host.replaceChildren();
  if (loop.phase === 'saving') {
    const chip = makeDiv('ta-orbit-save', 'orbit-save', SAVING);
    chip.setAttribute('role', 'status');
    loop.host.append(chip);
    return;
  }
  if (loop.phase !== 'failed') return;
  const toast = makeDiv('ta-orbit-toast plate-sm', 'orbit-toast');
  toast.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = FAILED;
  toast.append(label, makeBtn('btn btn-primary btn-sm', 'orbit-retry', 'Retry', onRetry));
  loop.host.append(toast);
}

function clearTimer(loop: Loop): void {
  if (loop.timer !== undefined) clearTimeout(loop.timer);
  loop.timer = undefined;
}

function arm(loop: Loop, poll: () => void): void {
  clearTimer(loop);
  if (loop.disposed) return;
  loop.timer = setTimeout(poll, POLL_MS);
}

function apply(loop: Loop, state: RelayState, poll: () => void): void {
  if (state === 'pending') {
    loop.phase = 'saving';
    paint(loop, () => onRetry(loop, poll));
    arm(loop, poll);
    return;
  }
  clearTimer(loop);
  loop.phase = state === 'failed' ? 'failed' : 'off';
  paint(loop, () => onRetry(loop, poll));
}

async function pollOnce(loop: Loop): Promise<void> {
  if (loop.disposed || !loop.watch) return;
  try {
    const snap = await loop.watch.poll();
    if (!loop.disposed) apply(loop, snap.state, () => { void pollOnce(loop); });
  } catch {
    if (!loop.disposed && loop.phase === 'saving') arm(loop, () => { void pollOnce(loop); });
  }
}

function onRetry(loop: Loop, poll: () => void): void {
  if (loop.busy || !loop.watch || loop.phase !== 'failed') return;
  loop.busy = true;
  loop.phase = 'saving';
  paint(loop, () => onRetry(loop, poll));
  void loop.watch.retry()
    .then(() => pollOnce(loop))
    .catch(() => { if (!loop.disposed) apply(loop, 'failed', poll); })
    .finally(() => { loop.busy = false; });
}

function epochOf(ctx: FeatureContext): number {
  return ctx.services.pilot?.view().saveEpoch ?? 0;
}

/** Saving chip and retry toast. `loginSocial` shows the chip at once. An already linked pilot is polled with no chip until the deposit is pending or failed. */
export function mountOrbitStatus(el: HTMLElement, ctx: FeatureContext): HudPanelInstance {
  const pilot = ctx.services.pilot;
  const host = makeDiv('ta-orbit');
  el.appendChild(host);
  const loop: Loop = { host, phase: 'off', disposed: false, busy: false, timer: undefined, watch: null };
  let seen = epochOf(ctx);

  const begin = (showNow: boolean): void => {
    if (!pilot?.watchRelay) return;
    const view = pilot.view();
    if (view.isGuest || !view.accountId) return;
    clearTimer(loop);
    loop.watch = pilot.watchRelay();
    if (showNow) {
      loop.phase = 'saving';
      paint(loop, () => onRetry(loop, () => { void pollOnce(loop); }));
    }
    void pollOnce(loop);
  };

  const sync = (): void => {
    const epoch = epochOf(ctx);
    const view = pilot?.view();
    const linked = Boolean(view && !view.isGuest && view.accountId);
    if (epoch > seen) {
      seen = epoch;
      begin(true);
      return;
    }
    if (linked && !loop.watch) begin(false);
  };

  const off = pilot?.subscribe(sync);
  sync();
  return {
    dispose() {
      loop.disposed = true;
      clearTimer(loop);
      off?.();
      host.remove();
    },
  };
}
