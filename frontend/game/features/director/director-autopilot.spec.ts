// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import directorFeature from './index';

function buildView(aiEnabled: boolean, awayRaids: boolean) {
  return {
    colonies: [{ index: 0, id: 'col_0', aiEnabled }],
    blobs: {
      director: {
        byColony: {
          '0': {
            policy: {
              version: 1,
              revision: 1,
              permissionRevision: 0,
              risk: 'conservative' as const,
              preset: 'resources' as const,
              priorities: { economy: 70, expansion: 40, defense: 50, power: 60, terraform: 50 },
              skillAllow: [],
              skillDeny: [],
              protectedGoalIds: [],
              protectedEntityIds: [],
              protectedAreas: [],
              note: '',
              pause: false,
            },
            intentRevision: 0,
            awayRaids,
            plans: [],
          },
        },
      },
    },
  };
}

describe('Director HUD AI Autopilot & War/Diplomacy opt-in', () => {
  it('defaults to AI AUTOPILOT: OFF and dispatches setAiEnabled + setAutopilot on click', () => {
    const sent: Array<{ kind: string; args: unknown }> = [];
    const ctx: FeatureContext = {
      flags: new Set(['W16', 'W18']),
      host: 'local',
      services: {
        store: {
          sendCommand: (kind, args) => {
            sent.push({ kind: String(kind), args });
            return 'cm_auto';
          },
        },
      },
    };
    const mount = document.createElement('div');
    const inst = directorFeature.hud?.[0]?.mount(mount, ctx);
    inst?.update?.(buildView(false, false));

    expect(mount.querySelector('[name="awayRaids"]')).toBeNull();
    const autoBtn = mount.querySelector<HTMLButtonElement>('[data-testid="director-autopilot-toggle"]');
    const warToggle = mount.querySelector<HTMLInputElement>('[data-testid="director-war-diplomacy-toggle"]');
    expect(autoBtn?.textContent).toBe('AI AUTOPILOT: OFF');
    expect(warToggle?.checked).toBe(false);

    autoBtn!.click();
    expect(sent[0]).toEqual({ kind: 'setAiEnabled', args: { enabled: true } });

    warToggle!.checked = true;
    warToggle!.dispatchEvent(new Event('change'));
    expect(sent[1]).toEqual({ kind: 'setAutopilot', args: { awayRaids: true } });

    inst?.update?.(buildView(true, true));
    expect(autoBtn?.textContent).toBe('AI AUTOPILOT: ON');
    expect(autoBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(warToggle?.checked).toBe(true);
    inst?.dispose();
  });
});
