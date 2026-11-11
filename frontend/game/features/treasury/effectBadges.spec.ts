// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadFeatures } from '../../core/registry';
import { EffectHud } from './EffectHud';
import { effectBadges } from './effectModel';

const TICK_S = 0.2;

function treasury(effects: Record<string, { untilTick: number; magnitudeBp: number }>): unknown {
  return { effects, hazardStrikes: 0, lightningStrikes: 0 };
}

describe('effect badges', () => {
  it('positive: both future effects are two badges whose remaining time is the tick math', () => {
    const tick = 1_000;
    const shieldUntil = tick + 650;
    const boostUntil = tick + 21_600;
    const blob = treasury({
      meteor_shield: { untilTick: shieldUntil, magnitudeBp: 7500 },
      terraform_boost: { untilTick: boostUntil, magnitudeBp: 2500 },
      guild_subsidy: { untilTick: tick + 99_999, magnitudeBp: 1 },
    });
    const badges = effectBadges({ tick, w22: true, treasury: blob });
    expect(badges.map((b) => b.kind)).toEqual(['meteor_shield', 'terraform_boost']);
    expect(badges[0].remainingSeconds).toBe((shieldUntil - tick) * TICK_S);
    expect(badges[0].timer).toBe('2:10');
    expect(badges[1].remainingSeconds).toBe((boostUntil - tick) * TICK_S);
    expect(badges[1].timer).toBe('1:12');
    expect(effectBadges({ tick, w22: true, treasury: { value: blob } })).toEqual(badges);
  });

  it('negative: an empty blob shows nothing, and W22 off shows nothing even when the blob is set', () => {
    const set = treasury({
      meteor_shield: { untilTick: 500, magnitudeBp: 7500 },
      terraform_boost: { untilTick: 800, magnitudeBp: 2500 },
    });
    expect(effectBadges({ tick: 10, w22: true, treasury: null })).toEqual([]);
    expect(effectBadges({ tick: 10, w22: true, treasury: {} })).toEqual([]);
    expect(effectBadges({ tick: 10, w22: true, treasury: { effects: {} } })).toEqual([]);
    expect(effectBadges({ tick: 10, w22: false, treasury: set })).toEqual([]);
    const flags = new Set(['W00', 'W01']);
    expect(loadFeatures({ flags, host: 'server' }).some((f) => f.id === 'treasury')).toBe(false);
  });

  it('corner: the badge drops at untilTick and when the tick is past, and magnitude is not the timer', () => {
    const tick = 50;
    const atEnd = effectBadges({
      tick,
      w22: true,
      treasury: treasury({
        meteor_shield: { untilTick: tick, magnitudeBp: 7500 },
        terraform_boost: { untilTick: tick + 30, magnitudeBp: 2500 },
      }),
    });
    expect(atEnd.map((b) => b.kind)).toEqual(['terraform_boost']);
    expect(atEnd[0].remainingSeconds).toBe(30 * TICK_S);
    expect(effectBadges({
      tick: tick + 1,
      w22: true,
      treasury: treasury({ meteor_shield: { untilTick: tick, magnitudeBp: 7500 } }),
    })).toEqual([]);
    const shown = effectBadges({
      tick: 0,
      w22: true,
      treasury: treasury({ meteor_shield: { untilTick: 10, magnitudeBp: 7500 } }),
    });
    expect(shown).toHaveLength(1);
    expect(shown[0].remainingSeconds).toBe(10 * TICK_S);
    expect(shown[0].timer).toBe('0:02');
    expect(shown[0].timer).not.toContain('7500');
    expect(shown[0]).not.toHaveProperty('magnitudeBp');
    expect(JSON.stringify(shown[0])).not.toContain('7500');
  });
});

describe('effect badge HUD', () => {
  it('shows both clocks, the shield veil and a teal mark on Irrigate and Seed', () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.className = 'ta-hud';
    const panel = document.createElement('div');
    host.appendChild(panel);
    document.body.appendChild(host);
    const hud = new EffectHud(panel, host);
    const tick = 100;
    hud.update({
      tick,
      w22: true,
      treasury: treasury({
        meteor_shield: { untilTick: tick + 650, magnitudeBp: 7500 },
        terraform_boost: { untilTick: tick + 21_600, magnitudeBp: 2500 },
      }),
    });
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[data-testid="effect-timer-meteor_shield"]')?.textContent).toBe('2:10');
    expect(panel.querySelector('[data-testid="effect-timer-terraform_boost"]')?.textContent).toBe('1:12');
    expect(host.querySelector('[data-testid="shield-shimmer"]')?.hasAttribute('hidden')).toBe(false);
    expect(panel.querySelector('[data-testid="living-op-irrigate"]')?.getAttribute('data-boosted')).toBe('true');
    expect(panel.querySelector('[data-testid="living-op-seed"]')?.getAttribute('data-boosted')).toBe('true');
    expect(panel.querySelector('[data-testid="living-ops"]')?.hasAttribute('hidden')).toBe(false);
    hud.update({ tick, w22: false, treasury: treasury({ meteor_shield: { untilTick: tick + 10, magnitudeBp: 7500 } }) });
    expect(panel.hidden).toBe(true);
    expect(host.querySelector('[data-testid="shield-shimmer"]')?.hasAttribute('hidden')).toBe(true);
    expect(panel.querySelector('[data-testid="living-op-irrigate"]')?.getAttribute('data-boosted')).toBe('false');
    hud.dispose();
  });
});
