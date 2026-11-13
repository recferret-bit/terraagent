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
      search: '?as=w12',
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
    expect(root.querySelector('[data-testid="me-ai-settings"]')).not.toBeNull();
    const modelSelect = root.querySelector('[data-testid="me-ai-model-select"]') as HTMLSelectElement | null;
    expect(modelSelect?.value).toBe('z-ai/glm-5.3');
  });

  it('renders Player page is off plate when /v1/me/profile returns wave_disabled (403)', async () => {
    const root = document.createElement('div');
    const page = new MePage(root, {
      search: '?as=w12',
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

describe('/me NEAR.AI Bot Decision Manager settings section', () => {
  it('saves NEAR.AI API key and selected model from /me page via PUT /v1/me/ai-settings', async () => {
    const root = document.createElement('div');
    const profile = makeW12ProfileFixture();
    const achievements = makeW12AchievementsFixture();
    let putBody: unknown = null;

    const page = new MePage(root, {
      search: '?as=w12',
      fetch: async (url, init) => {
        if (url.includes('/v1/me/ai-settings') && init?.method === 'PUT') {
          putBody = JSON.parse(String(init.body ?? '{}'));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hasApiKey: true,
              apiKeyPreview: 'sk-p••••1234',
              model: (putBody as { model: string }).model,
              availableModels: ['z-ai/glm-5.3', 'deepseek/deepseek-v3.2'],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => (url.includes('/profile') ? profile : achievements),
        };
      },
    });
    await page.load();

    const modelSelect = root.querySelector('[data-testid="me-ai-model-select"]') as HTMLSelectElement;
    const keyInput = root.querySelector('[data-testid="me-ai-key-input"]') as HTMLInputElement;
    const saveBtn = root.querySelector('[data-testid="me-ai-save-btn"]') as HTMLButtonElement;

    modelSelect.value = 'deepseek/deepseek-v3.2';
    keyInput.value = 'sk-player-key-1234';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(putBody).toEqual({
      model: 'deepseek/deepseek-v3.2',
      apiKey: 'sk-player-key-1234',
    });
    expect(root.querySelector('[data-testid="me-ai-badge"]')?.textContent).toBe('NEAR.AI CONNECTED');
    expect(root.querySelector('[data-testid="me-ai-key-preview"]')?.textContent).toContain('sk-p••••1234');
  });
});

describe('/me NEAR.AI settings — cookie refresh auth token & waves query forwarding', () => {
  it('reuses the refreshed access token and waves query when saving NEAR.AI settings without ?as= or localStorage', async () => {
    window.localStorage.clear();
    const root = document.createElement('div');
    const profile = makeW12ProfileFixture();
    const achievements = makeW12AchievementsFixture();
    let putUrl = '';
    let putAuthHeader = '';

    const page = new MePage(root, {
      search: '?waves=12',
      fetch: async (url, init) => {
        if (url.includes('/v1/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ accessToken: 'refreshed-jwt-token-xyz' }),
          };
        }
        if (url.includes('/v1/me/ai-settings') && init?.method === 'PUT') {
          putUrl = url;
          putAuthHeader = (init.headers as Record<string, string> | undefined)?.Authorization ?? '';
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hasApiKey: true,
              apiKeyPreview: 'sk-r••••9999',
              model: 'z-ai/glm-5.3',
              availableModels: ['z-ai/glm-5.3'],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => (url.includes('/profile') ? profile : achievements),
        };
      },
    });
    await page.load();

    const keyInput = root.querySelector('[data-testid="me-ai-key-input"]') as HTMLInputElement;
    const saveBtn = root.querySelector('[data-testid="me-ai-save-btn"]') as HTMLButtonElement;
    keyInput.value = 'sk-real-cookie-auth-9999';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(putUrl).toBe('/v1/me/ai-settings?waves=12');
    expect(putAuthHeader).toBe('Bearer refreshed-jwt-token-xyz');
    expect(root.querySelector('[data-testid="me-ai-badge"]')?.textContent).toBe('NEAR.AI CONNECTED');
  });
});
