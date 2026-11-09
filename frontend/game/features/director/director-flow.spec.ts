// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { DirectorControls } from './DirectorControls';
import { DirectorPanel } from './DirectorPanel';
import directorFeature from './index';

function ctx(flags: readonly string[]): FeatureContext {
  return { flags: new Set(flags), host: 'local', services: { track: () => {} } };
}

function viewWithPolicy(risk: 'conservative' | 'risky', revision: number, intentRevision: number) {
  return {
    blobs: {
      director: {
        byColony: {
          '0': {
            policy: {
              version: 1,
              revision,
              permissionRevision: 0,
              risk,
              preset: 'resources',
              priorities: { economy: 70, expansion: 40, defense: 50, power: 60, terraform: 30 },
              skillAllow: [],
              skillDeny: [],
              protectedGoalIds: [],
              protectedEntityIds: [],
              protectedAreas: [],
              note: 'w16 fixture',
              pause: false,
            },
            intentRevision,
            awayRaids: false,
            plans: [],
          },
        },
      },
    },
  };
}

describe('W16-45 director UI flow — controls & gating', () => {
  it('covers both risk profiles and does not grant away raids', () => {
    const host = document.createElement('div');
    const controls = new DirectorControls(host);
    const risk = host.querySelector<HTMLSelectElement>('select[name="risk"]');
    risk!.value = 'conservative';
    expect(controls.read().risk).toBe('conservative');
    risk!.value = 'risky';
    const args = controls.read();
    expect(args.risk).toBe('risky');
    expect(JSON.stringify(args)).not.toContain('awayRaids');
  });

  it('keeps a manual cancel rejected and hides the panel when W16 is off', () => {
    const host = document.createElement('div');
    const panel = new DirectorPanel(host);
    panel.render([{ actionId: 'cancel-manual', state: 'rejected', reason: 'locked_goal' }]);
    expect(host.querySelector('[data-state="rejected"]')?.textContent).toContain('rejected');
    expect(host.textContent).not.toContain('applied');

    const mount = document.createElement('div');
    const hud = directorFeature.hud?.[0];
    const hidden = hud?.mount(mount, ctx(['W00']));
    expect(mount.hidden).toBe(true);
    hidden?.dispose();
  });
});

describe('W16-45 director UI flow — live policy sync & superseding', () => {
  it('syncs colony policy onto the HUD plate, dispatches setDirectorPolicy, and supersedes older plans', async () => {
    const sent: { kind: string; args: unknown }[] = [];
    const tracked: { name: string; props: unknown }[] = [];
    const liveCtx: FeatureContext = {
      flags: new Set(['W16']),
      host: 'local',
      services: {
        store: {
          sendCommand: (kind, args) => {
            sent.push({ kind: String(kind), args });
            return 'cm_1';
          },
        },
        track: (name, props) => {
          tracked.push({ name, props });
        },
      },
    };
    const mount = document.createElement('div');
    const inst = directorFeature.hud?.[0]?.mount(mount, liveCtx);
    inst?.update?.(viewWithPolicy('conservative', 2, 1));

    const summary = mount.querySelector<HTMLElement>('[data-testid="director-policy-summary"]');
    expect(summary?.textContent).toContain('conservative · resources · 15% commit / 40% reserve');

    const planCmd = directorFeature.devCommands?.find((c) => c.name === 'director.plan');
    expect(await planCmd?.run([], liveCtx)).toContain('risk=conservative');
    expect(mount.querySelectorAll('.ta-director__row')).toHaveLength(1);

    const riskSelect = mount.querySelector<HTMLSelectElement>('select[name="risk"]');
    riskSelect!.value = 'risky';
    riskSelect!.dispatchEvent(new Event('change'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'setDirectorPolicy', args: { risk: 'risky' } });
    expect(tracked[0]?.name).toBe('director.policy_changed');

    inst?.update?.(viewWithPolicy('risky', 3, 2));
    expect(summary?.textContent).toContain('risky · resources · 35% commit / 15% reserve');
    expect(mount.querySelector('.ta-director__row')?.getAttribute('data-state')).toBe('superseded');

    expect(await planCmd?.run(['raid_proposal'], liveCtx)).toContain('outcome=unauthorized');
    expect(mount.querySelector('.ta-director__row')?.getAttribute('data-state')).toBe('rejected');
    expect(mount.querySelector('.ta-director__row')?.textContent).toContain('away_raids');

    inst?.dispose();
  });
});
