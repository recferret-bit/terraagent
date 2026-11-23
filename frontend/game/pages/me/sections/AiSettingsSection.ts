import {
  DEFAULT_PLAYER_NEAR_AI_MODEL,
  NEAR_AI_AVAILABLE_MODELS,
  type MeProfileResponse,
  type PlayerAiSettings,
} from '@terra/contracts';
import { buildWavesQuerySuffix, resolveMeBearerToken, saveMeAiSettings, type MeFetchFn } from '../api';
import { verifyTeeAttestationClient, type TeeAttestationClientInput } from '../../../../design/pilot/teeVerifier';
import { el } from '../dom';
import { buildBlockHeaderWithTip } from '../parts/helpTip';

export interface AiSettingsController {
  syncStakerState(totalStakedNear: number): void;
}

export interface RenderAiSettingsOptions {
  readonly fetch?: MeFetchFn;
  readonly search?: string;
  readonly onReady?: (ctrl: AiSettingsController) => void;
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

async function runAiEnclaveProbe(refs: AiSettingsDomRefs, opts: RenderAiSettingsOptions): Promise<void> {
  refs.statusNode.textContent = 'Probing NEAR.AI TEE enclave attestation…';
  try {
    const rawSearch = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
    const token = resolveMeBearerToken(rawSearch);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await (opts.fetch ?? fetch)(`/v1/me/ai-settings/verify${buildWavesQuerySuffix(rawSearch)}`, {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      model?: string;
      managedStaker?: boolean;
      message?: string;
      attestation?: TeeAttestationClientInput | null;
    };
    if (!res.ok || body.ok === false) {
      refs.statusNode.textContent = body.message || 'TEE enclave attestation rejected.';
      return;
    }
    const att = body.attestation;
    if (!att) {
      refs.statusNode.textContent = `Probe OK (${body.model ?? 'NEAR.AI'}), no enclave attestation returned.`;
      return;
    }
    const check = await verifyTeeAttestationClient({ ...att, model: att.model ?? body.model });
    const modeTag = body.managedStaker ? ' · Staker Sponsored' : '';
    const verdict = check.valid ? 'TEE OK' : 'TEE FAILED';
    refs.statusNode.textContent =
      `${verdict} (${body.model ?? 'NEAR.AI'}${modeTag}): signer ${att.signingAddress ?? 'TEE'} · ` +
      `req ${(att.requestHash ?? '').slice(0, 12)}… · res ${(att.responseHash ?? '').slice(0, 12)}… · ` +
      `${check.browserVerified ? 'browserVerified=true' : `cryptoVerified=${String(att.cryptoVerified ?? false)}`}`;
  } catch {
    refs.statusNode.textContent = 'Unable to reach /v1/me/ai-settings/verify.';
  }
}

function wireAiSettingsHandlers(
  refs: AiSettingsDomRefs,
  opts: RenderAiSettingsOptions,
  mergeSettings: (next: PlayerAiSettings) => PlayerAiSettings = (n) => n,
): void {
  let inFlight = false;
  const runExclusive = async (fn: () => Promise<void>): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    for (const b of [refs.saveBtn, refs.clearBtn, refs.verifyBtn]) {
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
    }
    try {
      await fn();
    } finally {
      inFlight = false;
      for (const b of [refs.saveBtn, refs.clearBtn, refs.verifyBtn]) {
        b.disabled = false;
        b.removeAttribute('aria-busy');
      }
    }
  };

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
    void runExclusive(async () => {
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
      applyUpdatedSettings(refs, mergeSettings(out.settings), `Saved NEAR.AI model (${out.settings.model}).`);
    });
  });

  refs.clearBtn.addEventListener('click', () => {
    void runExclusive(async () => {
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
      applyUpdatedSettings(refs, mergeSettings(out.settings), 'Personal NEAR.AI key removed.');
    });
  });

  refs.verifyBtn.addEventListener('click', () => {
    void runExclusive(() => runAiEnclaveProbe(refs, opts));
  });
}

