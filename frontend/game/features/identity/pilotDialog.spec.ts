// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isGameInputBlocked, resetGameInputBlock } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry/types';
import { formatPlanetDisplayLabel } from '../shared/planetLabel';
import { formatPilotDisplayName, mountPilotChip, PilotDialog } from './index';

describe('Pilot display name, logout removal & full-featured PilotDialog', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('formats raw guest/pilot/oauth identifiers cleanly while preserving custom handles', () => {
    expect(formatPilotDisplayName({ isGuest: true, handle: '', accountId: null })).toBe('Guest Pilot');
    expect(formatPilotDisplayName({ isGuest: true, handle: 'guest_9f8e7d6c5b', accountId: null })).toBe('Pilot #9F8E');
    expect(formatPilotDisplayName({ isGuest: true, handle: 'pilot-1234', accountId: null })).toBe('Pilot #1234');
    expect(formatPilotDisplayName('', 'p-1956.pilots.terraagent.testnet', false)).toBe('Pilot #1956');
    expect(formatPilotDisplayName('p_a1b2', 'p_a1b2.terraagent.testnet', false)).toBe('Pilot #A1B2');
    expect(formatPilotDisplayName({ isGuest: true, handle: 'Colonist-A1B2', accountId: null })).toBe('Pilot #A1B2');
    expect(
      formatPilotDisplayName({
        isGuest: false,
        handle: 'google-oauth2-1069208173371956-2',
        accountId: 'google-oauth2-1069208173371956-2.terraagent.testnet',
      }),
    ).toBe('Pilot #1956');
    expect(
      formatPilotDisplayName({
        isGuest: false,
        handle: '',
        accountId: 'google-oauth2-1069208173371956-2.terraagent.testnet',
      }),
    ).toBe('Pilot #1956');
    expect(formatPilotDisplayName('google-oauth2|1069208173371956')).toBe('Pilot #1956');
    expect(formatPilotDisplayName('linkedin|99887766')).toBe('Pilot #7766');
    expect(formatPilotDisplayName('', 'google-oauth2-1069208173371956-2.pilots.terraagent.testnet', false)).toBe(
      'Pilot #1956',
    );
    expect(formatPilotDisplayName('', 'aria.pilots.terraagent.testnet', false)).toBe('Aria');
    expect(formatPilotDisplayName('pilot-nova')).toBe('Pilot Nova');
    expect(formatPilotDisplayName('twitter-987654321', 'twitter-987654321.terraagent.testnet', false)).toBe('Pilot #4321');
    expect(
      formatPilotDisplayName({
        isGuest: false,
        handle: 'google-oauth2|1069208173371956',
        accountId: 'captain-aria.terraagent.testnet',
      }),
    ).toBe('Captain Aria');
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
});

describe('Full-featured PilotDialog', () => {
  afterEach(() => {
    document.body.replaceChildren();
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
      colonies: [
        {
          index: 0,
          name: 'Helios Outpost',
          stage: 3,
          terraformBp: 4200,
          stock: { 'metals.t1': 120, 'metals.t2': 30, 'minerals.t1': 60, 'bio.biomass': 25 },
        },
      ],
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
    expect(modal.querySelector('[data-testid="pilot-stat-stock"]')?.textContent).toBe('M 150 · Mn 60 · B 25');

    const meLink = modal.querySelector<HTMLAnchorElement>('[data-testid="pilot-open-me"]')!;
    expect(meLink).not.toBeNull();
    expect(meLink.getAttribute('href')).toBe('/me.html');
    expect(meLink.getAttribute('target')).toBe('_blank');
    expect(isGameInputBlocked()).toBe(true);

    modal.querySelector<HTMLButtonElement>('[data-testid="pilot-dialog-close"]')?.click();
    expect(modal.getAttribute('data-open')).toBe('false');
    expect(isGameInputBlocked()).toBe(false);
    dialog.dispose();

    expect(formatPlanetDisplayLabel('pl_w18', 'temperate')).toBe('Sector W18 · Temperate');
    expect(formatPlanetDisplayLabel('pl_01M7CWQVFMKGGHFD1NG00TH5Z4', 'temperate')).toBe('Sector #H5Z4 · Temperate');
    expect(formatPlanetDisplayLabel('dune-prime', 'dune')).toBe('Dune Prime');
  });

  it('shows full #1956 code monogram without truncating to #19 for opaque Pilot IDs', () => {
    const host = document.createElement('div');
    const overlay = document.createElement('div');
    document.body.append(host, overlay);
    const dialog = new PilotDialog(host, {
      flags: new Set(['W06']),
      host: 'server',
      services: {
        track: () => {},
        hudOverlay: overlay,
        session: { planetId: () => 'pl_w18', colonyId: () => 'col_0' },
        pilot: {
          view: () => ({
            isGuest: false,
            handle: 'google-oauth2-1069208173371956-2',
            accountId: 'google-oauth2-1069208173371956-2.terraagent.testnet',
            accessToken: 'tok',
          }),
          subscribe: () => () => {},
          loginSocial: async () => {},
        },
      },
    });
    dialog.setOpen(true);
    const modal = overlay.querySelector<HTMLElement>('[data-testid="pilot-dialog"]')!;
    expect(modal.querySelector('.ta-pilot-dossier-card__monogram')?.textContent).toBe('#1956');
    expect(modal.querySelector('[data-testid="pilot-stat-planet"]')?.textContent).toBe('Sector W18');
    dialog.dispose();
  });
});
