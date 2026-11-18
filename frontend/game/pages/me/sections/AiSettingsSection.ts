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

const CUSTOM_MODEL_OPTION = '__custom__';

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
    id: 'me-ai-model-select',
    className: 'input ta-ai-select',
    dataset: { testid: 'me-ai-model-select' },
  }) as HTMLSelectElement;
  const isPreset = models.includes(selectedModel);
  for (const modelId of models) {
    const opt = document.createElement('option');
    opt.value = modelId;
    opt.textContent = MODEL_LABELS[modelId] ?? modelId;
    if (modelId === selectedModel) opt.selected = true;
    select.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_MODEL_OPTION;
  customOpt.textContent = 'Custom NEAR AI Cloud model ID…';
  if (!isPreset && selectedModel.length > 0) customOpt.selected = true;
  select.appendChild(customOpt);
  return select;
}

function makeFieldLabel(forId: string, text: string, className = 'label'): HTMLLabelElement {
  const lbl = el('label', { className }, text);
  lbl.htmlFor = forId;
  return lbl;
}

interface AiSettingsDomRefs {
  readonly models: readonly string[];
  readonly badge: HTMLElement;
  readonly previewNode: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly customModelInput: HTMLInputElement;
  readonly keyInput: HTMLInputElement;
  readonly statusNode: HTMLElement;
  readonly saveBtn: HTMLButtonElement;
  readonly clearBtn: HTMLButtonElement;
  readonly verifyBtn: HTMLButtonElement;
}

function syncModelControls(refs: Pick<AiSettingsDomRefs, 'models' | 'modelSelect' | 'customModelInput'>, modelId: string): void {
  if (refs.models.includes(modelId)) {
    refs.modelSelect.value = modelId;
    refs.customModelInput.hidden = true;
    refs.customModelInput.value = '';
  } else {
    refs.modelSelect.value = CUSTOM_MODEL_OPTION;
    refs.customModelInput.hidden = false;
    refs.customModelInput.value = modelId;
  }
}

