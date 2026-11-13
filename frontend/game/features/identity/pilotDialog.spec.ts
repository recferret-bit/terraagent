// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { formatPilotDisplayName, mountPilotChip, PilotDialog } from './index';

describe('Pilot display name, logout removal & full-featured PilotDialog', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('formats raw guest/pilot identifiers cleanly while preserving custom handles', () => {
    expect(formatPilotDisplayName({ isGuest: true, handle: '', accountId: null })).toBe('Guest Pilot');
    expect(formatPilotDisplayName({ isGuest: true, handle: 'guest_9f8e7d6c5b', accountId: null })).toBe('Pilot #9F8E');
    expect(formatPilotDisplayName({ isGuest: true, handle: 'pilot-1234', accountId: null })).toBe('Pilot #1234');
    expect(formatPilotDisplayName({ isGuest: false, handle: 'Commander Nova', accountId: 'nova.near' })).toBe('Commander Nova');
  });

  it('removes the logout / sign-out button from PilotChip', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const ctx: FeatureContext = {
      flags: new Set(['W06']),
      host: 'server',
      services: {
        track: () => {},
        pilot: {
          view: () => ({ isGuest: false, handle: 'Nova', accountId: 'nova.near', accessToken: 'tok' }),
          subscribe: () => () => {},
          loginSocial: async () => {},
          logout: async () => {},
        },
      },
    };
    const inst = mountPilotChip(el, ctx);
    expect(el.querySelector('[data-testid="pilot-sign-out"]')).toBeNull();
    expect(el.textContent?.toLowerCase()).not.toContain('sign out');
    expect(el.textContent?.toLowerCase()).not.toContain('logout');
    inst.dispose();
  });

  it('opens a full-featured PilotDialog like Deed with colony details and a /me.html new-tab link', () => {
    const host = document.createElement('div');
    const overlay = document.createElement('div');
    document.body.append(host, overlay);
    const ctx: FeatureContext = {
      flags: new Set(['W06']),
      host: 'server',
      services: {
        track: () => {},
        hudOverlay: overlay,
        session: { planetId: () => 'dune-prime', colonyId: () => 'col_alpha' },
        pilot: {
          view: () => ({ isGuest: false, handle: 'Captain Aria', accountId: 'aria.near', accessToken: 'tok' }),
          subscribe: () => () => {},
          loginSocial: async () => {},
        },
      },
    };

    const dialog = new PilotDialog(host, ctx);
    dialog.update({
      planet: { id: 'dune-prime', type: 'dune' },
      colonies: [{ index: 0, name: 'Helios Outpost', stage: 3, terraformBp: 4200 }],
    } as never);

    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="pilot-dialog-trigger"]')!;
    expect(trigger).not.toBeNull();
    expect(trigger.dataset.dialogTrigger).toBe('true');
    expect(overlay.querySelector('[data-testid="pilot-dialog"]')?.getAttribute('data-open')).toBe('false');

    trigger.click();
    const modal = overlay.querySelector<HTMLElement>('[data-testid="pilot-dialog"]')!;
    expect(modal.getAttribute('data-open')).toBe('true');
    expect(modal.querySelector('[data-testid="pilot-dialog-title"]')?.textContent).toBe('Captain Aria');
    expect(modal.querySelector('[data-testid="pilot-stat-name"]')?.textContent).toBe('Captain Aria');
    expect(modal.querySelector('[data-testid="pilot-status-chip"]')?.textContent).toBe('LINKED PILOT');
    expect(modal.querySelector('[data-testid="pilot-stat-colony"]')?.textContent).toBe('Helios Outpost');
    expect(modal.querySelector('[data-testid="pilot-stat-stage"]')?.textContent).toContain('S3');
    expect(modal.querySelector('[data-testid="pilot-stat-terraform"]')?.textContent).toBe('42 %');

    const meLink = modal.querySelector<HTMLAnchorElement>('[data-testid="pilot-open-me"]')!;
    expect(meLink).not.toBeNull();
    expect(meLink.getAttribute('href')).toBe('/me.html');
    expect(meLink.getAttribute('target')).toBe('_blank');

    modal.querySelector<HTMLButtonElement>('[data-testid="pilot-dialog-close"]')?.click();
    expect(modal.getAttribute('data-open')).toBe('false');
    dialog.dispose();
  });
});
