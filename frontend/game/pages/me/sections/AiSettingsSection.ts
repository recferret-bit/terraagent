import {
  DEFAULT_PLAYER_NEAR_AI_MODEL,
  isValidNearAiApiKey,
  MANAGED_AI_MODEL,
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
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash (z-ai/glm-5.3-flash · Managed Default)',
  'z-ai/glm-5.3': 'GLM 5.3 (z-ai/glm-5.3)',
  'deepseek/deepseek-v3.2': 'DeepSeek V3.2 (deepseek/deepseek-v3.2)',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017': 'DeepSeek V4.1 Flash (deepseek-ai/DeepSeek-V4.1-Flash-1017)',
  'Qwen/Qwen3.8-27B': 'Qwen 3.8 27B (Qwen/Qwen3.8-27B)',
  'openai/gpt-5-mini': 'GPT-5 Mini (openai/gpt-5-mini)',
  'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6 (anthropic/claude-sonnet-4-6)',
};

function defaultSettings(profile: MeProfileResponse): PlayerAiSettings {
  const base =
    profile.aiSettings ?? {
      hasApiKey: false,
      apiKeyPreview: null,
      model: DEFAULT_PLAYER_NEAR_AI_MODEL,
      availableModels: [...NEAR_AI_AVAILABLE_MODELS],
    };
  if (!base.hasApiKey) {
    return { ...base, model: MANAGED_AI_MODEL };
  }
  return base;
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

export function isAiModelDropdownUnlocked(hasStoredKey: boolean, rawKeyInput: string): boolean {
  const typed = rawKeyInput.trim();
  if (typed.length > 0) return isValidNearAiApiKey(typed);
  return hasStoredKey;
}

interface AiSettingsDomRefs {
  readonly models: readonly string[];
  readonly badge: HTMLElement;
  readonly previewNode: HTMLElement;
  readonly modelSelect: HTMLSelectElement;
  readonly customModelInput: HTMLInputElement;
  readonly lockHintNode: HTMLElement;
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

function syncModelLockState(
  refs: Pick<AiSettingsDomRefs, 'models' | 'modelSelect' | 'customModelInput' | 'lockHintNode' | 'keyInput'>,
  settings: PlayerAiSettings,
  resetModelWhenLocked = true,
): boolean {
  const unlocked = isAiModelDropdownUnlocked(settings.hasApiKey, refs.keyInput.value);
  refs.modelSelect.disabled = !unlocked;
  if (unlocked) {
    refs.modelSelect.removeAttribute('aria-disabled');
    refs.customModelInput.disabled = false;
    refs.lockHintNode.textContent =
      'BYOK API key verified — select any preset or custom NEAR AI Cloud model.';
    return true;
  }
  refs.modelSelect.setAttribute('aria-disabled', 'true');
  refs.customModelInput.disabled = true;
  refs.customModelInput.hidden = true;
  if (resetModelWhenLocked) {
    syncModelControls(refs, MANAGED_AI_MODEL);
  }
  refs.lockHintNode.textContent = settings.stakerAutopilotActive
    ? 'Locked to Managed Default (GLM 5.3 Flash) — enter a valid BYOK API key to select other models.'
    : 'Model dropdown locked — enter a valid NEAR.AI API key (8+ chars) to unlock model selection.';
  return false;
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
      preview: `Managed NEAR.AI Autopilot (${MANAGED_AI_MODEL} · ${s.stakedNear ?? '10+'} NEAR staked)`,
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
  refs.keyInput.removeAttribute('aria-invalid');
  refs.keyInput.value = '';
  syncModelControls(refs, next.hasApiKey ? next.model : MANAGED_AI_MODEL);
  syncModelLockState(refs, next, !next.hasApiKey);
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
      refs.statusNode.textContent = `Probe OK (${body.model ?? MANAGED_AI_MODEL}), no enclave attestation returned.`;
      return;
    }
    const check = await verifyTeeAttestationClient({ ...att, model: att.model ?? body.model });
    const modeTag = body.managedStaker ? ' · Staker Sponsored' : '';
    const verdict = check.valid ? 'TEE OK' : 'TEE FAILED';
    refs.statusNode.textContent =
      `${verdict} (${body.model ?? MANAGED_AI_MODEL}${modeTag}): signer ${att.signingAddress ?? 'TEE'} · ` +
      `req ${(att.requestHash ?? '').slice(0, 12)}… · res ${(att.responseHash ?? '').slice(0, 12)}… · ` +
      `${check.browserVerified ? 'browserVerified=true' : `cryptoVerified=${String(att.cryptoVerified ?? false)}`}`;
  } catch {
    refs.statusNode.textContent = 'Unable to reach /v1/me/ai-settings/verify.';
  }
}