function resolveChosenModel(refs: Pick<AiSettingsDomRefs, 'modelSelect' | 'customModelInput'>): string | null {
  if (refs.modelSelect.value === CUSTOM_MODEL_OPTION) {
    const trimmed = refs.customModelInput.value.trim();
    if (trimmed.length === 0 || trimmed === CUSTOM_MODEL_OPTION || !/^[!-~]+$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }
  return refs.modelSelect.value || DEFAULT_PLAYER_NEAR_AI_MODEL;
}

function aiBadgeFor(s: PlayerAiSettings): { text: string; cls: string; preview: string } {
  if (s.hasApiKey) {
    return {
      text: 'NEAR.AI CONNECTED',
      cls: 'badge badge-blue',
      preview: s.apiKeyPreview ? `Stored key: ${s.apiKeyPreview}` : 'Personal NEAR.AI key stored',
    };
  }
  if (s.stakerAutopilotActive) {
    return {
      text: 'MANAGED STAKER AI ACTIVE',
      cls: 'badge badge-orange',
      preview: `Managed NEAR.AI Autopilot unlocked (${s.stakedNear ?? '10+'} NEAR staked)`,
    };
  }
  return { text: 'DETERMINISTIC FALLBACK', cls: 'badge', preview: 'No personal NEAR.AI key stored' };
}

function applyUpdatedSettings(refs: AiSettingsDomRefs, next: PlayerAiSettings, message: string): void {
  const b = aiBadgeFor(next);
  refs.badge.textContent = b.text;
  refs.badge.className = b.cls;
  refs.previewNode.textContent = b.preview;
  refs.customModelInput.removeAttribute('aria-invalid');
  syncModelControls(refs, next.model);
  refs.keyInput.value = '';
  refs.statusNode.textContent = message;
}

function wireAiSettingsHandlers(refs: AiSettingsDomRefs, opts: RenderAiSettingsOptions): void {
  refs.modelSelect.addEventListener('change', () => {
    const isCustom = refs.modelSelect.value === CUSTOM_MODEL_OPTION;
    refs.customModelInput.hidden = !isCustom;
    refs.customModelInput.removeAttribute('aria-invalid');
    if (isCustom) refs.customModelInput.focus();
  });

  refs.customModelInput.addEventListener('input', () => {
    refs.customModelInput.removeAttribute('aria-invalid');
  });

  refs.saveBtn.addEventListener('click', () => {
    void (async () => {
      const chosenModel = resolveChosenModel(refs);
      if (!chosenModel) {
        refs.customModelInput.setAttribute('aria-invalid', 'true');
        refs.statusNode.textContent =
          'Enter a valid custom NEAR.AI model ID (no spaces) or choose a preset model.';
        return;
      }
      refs.customModelInput.removeAttribute('aria-invalid');
      const typedKey = refs.keyInput.value.trim();
      const payload = {
        model: chosenModel,
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
      const chosenModel = resolveChosenModel(refs) ?? DEFAULT_PLAYER_NEAR_AI_MODEL;
      refs.statusNode.textContent = 'Clearing NEAR.AI API key…';
      const out = await saveMeAiSettings(
        { model: chosenModel, apiKey: null },
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

  refs.verifyBtn.addEventListener('click', () => {
    void (async () => {
      refs.statusNode.textContent = 'Probing NEAR.AI TEE enclave attestation…';
      try {
        const res = await (opts.fetch ?? fetch)(`/v1/me/ai-settings/verify${opts.search ?? ''}`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as {
          model?: string;
          managedStaker?: boolean;
          message?: string;
          attestation?: { signingAddress?: string; requestHash?: string; responseHash?: string; cryptoVerified?: boolean } | null;
        };
        if (!res.ok) {
          refs.statusNode.textContent = body.message || 'TEE probe rejected.';
          return;
        }
        const att = body.attestation;
        refs.statusNode.textContent = att
          ? `TEE OK (${body.model ?? 'NEAR.AI'}${body.managedStaker ? ' · Staker Sponsored' : ''}): signer ${att.signingAddress ?? 'TEE'} · req ${(att.requestHash ?? '').slice(0, 12)}… · res ${(att.responseHash ?? '').slice(0, 12)}… · cryptoVerified=${String(att.cryptoVerified ?? false)}`
          : `Probe OK (${body.model ?? 'NEAR.AI'}), no enclave attestation returned.`;
      } catch {
        refs.statusNode.textContent = 'Unable to reach /v1/me/ai-settings/verify.';
      }
    })();
  });
}

export function renderAiSettingsSection(
  profile: MeProfileResponse,
  opts: RenderAiSettingsOptions = {},
): HTMLElement {
  const current = defaultSettings(profile);
  const models = current.availableModels.length > 0 ? current.availableModels : [...NEAR_AI_AVAILABLE_MODELS];
  const initialBadge = aiBadgeFor(current);

  const badge = el(
    'span',
    {
      className: initialBadge.cls,
      dataset: { testid: 'me-ai-badge' },
    },
    initialBadge.text,
  );
  const previewNode = el(
    'span',
    { className: 'ta-me-muted', dataset: { testid: 'me-ai-key-preview' } },
    initialBadge.preview,
  );
  const modelSelect = createModelSelect(models, current.model);
  const customModelInput = el('input', {
    id: 'me-ai-custom-model-input',
    className: 'input ta-ai-input ta-ai-custom-input',
    type: 'text',
    dataset: { testid: 'me-ai-custom-model-input' },
  });
  customModelInput.placeholder = 'e.g. meta-llama/Llama-3.3-70B-Instruct';
  customModelInput.maxLength = 128;
  customModelInput.autocomplete = 'off';
  syncModelControls({ models, modelSelect, customModelInput }, current.model);

  const keyInput = el('input', {
    id: 'me-ai-key-input',
    className: 'input ta-ai-input',
    type: 'password',
    dataset: { testid: 'me-ai-key-input' },
  });
  keyInput.placeholder = 'Enter NEAR AI Cloud API key (leave blank to keep existing)';
  keyInput.autocomplete = 'off';
  const statusNode = el(
    'p',
    {
      className: 'ta-me-muted',
      role: 'status',
      aria: { live: 'polite' },
      dataset: { testid: 'me-ai-status' },
    },
    'Staking ≥10 NEAR in Colony Staking unlocks server-sponsored Managed NEAR.AI Autopilot (z-ai/glm-5.3-flash) automatically. Prefer custom models (Claude, GPT-5, DeepSeek, or any custom NEAR AI Cloud model ID) or playing unstaked? Save your own encrypted BYOK NEAR AI Cloud key (https://cloud-api.near.ai/v1) below — AI remains bounded on-server and can never break truces, stake NEAR, or lock human funds.',
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

  const verifyBtn = el(
    'button',
    { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-verify-btn' } },
    'TEST & VERIFY TEE ENCLAVE',
  );

  wireAiSettingsHandlers(
    { models, badge, previewNode, modelSelect, customModelInput, keyInput, statusNode, saveBtn, clearBtn, verifyBtn },
    opts,
  );

  return el(
    'div',
    { className: 'plate-sm ta-ai-settings', dataset: { testid: 'me-ai-settings' } },
    el('div', { className: 'ta-colony-head' }, el('span', { className: 'label c-orange' }, 'NEAR.AI BOT DECISION MANAGER'), badge),
    statusNode,
    el(
      'div',
      { className: 'ta-ai-controls' },
      el(
        'div',
        { className: 'ta-ai-field' },
        makeFieldLabel('me-ai-model-select', 'NEAR.AI MODEL'),
        modelSelect,
        makeFieldLabel('me-ai-custom-model-input', 'Custom NEAR.AI Model ID', 'sr-only'),
        customModelInput,
      ),
      el('div', { className: 'ta-ai-field' }, makeFieldLabel('me-ai-key-input', 'NEAR.AI API KEY'), keyInput),
    ),
    el('div', { className: 'ta-colony-head' }, previewNode, el('div', { className: 'ta-ai-actions' }, verifyBtn, saveBtn, clearBtn)),
  );
}
