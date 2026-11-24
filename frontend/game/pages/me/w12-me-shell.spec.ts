// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { el, formatThinInt } from './dom';
import { MePage } from './MePage';
import { makeW12AchievementsFixture, makeW12ProfileFixture } from './testFixtures';

describe('W12-13 /me page shell, sticky tabs, wave_disabled plate, and PA-03 safety', () => {
  it('renders the 6 W12 sticky section tabs (+ STAKING with W28) and 6 W12 section plates', async () => {
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
    expect(tabs).toEqual(['PILOT', 'STAKING', 'PROGRESS', 'PLANETS', 'HISTORY', 'ACHIEVEMENTS', 'PLAY']);
    expect(root.querySelector('[data-testid="me-tab-staking"]')?.classList.contains('ta-me-tab--staking')).toBe(true);
    const sectionIds = [...root.querySelectorAll('main > section')].map((s) => s.id);
    expect(sectionIds.slice(0, 3)).toEqual(['pilot', 'staking', 'progress']);

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
    expect(modelSelect?.value).toBe('z-ai/glm-5.3-flash');
    expect(root.querySelector('[data-testid="me-colony-dive-in"]')?.getAttribute('href')).toBe(
      '/play.html?skip=1&colonyId=co_w12_live_1',
    );
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

  it('renders Sign in / Sign up prompt with PilotAccess when unauthenticated or guest instead of Profile Unavailable', async () => {
    window.localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_guest_1', accessToken: 'guest-jwt', updatedAt: 1, isGuest: true }),
    );
    let refreshCount = 0;
    const root = document.createElement('div');
    const page = new MePage(root, {
      search: '',
      fetch: async (url) => {
        if (url.includes('/v1/auth/refresh')) refreshCount += 1;
        return {
          ok: false,
          status: 401,
          json: async () => ({ errorCode: 'UNAUTHORIZED' }),
        };
      },
    });
    await page.load();

    const prompt = root.querySelector('[data-testid="me-auth-prompt"]');
    expect(prompt).not.toBeNull();
    expect(prompt?.textContent).toContain('Sign in or Sign up');
    expect(prompt?.querySelector('[data-testid="pilot-sign-in"]')?.textContent).toBe('Sign in / Sign up');
    expect(root.querySelector('[data-testid="me-error"]')).toBeNull();
    expect(refreshCount).toBe(1);
    window.localStorage.clear();
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

describe('/me NEAR.AI custom model ID selection & client-side validation', () => {
  it('supports saving, loading, and validating custom NEAR AI Cloud model IDs', async () => {
    const root = document.createElement('div');
    const profile = {
      ...makeW12ProfileFixture(),
      aiSettings: {
        hasApiKey: true,
        apiKeyPreview: 'sk-c••••7777',
        model: 'meta-llama/Llama-3.3-70B-Instruct',
        availableModels: ['z-ai/glm-5.3-flash', 'deepseek/deepseek-v3.2'],
      },
    };
    const achievements = makeW12AchievementsFixture();
    let putCalls = 0;
    let putBody: unknown = null;

    const page = new MePage(root, {
      search: '?as=w12',
      fetch: async (url, init) => {
        if (url.includes('/v1/me/ai-settings') && init?.method === 'PUT') {
          putCalls += 1;
          putBody = JSON.parse(String(init.body ?? '{}'));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hasApiKey: true,
              apiKeyPreview: 'sk-c••••7777',
              model: (putBody as { model: string }).model,
              availableModels: ['z-ai/glm-5.3-flash', 'deepseek/deepseek-v3.2'],
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
    const customInput = root.querySelector('[data-testid="me-ai-custom-model-input"]') as HTMLInputElement;
    const saveBtn = root.querySelector('[data-testid="me-ai-save-btn"]') as HTMLButtonElement;
    const statusNode = root.querySelector('[data-testid="me-ai-status"]') as HTMLElement;

    // Pre-existing custom model loads cleanly into the custom input with explicit id/for label pairing
    expect(modelSelect.id).toBe('me-ai-model-select');
    expect(customInput.id).toBe('me-ai-custom-model-input');
    expect(root.querySelector('label[for="me-ai-model-select"]')).not.toBeNull();
    expect(root.querySelector('label[for="me-ai-custom-model-input"]')).not.toBeNull();
    expect(root.querySelector('label[for="me-ai-key-input"]')).not.toBeNull();
    for (const lbl of root.querySelectorAll('label')) {
      expect(lbl.querySelectorAll('input, select, textarea, button').length).toBeLessThanOrEqual(1);
    }
    expect(statusNode.getAttribute('role')).toBe('status');
    expect(modelSelect.value).toBe('__custom__');
    expect(customInput.hidden).toBe(false);
    expect(customInput.value).toBe('meta-llama/Llama-3.3-70B-Instruct');

    // Empty or whitespace-containing custom model is rejected client-side without calling PUT
    customInput.value = '   ';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(putCalls).toBe(0);
    expect(customInput.getAttribute('aria-invalid')).toBe('true');
    expect(statusNode.textContent).toContain('Enter a valid custom NEAR.AI model ID');

    customInput.value = 'bad model id';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(putCalls).toBe(0);
    expect(customInput.getAttribute('aria-invalid')).toBe('true');

    // Valid custom model ID saves, clears aria-invalid, and stays selected
    customInput.value = 'mistralai/Mistral-Large-2411';
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(putCalls).toBe(1);
    expect(customInput.hasAttribute('aria-invalid')).toBe(false);
    expect(putBody).toEqual({ model: 'mistralai/Mistral-Large-2411' });
    expect(modelSelect.value).toBe('__custom__');
    expect(customInput.value).toBe('mistralai/Mistral-Large-2411');
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
    expect(root.querySelector('[data-testid="pilot-sign-out"]')?.textContent).toBe('Sign out');
  });

  it('ignores stale dev:* tokens in localStorage without ?as= and caches guest refresh JWTs for account upgrade', async () => {
    window.localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_dev_w12', accessToken: 'dev:w12', updatedAt: 1, isGuest: false }),
    );
    const guestJwt = 'header.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })) + '.sig';
    const root = document.createElement('div');
    let profileCalled = false;
    const page = new MePage(root, {
      search: '',
      fetch: async (url) => {
        if (url.includes('/v1/auth/refresh')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accessToken: guestJwt,
              player: { id: 'pr_guest_upgrade_1', handle: 'Guest', isGuest: true },
            }),
          };
        }
        profileCalled = true;
        return { ok: false, status: 401, json: async () => ({}) };
      },
    });
    await page.load();

    expect(profileCalled).toBe(false);
    expect(root.querySelector('[data-testid="me-auth-prompt"]')).not.toBeNull();
    const stored = JSON.parse(window.localStorage.getItem('ta_active_pilot') ?? '{}') as {
      playerId?: string;
      accessToken?: string;
      isGuest?: boolean;
    };
    expect(stored).toMatchObject({
      playerId: 'pr_guest_upgrade_1',
      accessToken: guestJwt,
      isGuest: true,
    });
    window.localStorage.clear();
  });
});
