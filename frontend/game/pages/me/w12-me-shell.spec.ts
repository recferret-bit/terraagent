// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el, formatThinInt } from './dom';
import { MePage } from './MePage';
import { makeW12AchievementsFixture, makeW12ProfileFixture } from './testFixtures';

describe('W12-13 /me page shell, sticky tabs, wave_disabled plate, and PA-03 safety', () => {
  it('renders the 6 sticky section tabs and 6 section plates', async () => {
    const root = document.createElement('div');
    const profile = makeW12ProfileFixture();
    const achievements = makeW12AchievementsFixture();

    const page = new MePage(root, {
      fetch: async (url) => ({
        ok: true,
        status: 200,
        json: async () => (url.includes('/profile') ? profile : achievements),
      }),
    });
    await page.load();

    const tabs = [...root.querySelectorAll('.ta-me-tab')].map((a) => a.textContent);
    expect(tabs).toEqual(['PILOT', 'PROGRESS', 'PLANETS', 'HISTORY', 'ACHIEVEMENTS', 'PLAY']);

    expect(root.querySelector('#pilot')).not.toBeNull();
    expect(root.querySelector('#progress')).not.toBeNull();
    expect(root.querySelector('#planets')).not.toBeNull();
    expect(root.querySelector('#history')).not.toBeNull();
    expect(root.querySelector('#achievements')).not.toBeNull();
    expect(root.querySelector('#play')).not.toBeNull();
    expect(root.querySelector('[data-testid="me-eyebrow-achievements"]')?.textContent).toBe(
      'ACHIEVEMENTS · 9 / 60',
    );
  });

  it('renders Player page is off plate when /v1/me/profile returns wave_disabled (403)', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, {
      fetch: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 'wave_disabled', message: 'Player page is off' } }),
      }),
    });
    await page.load();

    const disabled = root.querySelector('[data-testid="me-wave-disabled"]');
    expect(disabled).not.toBeNull();
    expect(disabled?.textContent).toContain('Player page is off');
  });

  it('escapes HTML payloads safely via textContent (PA-03) and formats numbers with spaces', () => {
    const node = el('div', null, '<img src=x onerror=alert(1)>');
    expect(node.querySelector('img')).toBeNull();
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(formatThinInt(12450)).toBe('12 450');
    expect(formatThinInt(1120)).toBe('1 120');
  });
});
