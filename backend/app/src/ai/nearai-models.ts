export const DEFAULT_NEAR_AI_BASE = 'https://cloud-api.near.ai/v1';
export const DEFAULT_NEAR_AI_MODEL = 'z-ai/glm-5.3-flash';

export const NEAR_AI_MODELS = [
  'z-ai/glm-5.3-flash',
  'z-ai/glm-5.3',
  'deepseek/deepseek-v3.2',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  'Qwen/Qwen3.8-27B',
  'openai/gpt-5-mini',
  'anthropic/claude-sonnet-4-6',
] as const;

export function normalizeNearAiModel(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_NEAR_AI_MODEL;
  const lower = trimmed.toLowerCase();
  if (lower === 'glm-5' || lower === 'glm-5.3' || lower === 'z-ai/glm-5') {
    return 'z-ai/glm-5.3';
  }
  if (lower === 'glm-5-flash' || lower === 'glm-5.3-flash') {
    return 'z-ai/glm-5.3-flash';
  }
  return trimmed;
}