async function handleSaveAiSettings(
  refs: AiSettingsDomRefs,
  opts: RenderAiSettingsOptions,
  getLatest: () => PlayerAiSettings,
  mergeSettings: (next: PlayerAiSettings) => PlayerAiSettings,
): Promise<void> {
  const latest = getLatest();
  const typedKey = refs.keyInput.value.trim();
  if (typedKey.length > 0 && !isValidNearAiApiKey(typedKey)) {
    refs.keyInput.setAttribute('aria-invalid', 'true');
    syncModelLockState(refs, latest, !latest.hasApiKey);
    refs.statusNode.textContent = 'Enter a valid NEAR.AI API key (8–256 printable non-space characters) to unlock model selection.';
    return;
  }
  if (typedKey.length === 0 && !latest.hasApiKey) {
    refs.keyInput.setAttribute('aria-invalid', 'true');
    syncModelLockState(refs, latest, true);
    refs.statusNode.textContent = 'Enter a valid NEAR.AI API key before saving or changing models (stakers automatically run Managed GLM 5.3 Flash).';
    return;
  }
  refs.keyInput.removeAttribute('aria-invalid');
  syncModelLockState(refs, latest, false);
  const chosenModel = resolveChosenModel(refs);
  if (!chosenModel) {
    refs.customModelInput.setAttribute('aria-invalid', 'true');
    refs.statusNode.textContent = 'Enter a valid custom NEAR.AI model ID (no spaces) or choose a preset model.';
    return;
  }
  refs.customModelInput.removeAttribute('aria-invalid');
  const payload = { model: chosenModel, ...(typedKey.length > 0 ? { apiKey: typedKey } : {}) };
  refs.statusNode.textContent = 'Saving NEAR.AI configuration…';
  const out = await saveMeAiSettings(payload, opts.fetch, opts.search);
  if (!out.ok) {
    refs.statusNode.textContent = out.message;
    return;
  }
  applyUpdatedSettings(refs, mergeSettings(out.settings), `Saved NEAR.AI model (${out.settings.model}).`);
}

function wireAiSettingsHandlers(
  refs: AiSettingsDomRefs,
  opts: RenderAiSettingsOptions,
  getLatest: () => PlayerAiSettings,
  mergeSettings: (next: PlayerAiSettings) => PlayerAiSettings,
): void {
  let inFlight = false;
  const runExclusive = async (fn: () => Promise<void>): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    for (const b of [refs.saveBtn, refs.clearBtn, refs.verifyBtn]) { b.disabled = true; b.setAttribute('aria-busy', 'true'); }
    try { await fn(); } finally {
      inFlight = false;
      for (const b of [refs.saveBtn, refs.clearBtn, refs.verifyBtn]) { b.disabled = false; b.removeAttribute('aria-busy'); }
    }
  };
  refs.modelSelect.addEventListener('change', () => {
    if (refs.modelSelect.disabled) return;
    const isCustom = refs.modelSelect.value === CUSTOM_MODEL_OPTION;
    refs.customModelInput.hidden = !isCustom;
    refs.customModelInput.removeAttribute('aria-invalid');
    if (isCustom) refs.customModelInput.focus();
  });
  refs.customModelInput.addEventListener('input', () => refs.customModelInput.removeAttribute('aria-invalid'));
  refs.keyInput.addEventListener('input', () => {
    refs.keyInput.removeAttribute('aria-invalid');
    const latest = getLatest();
    const unlocked = syncModelLockState(refs, latest, !latest.hasApiKey);
    if (unlocked && refs.modelSelect.value === CUSTOM_MODEL_OPTION) refs.customModelInput.hidden = false;
  });
  refs.saveBtn.addEventListener('click', () => { void runExclusive(() => handleSaveAiSettings(refs, opts, getLatest, mergeSettings)); });
  refs.clearBtn.addEventListener('click', () => {
    void runExclusive(async () => {
      refs.statusNode.textContent = 'Clearing NEAR.AI API key…';
      const out = await saveMeAiSettings({ model: MANAGED_AI_MODEL, apiKey: null }, opts.fetch, opts.search);
      if (!out.ok) { refs.statusNode.textContent = out.message; return; }
      applyUpdatedSettings(refs, mergeSettings(out.settings), 'Personal NEAR.AI key removed.');
    });
  });
  refs.verifyBtn.addEventListener('click', () => { void runExclusive(() => runAiEnclaveProbe(refs, opts)); });
}

