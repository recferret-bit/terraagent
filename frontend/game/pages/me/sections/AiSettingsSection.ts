import {
  DEFAULT_PLAYER_NEAR_AI_MODEL,
  NEAR_AI_AVAILABLE_MODELS,
  type MeProfileResponse,
  type PlayerAiSettings,
} from '@terra/contracts';
import { saveMeAiSettings, type MeFetchFn } from '../api';
import { el } from '../dom';

export interface RenderAiSettingsOptions {
  readonly fetch?: MeFetchFn;
  readonly search?: string;
}

const MODEL_LABELS: Readonly<Record<string, string>> = {
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash (z-ai/glm-5.3-flash · Default)',
  'z-ai/glm-5.3': 'GLM 5.3 (z-ai/glm-5.3)',
  'deepseek/deepseek-v3.2': 'DeepSeek V3.2 (deepseek/deepseek-v3.2)',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017': 'DeepSeek V4.1 Flash (deepseek-ai/DeepSeek-V4.1-Flash-1017)',
  'Qwen/Qwen3.8-27B': 'Qwen 3.8 27B (Qwen/Qwen3.8-27B)',
  'openai/gpt-5-mini': 'GPT-5 Mini (openai/gpt-5-mini)',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6)',
};

function defaultSettings(profile: MeProfileResponse): PlayerAiSettings {
  return (
    profile.aiSettings ?? {
      hasApiKey: false,
      apiKeyPreview: null,
      model: DEFAULT_PLAYER_NEAR_AI_MODEL,
      availableModels: [...NEAR_AI_AVAILABLE_MODELS],
    }
  );
}

function createModelSelect(models: readonly string[], selectedModel: string): HTMLSelectElement {
  const select = el('select', {
    className: 'input ta-ai-select',
    dataset: { testid: 'me-ai-model-select' },
    aria: { label: 'NEAR.AI Model' },
  }) as HTMLSelectElement;
  for (const modelId of models) {
    const opt = document.createElement('option');
    opt.value = modelId;
    opt.textContent = MODEL_LABELS[modelId] ?? modelId;
    if (modelId === selectedModel) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

interface AiSettingsDomRefs {
  readonly badge: HTMLElement;
  readonly previewNode: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly keyInput: HTMLInputElement;
  readonly statusNode: HTMLElement;
  readonly saveBtn: HTMLButtonElement;
  readonly clearBtn: HTMLButtonElement;
}

function applyUpdatedSettings(refs: AiSettingsDomRefs, next: PlayerAiSettings, message: string): void {
  refs.badge.textContent = next.hasApiKey ? 'NEAR.AI CONNECTED' : 'DETERMINISTIC FALLBACK';
  refs.badge.className = `badge ${next.hasApiKey ? 'badge-blue' : ''}`;
  refs.previewNode.textContent =
    next.hasApiKey && next.apiKeyPreview
      ? `Stored key: ${next.apiKeyPreview}`
      : 'No personal NEAR.AI key stored';
  refs.modelSelect.value = next.model;
  refs.keyInput.value = '';
  refs.statusNode.textContent = message;
}

function wireAiSettingsHandlers(refs: AiSettingsDomRefs, opts: RenderAiSettingsOptions): void {
  refs.saveBtn.addEventListener('click', () => {
    void (async () => {
      const typedKey = refs.keyInput.value.trim();
      const payload = {
        model: refs.modelSelect.value || DEFAULT_PLAYER_NEAR_AI_MODEL,
        ...(typedKey.length > 0 ? { apiKey: typedKey } : {}),
      };
      refs.statusNode.textContent = 'Saving NEAR.AI configuration…';
      const out = await saveMeAiSettings(payload, opts.fetch, opts.search);
      if (!out.ok) {
        refs.statusNode.textContent = out.message;
        return;
      }
      applyUpdatedSettings(refs, out.settings, `Saved NEAR.AI model (${out.settings.model}).`);
    })();
  });

  refs.clearBtn.addEventListener('click', () => {
    void (async () => {
      refs.statusNode.textContent = 'Clearing NEAR.AI API key…';
      const out = await saveMeAiSettings(
        { model: refs.modelSelect.value || DEFAULT_PLAYER_NEAR_AI_MODEL, apiKey: null },
        opts.fetch,
        opts.search,
      );
      if (!out.ok) {
        refs.statusNode.textContent = out.message;
        return;
      }
      applyUpdatedSettings(refs, out.settings, 'Personal NEAR.AI key removed.');
    })();
  });
}

export function renderAiSettingsSection(
  profile: MeProfileResponse,
  opts: RenderAiSettingsOptions = {},
): HTMLElement {
  const current = defaultSettings(profile);
  const models = current.availableModels.length > 0 ? current.availableModels : [...NEAR_AI_AVAILABLE_MODELS];

  const badge = el(
    'span',
    {
      className: `badge ${current.hasApiKey ? 'badge-blue' : ''}`,
      dataset: { testid: 'me-ai-badge' },
    },
    current.hasApiKey ? 'NEAR.AI CONNECTED' : 'DETERMINISTIC FALLBACK',
  );
  const previewNode = el(
    'span',
    { className: 'ta-me-muted', dataset: { testid: 'me-ai-key-preview' } },
    current.hasApiKey && current.apiKeyPreview
      ? `Stored key: ${current.apiKeyPreview}`
      : 'No personal NEAR.AI key stored',
  );
  const modelSelect = createModelSelect(models, current.model);
  const keyInput = el('input', {
    className: 'input ta-ai-input',
    type: 'password',
    dataset: { testid: 'me-ai-key-input' },
  });
  keyInput.placeholder = 'Enter NEAR AI Cloud API key (leave blank to keep existing)';
  keyInput.autocomplete = 'off';
  const statusNode = el(
    'p',
    { className: 'ta-me-muted', dataset: { testid: 'me-ai-status' } },
    'Staking ≥10 NEAR in Colony Staking unlocks server-sponsored Managed NEAR.AI Autopilot (z-ai/glm-5.3-flash) automatically. Prefer custom models (Claude, GPT-5, DeepSeek) or playing unstaked? Save your own encrypted BYOK NEAR AI Cloud key (https://cloud-api.near.ai/v1) below — AI remains bounded (AW-13: cannot break truces or lock human NEAR).',
  );
  const saveBtn = el(
    'button',
    { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'me-ai-save-btn' } },
    'Save NEAR.AI Config',
  );
  const clearBtn = el(
    'button',
    { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-clear-btn' } },
    'Disconnect Key',
  );

  wireAiSettingsHandlers({ badge, previewNode, modelSelect, keyInput, statusNode, saveBtn, clearBtn }, opts);

  return el(
    'div',
    { className: 'plate-sm ta-ai-settings', dataset: { testid: 'me-ai-settings' } },
    el('div', { className: 'ta-colony-head' }, el('span', { className: 'label c-orange' }, 'NEAR.AI BOT DECISION MANAGER'), badge),
    statusNode,
    el(
      'div',
      { className: 'ta-ai-controls' },
      el('label', { className: 'ta-ai-field' }, el('span', { className: 'label' }, 'NEAR.AI MODEL'), modelSelect),
      el('label', { className: 'ta-ai-field' }, el('span', { className: 'label' }, 'NEAR.AI API KEY'), keyInput),
    ),
    el('div', { className: 'ta-colony-head' }, previewNode, el('div', { className: 'ta-ai-actions' }, saveBtn, clearBtn)),
  );
}
