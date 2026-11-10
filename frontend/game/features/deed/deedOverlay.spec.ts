// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { DeedPanel } from './deedPanel';
import type { SignerModalRequest } from './signerModal';
import { openMockWalletSignerModal } from './signerModal';
import { StakingPanel } from './stakingPanel';

const offlineFetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;

function ctxWith(services: Partial<FeatureContext['services']>): FeatureContext {
  return { flags: new Set(['W20']), host: 'server', services: { track: () => {}, ...services } };
}

afterEach(() => document.body.replaceChildren());

describe('Deed modal in the HUD overlay (Colony book Deed tab keeps only the trigger)', () => {
  it('puts the trigger and hint in the tab pane and the modal in the overlay', () => {
    const pane = document.createElement('div');
    const overlay = document.createElement('div');
    const panel = new DeedPanel(pane, ctxWith({ hudOverlay: overlay }), { fetchFn: offlineFetch });
    expect(pane.contains(panel.triggerBtn)).toBe(true);
    expect(pane.querySelector('.ta-deed-hud-hint')?.textContent).toMatch(/deed card/i);
    expect(overlay.contains(panel.root)).toBe(true);
    expect(pane.contains(panel.root)).toBe(false);
    panel.dispose();
  });

  it('opens the overlay modal from the trigger and from setOpen (menu entry)', () => {
    const pane = document.createElement('div');
    const overlay = document.createElement('div');
    const panel = new DeedPanel(pane, ctxWith({ hudOverlay: overlay }), { fetchFn: offlineFetch });
    panel.triggerBtn.click();
    expect(panel.root.dataset.open).toBe('true');
    panel.setOpen(false);
    expect(panel.root.dataset.open).toBe('false');
    panel.setOpen(true);
    expect(overlay.querySelector('[data-testid=deed-panel]')?.getAttribute('data-open')).toBe('true');
    panel.dispose();
  });

  it('falls back to the panel element without an overlay, and dispose removes everything in both cases', () => {
    const pane = document.createElement('div');
    const legacy = new DeedPanel(pane, ctxWith({}), { fetchFn: offlineFetch });
    expect(pane.contains(legacy.root)).toBe(true);
    legacy.dispose();
    expect(pane.childElementCount).toBe(0);

    const overlay = document.createElement('div');
    const panel = new DeedPanel(pane, ctxWith({ hudOverlay: overlay }), { fetchFn: offlineFetch });
    panel.dispose();
    expect(pane.childElementCount).toBe(0);
    expect(overlay.childElementCount).toBe(0);
  });

  it('registers a HUD closer that closes the open deed modal and unregisters on dispose', () => {
    let closer: (() => void) | null = null;
    const unreg = vi.fn(() => { closer = null; });
    const pane = document.createElement('div');
    const overlay = document.createElement('div');
    const panel = new DeedPanel(
      pane,
      ctxWith({ hudOverlay: overlay, registerHudCloser: (fn) => { closer = fn; return unreg; } }),
      { fetchFn: offlineFetch },
    );
    expect(closer).not.toBeNull();
    panel.setOpen(true);
    expect(panel.isOpenState()).toBe(true);
    closer!();
    expect(panel.isOpenState()).toBe(false);
    panel.dispose();
    expect(unreg).toHaveBeenCalledTimes(1);
  });
});

describe('Mock wallet signer joins the HUD overlay', () => {
  function capture(): { calls: SignerModalRequest[]; openSigner: (req: SignerModalRequest) => ReturnType<typeof openMockWalletSignerModal> } {
    const calls: SignerModalRequest[] = [];
    return {
      calls,
      openSigner: (req) => {
        calls.push(req);
        return { promise: Promise.resolve({ status: 'rejected', reason: 'test' }), approve() {}, reject() {}, close() {}, root: document.createElement('div') } as never;
      },
    };
  }

  it('passes the overlay as the signer container', async () => {
    const overlay = document.createElement('div');
    const signer = capture();
    const staking = new StakingPanel(document.createElement('div'), ctxWith({ hudOverlay: overlay }), { fetchFn: offlineFetch, openSigner: signer.openSigner });
    await staking.claimAccountFlow();
    expect(signer.calls[0]?.container).toBe(overlay);
    staking.dispose();
  });

  it('leaves the container unset without an overlay (the modal then uses document.body)', async () => {
    const signer = capture();
    const staking = new StakingPanel(document.createElement('div'), ctxWith({}), { fetchFn: offlineFetch, openSigner: signer.openSigner });
    await staking.claimAccountFlow();
    expect(signer.calls[0]?.container).toBeUndefined();
    staking.dispose();
  });

  it('really mounts the default modal in the given container, and in document.body when none (corner)', () => {
    const overlay = document.createElement('div');
    const req = { title: 't', actionSummary: 'a', accountId: 'pilot.mock', recipient: 'r', message: 'm' } as SignerModalRequest;
    const inOverlay = openMockWalletSignerModal({ ...req, container: overlay });
    expect(overlay.contains(inOverlay.root)).toBe(true);
    inOverlay.close();
    const inBody = openMockWalletSignerModal({ ...req, container: undefined });
    expect(document.body.contains(inBody.root)).toBe(true);
    inBody.close();
  });
});