function buildAiInputs(models: readonly string[], current: PlayerAiSettings) {
  const initialModel = current.hasApiKey ? current.model : MANAGED_AI_MODEL;
  const modelSelect = createModelSelect(models, initialModel);
  const customModelInput = el('input', {
    id: 'me-ai-custom-model-input',
    className: 'input ta-ai-input ta-ai-custom-input',
    type: 'text',
    dataset: { testid: 'me-ai-custom-model-input' },
  });
  customModelInput.placeholder = 'e.g. meta-llama/Llama-3.3-70B-Instruct';
  customModelInput.maxLength = 128;
  customModelInput.autocomplete = 'off';
  syncModelControls({ models, modelSelect, customModelInput }, initialModel);

  const lockHintNode = el('span', {
    className: 'ta-ai-lock-hint',
    dataset: { testid: 'me-ai-model-lock-hint' },
  });

  const keyInput = el('input', {
    id: 'me-ai-key-input',
    className: 'input ta-ai-input',
    type: 'password',
    dataset: { testid: 'me-ai-key-input' },
  });
  keyInput.placeholder = current.hasApiKey
    ? 'Enter new NEAR AI Cloud API key (leave blank to keep existing)'
    : 'Enter valid NEAR AI Cloud API key to unlock model dropdown';
  keyInput.autocomplete = 'off';
  return { modelSelect, customModelInput, lockHintNode, keyInput };
}

function buildAiSettingsPlate(refs: AiSettingsDomRefs): HTMLElement {
  const header = buildBlockHeaderWithTip(
    {
      id: 'ai-settings',
      title: 'NEAR.AI BOT DECISION MANAGER',
      description:
        'Configure how your colony AI Autopilot runs: stake ≥10 NEAR for protocol-sponsored Managed NEAR.AI TEE running exclusively on GLM 5.3 Flash (z-ai/glm-5.3-flash), or enter a valid AES-256-GCM encrypted BYOK NEAR AI Cloud API key to unlock the model dropdown (Claude, GPT-5, DeepSeek, or custom models).',
    },
    el('span', { className: 'label c-orange' }, 'NEAR.AI BOT DECISION MANAGER'),
    refs.badge,
  );
  return el(
    'div',
    { className: 'plate-sm ta-ai-settings', dataset: { testid: 'me-ai-settings' } },
    header.head,
    header.panel,
    refs.statusNode,
    el(
      'div',
      { className: 'ta-ai-controls' },
      el(
        'div',
        { className: 'ta-ai-field' },
        makeFieldLabel('me-ai-model-select', 'NEAR.AI MODEL'),
        refs.modelSelect,
        makeFieldLabel('me-ai-custom-model-input', 'Custom NEAR.AI Model ID', 'sr-only'),
        refs.customModelInput,
        refs.lockHintNode,
      ),
      el('div', { className: 'ta-ai-field' }, makeFieldLabel('me-ai-key-input', 'NEAR.AI API KEY'), refs.keyInput),
    ),
    el('div', { className: 'ta-colony-head' }, refs.previewNode, el('div', { className: 'ta-ai-actions' }, refs.verifyBtn, refs.saveBtn, refs.clearBtn)),
  );
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
  const { modelSelect, customModelInput, lockHintNode, keyInput } = buildAiInputs(models, current);
  const statusNode = el(
    'p',
    { className: 'ta-me-muted', role: 'status', aria: { live: 'polite' }, dataset: { testid: 'me-ai-status' } },
    'Staking ≥10 NEAR in Colony Staking unlocks protocol-sponsored Managed NEAR.AI Autopilot exclusively on GLM 5.3 Flash (z-ai/glm-5.3-flash). To unlock custom model selection (Claude, GPT-5, DeepSeek, Qwen, or custom NEAR AI Cloud IDs), enter a valid BYOK NEAR AI Cloud API key below.',
  );
  const saveBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'button', dataset: { testid: 'me-ai-save-btn' } }, 'Save NEAR.AI Config');
  const clearBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-clear-btn' } }, 'Disconnect Key');
  const verifyBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-ai-verify-btn' } }, 'TEST & VERIFY TEE ENCLAVE');

  let latest: PlayerAiSettings = current;
  const domRefs: AiSettingsDomRefs = { models, badge, previewNode, modelSelect, customModelInput, lockHintNode, keyInput, statusNode, saveBtn, clearBtn, verifyBtn };
  syncModelLockState(domRefs, latest, !latest.hasApiKey);

  wireAiSettingsHandlers(domRefs, opts, () => latest, (next) => {
    const stakerActive = next.stakerAutopilotActive ?? latest.stakerAutopilotActive;
    latest = { ...next, model: next.hasApiKey ? next.model : MANAGED_AI_MODEL, stakerAutopilotActive: stakerActive, stakedNear: next.stakedNear ?? latest.stakedNear };
    return latest;
  });
  opts.onReady?.({
    syncStakerState(totalStakedNear: number) {
      const clean = Math.max(0, Number.isFinite(totalStakedNear) ? totalStakedNear : 0);
      const stakerActive = clean >= 10;
      latest = { ...latest, model: latest.hasApiKey ? latest.model : MANAGED_AI_MODEL, stakerAutopilotActive: stakerActive, stakedNear: clean.toFixed(6).replace(/\.?0+$/, '') || '0' };
      const b = aiBadgeFor(latest);
      badge.textContent = b.text;
      badge.className = b.cls;
      previewNode.textContent = b.preview;
      syncModelLockState(domRefs, latest, !latest.hasApiKey);
    },
  });
  return buildAiSettingsPlate(domRefs);
}