function buildAiInputs(models: readonly string[], selectedModel: string) {
  const modelSelect = createModelSelect(models, selectedModel);
  const customModelInput = el('input', {
    id: 'me-ai-custom-model-input',
    className: 'input ta-ai-input ta-ai-custom-input',
    type: 'text',
    dataset: { testid: 'me-ai-custom-model-input' },
  });
  customModelInput.placeholder = 'e.g. meta-llama/Llama-3.3-70B-Instruct';
  customModelInput.maxLength = 128;
  customModelInput.autocomplete = 'off';
  syncModelControls({ models, modelSelect, customModelInput }, selectedModel);

  const keyInput = el('input', {
    id: 'me-ai-key-input',
    className: 'input ta-ai-input',
    type: 'password',
    dataset: { testid: 'me-ai-key-input' },
  });
  keyInput.placeholder = 'Enter NEAR AI Cloud API key (leave blank to keep existing)';
  keyInput.autocomplete = 'off';
  return { modelSelect, customModelInput, keyInput };
}

export function renderAiSettingsSection(
  profile: MeProfileResponse,
  opts: RenderAiSettingsOptions = {},
): HTMLElement {
  const current = defaultSettings(profile);
  const models = current.availableModels.length > 0 ? current.availableModels : [...NEAR_AI_AVAILABLE_MODELS];
  const initialBadge = aiBadgeFor(current);

  const badge = el('span', { className: initialBadge.cls, dataset: { testid: 'me-ai-badge' } }, initialBadge.text);
  const previewNode = el('span', { className: 'ta-me-muted', dataset: { testid: 'me-ai-key-preview' } }, initialBadge.preview);
  const { modelSelect, customModelInput, keyInput } = buildAiInputs(models, current.model);
  const statusNode = el(
    'p',
    { className: 'ta-me-muted', role: 'status', aria: { live: 'polite' }, dataset: { testid: 'me-ai-status' } },
    'Staking ≥10 NEAR in Colony Staking unlocks server-sponsored Managed NEAR.AI Autopilot (z-ai/glm-5.3-flash) automatically. Prefer custom models (Claude, GPT-5, DeepSeek, or any custom NEAR AI Cloud model ID) or playing unstaked? Save your own encrypted BYOK NEAR AI Cloud key (https://cloud-api.near.ai/v1) below — AI remains bounded on-server and can never break truces, stake NEAR, or lock human funds.',
  );
  const saveBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'me-ai-save-btn' } }, 'Save NEAR.AI Config');
  const clearBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-clear-btn' } }, 'Disconnect Key');
  const verifyBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-verify-btn' } }, 'TEST & VERIFY TEE ENCLAVE');

  let latest: PlayerAiSettings = current;
  const domRefs: AiSettingsDomRefs = {
    models,
    badge,
    previewNode,
    modelSelect,
    customModelInput,
    keyInput,
    statusNode,
    saveBtn,
    clearBtn,
    verifyBtn,
  };
  wireAiSettingsHandlers(
    domRefs,
    opts,
    (next) => {
      latest = {
        ...next,
        stakerAutopilotActive: next.stakerAutopilotActive ?? latest.stakerAutopilotActive,
        stakedNear: next.stakedNear ?? latest.stakedNear,
      };
      return latest;
    },
  );
  opts.onReady?.({
    syncStakerState(totalStakedNear: number) {
      const clean = Math.max(0, Number.isFinite(totalStakedNear) ? totalStakedNear : 0);
      latest = {
        ...latest,
        stakerAutopilotActive: clean >= 10,
        stakedNear: clean.toFixed(6).replace(/\.?0+$/, '') || '0',
      };
      const b = aiBadgeFor(latest);
      badge.textContent = b.text;
      badge.className = b.cls;
      previewNode.textContent = b.preview;
    },
  });

  const header = buildBlockHeaderWithTip(
    {
      id: 'ai-settings',
      title: 'NEAR.AI BOT DECISION MANAGER',
      description:
        'Configure how your colony AI Autopilot runs: stake ≥10 NEAR for free protocol-sponsored Managed NEAR.AI TEE (glm-5.3-flash), or save your own AES-256-GCM encrypted NEAR AI Cloud API key to unlock Claude, GPT-5, DeepSeek, or custom models. AI is strictly bounded and can never stake NEAR or break treaties.',
    },
    el('span', { className: 'label c-orange' }, 'NEAR.AI BOT DECISION MANAGER'),
    badge,
  );

  return el(
    'div',
    { className: 'plate-sm ta-ai-settings', dataset: { testid: 'me-ai-settings' } },
    header.head,
    header.panel,
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
