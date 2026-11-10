// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFeatures } from '../../core/registry';
import type { FeatureContext } from '../../core/registry/types';
import { CouncilPanel } from './CouncilPanel';
import { COUNCIL_PHONE, councilPanelBounds } from './councilLayout';
import { mountCouncilSheet } from './councilDom';
import { councilView, mergeProposalPush, type CouncilView } from './councilModel';
import { PlanetMenu } from './planetMenu';

const NOW = 1_700_000_000_000;

const payload = {
  balance: { 'metals.t1': '1500' },
  members: [{ accountId: 'col-a', canPropose: true }, { accountId: 'col-b', canPropose: true }],
  effects: [],
  proposals: [{
    proposalId: 7,
    kind: 'meteor_shield',
    state: 'InProgress',
    yes: 2,
    no: 0,
    cost: '1500',
    deadlineMs: NOW + 6 * 3_600_000,
  }],
  projects: [
    { kind: 'meteor_shield', cost: '1500' },
    { kind: 'terraform_boost', cost: '1000' },
    { kind: 'guild_subsidy', cost: '800' },
  ],
};

function paint(view: CouncilView): HTMLElement {
  const host = document.createElement('div');
  const dom = mountCouncilSheet(host, { close() {}, propose() {}, vote() {} });
  dom.root.hidden = false;
  dom.paint(view);
  return host;
}

describe('council view', () => {
  it('positive: a balance of 1500 and one InProgress proposal renders the cost and a vote count', () => {
    const view = councilView({ w22: true, payload, tick: 10, nowMs: NOW });
    expect(view.menuItem).toEqual({ id: 'council', label: 'Council' });
    expect(view.balance).toBe('1500');
    expect(view.memberCount).toBe(2);
    const host = paint(view);
    expect(host.querySelector('[data-testid="council-balance"]')?.textContent).toBe('1500');
    expect(host.querySelector('[data-testid="council-cost"]')?.textContent).toBe('1500');
    expect(host.querySelector('[data-testid="council-votes"]')?.textContent).toBe('2 yes · 0 no');
    expect(host.querySelector('[data-testid="council-project-meteor_shield"]')?.textContent).toBe('Meteor shield · 1500');
    expect(host.querySelector('[data-testid="council-project-terraform_boost"]')?.textContent).toBe('Terraform boost · 1000');
    expect(host.querySelector('[data-testid="council-project-guild_subsidy"]')?.textContent).toBe('Guild subsidy · 800');
    expect(host.querySelector('[data-testid="council-vote-yes-7"]')?.classList.contains('btn-primary')).toBe(true);
    const shielded = councilView({
      w22: true,
      payload,
      tick: 1000,
      nowMs: NOW,
      treasury: { effects: { meteor_shield: { untilTick: 1650, magnitudeBp: 7500 } } },
    });
    expect(shielded.effects).toEqual([{ kind: 'meteor_shield', label: 'Meteor shield', timer: '2:10' }]);
    const tuned = councilView({
      w22: true,
      payload: { ...payload, projects: [{ kind: 'meteor_shield', cost: '1600' }] },
      nowMs: NOW,
    });
    expect(paint(tuned).querySelector('[data-testid="council-project-meteor_shield"]')?.textContent).toBe('Meteor shield · 1600');
    const pushed = mergeProposalPush(payload, { proposalId: 7, yes: 4, no: 1, state: 'InProgress', cost: '1500', kind: 'meteor_shield', deadlineMs: payload.proposals[0].deadlineMs });
    expect(councilView({ w22: true, payload: pushed, nowMs: NOW }).proposals[0].votes).toBe('4 yes · 1 no');
    const menu = new PlanetMenu(document.createElement('div'));
    menu.register({ id: 'council', label: 'Council', open() {} });
    expect(menu.root.querySelector('[data-testid="planet-menu-council"]')?.textContent).toBe('Council');
    const on = loadFeatures({ flags: new Set(['W22']), host: 'server' });
    expect(on.flatMap((f) => f.menus ?? []).some((m) => m.id === 'council' && m.label === 'Council')).toBe(true);
  });

  it('negative: W22 off yields no menu item and an empty model', () => {
    const view = councilView({ w22: false, payload, errorCode: 'TREASURY_INSUFFICIENT' });
    expect(view.menuItem).toBeNull();
    expect(view.balance).toBe('');
    expect(view.members).toEqual([]);
    expect(view.proposals).toEqual([]);
    expect(view.projects).toEqual([]);
    expect(view.error).toBeNull();
    expect(paint(view).querySelectorAll('option')).toHaveLength(0);
    const features = loadFeatures({ flags: new Set(['W00', 'W21']), host: 'server' });
    expect(features.some((f) => f.id === 'treasury')).toBe(false);
    expect(features.flatMap((f) => f.menus ?? []).some((m) => m.id === 'council' || m.label === 'Council')).toBe(false);
    const host = document.createElement('div');
    const panel = new CouncilPanel(host, host, { flags: new Set(['W00']), host: 'server', services: { track: () => undefined } });
    expect(host.querySelector('[data-testid="planet-menu-council"]')).toBeNull();
    panel.dispose();
  });

  it('corner: TREASURY_INSUFFICIENT is a shown string, and zero proposals is an empty state', async () => {
    expect(() => councilView({ w22: true, payload: { proposals: [] }, errorCode: 'TREASURY_INSUFFICIENT' })).not.toThrow();
    const view = councilView({ w22: true, payload: { balance: '0', proposals: [], projects: [{ kind: 'guild_subsidy', cost: '800' }] }, errorCode: 'TREASURY_INSUFFICIENT' });
    expect(view.error).toBe('The planet treasury cannot cover this project.');
    expect(view.empty).toBe(true);
    expect(view.projects.map((project) => project.kind)).toEqual(['guild_subsidy']);
    const host = paint(view);
    expect(host.querySelector('[data-testid="council-error"]')?.textContent).toBe(view.error);
    expect(host.querySelector('[data-testid="council-empty"]')?.textContent).toBe('No proposals');
    expect(host.querySelector('[data-testid="council-proposal-7"]')).toBeNull();

    const panelHost = document.createElement('div');
    document.body.appendChild(panelHost);
    const ctx: FeatureContext = {
      flags: new Set(['W22']),
      host: 'server',
      services: { track: () => undefined, session: { planetId: () => 'pl_dune' } },
    };
    const fetchImpl = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ errorCode: 'TREASURY_INSUFFICIENT', error: { code: 'treasury_insufficient', message: 'nope' } }),
    }) as Response;
    const panel = new CouncilPanel(panelHost, panelHost, ctx, { fetchImpl });
    await expect(panel.open()).resolves.toBeUndefined();
    expect(panelHost.querySelector('[data-testid="council-error"]')?.textContent).toBe('The planet treasury cannot cover this project.');
    expect(panelHost.querySelector('[data-testid="council-empty"]')?.textContent).toBe('No proposals');
    panel.dispose();
  });

  it('fits a 740×360 phone landscape by scrolling inside the gutter', () => {
    const box = councilPanelBounds(COUNCIL_PHONE.width, COUNCIL_PHONE.height);
    expect(box.maxWidth).toBeLessThanOrEqual(COUNCIL_PHONE.width);
    expect(box.maxHeight).toBeLessThanOrEqual(COUNCIL_PHONE.height);
    expect(box.scroll).toBe(true);
    const css = readFileSync(join(import.meta.dirname, 'council.css'), 'utf8');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('min(420px, calc(100vw - 16px))');
    expect(css).toContain('min(320px, calc(100vh - 16px))');
    expect(css).not.toContain('border-radius');
  });
});
