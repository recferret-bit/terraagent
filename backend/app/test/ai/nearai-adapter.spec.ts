import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEAR_AI_MODEL,
  NEAR_AI_KEY_MISSING,
  NEAR_AI_MODELS,
  NearAiLlmAdapter,
  nearAiKey,
  normalizeNearAiModel,
  sha256Hex,
  usageFrom,
  verifySignatureHashes,
  type FetchLike,
} from '../../src/ai/adapters/nearai-llm.adapter.js';

describe('NEAR AI Cloud LLM adapter & TEE attestation', () => {
  it('defaults to z-ai/glm-5.3-flash on NEAR AI Cloud and normalizes GLM-5 aliases', () => {
    expect(DEFAULT_NEAR_AI_MODEL).toBe('z-ai/glm-5.3-flash');
    expect(NEAR_AI_MODELS).toContain('z-ai/glm-5.3-flash');
    expect(NEAR_AI_MODELS).toContain('z-ai/glm-5.3');
    expect(normalizeNearAiModel(undefined)).toBe('z-ai/glm-5.3-flash');
    expect(normalizeNearAiModel('glm-5')).toBe('z-ai/glm-5.3');
    expect(normalizeNearAiModel('glm-5.3')).toBe('z-ai/glm-5.3');
    expect(normalizeNearAiModel('glm-5-flash')).toBe('z-ai/glm-5.3-flash');
    expect(normalizeNearAiModel('glm-5.3-flash')).toBe('z-ai/glm-5.3-flash');
    expect(normalizeNearAiModel('deepseek/deepseek-v3.2')).toBe('deepseek/deepseek-v3.2');
    expect(usageFrom({ inputTokens: 3, outputTokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(() => usageFrom(undefined)).toThrow(/usage missing/);
  });

  it('refuses to start without NEAR_AI_API_KEY and never leaks sibling secrets', async () => {
    const secret = 'sk-do-not-leak-me';
    expect(() => nearAiKey({})).toThrow(NEAR_AI_KEY_MISSING);
    expect(nearAiKey({ NEARAI_API_KEY: 'nearai-alias-key' })).toBe('nearai-alias-key');
    await expect(
      new NearAiLlmAdapter().complete(
        { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 16 },
        { OTHER_KEY: secret },
      ),
    ).rejects.toThrow(NEAR_AI_KEY_MISSING);
  });

  it('completes via OpenAI-compatible endpoint and verifies provider_tee hash-bound signature', async () => {
    let capturedReqBody = '';
    const completionPayload = JSON.stringify({
      id: 'chatcmpl_tee_1',
      model: DEFAULT_NEAR_AI_MODEL,
      choices: [{ message: { content: '{"goal":"terraform_zone"}' } }],
      usage: { prompt_tokens: 42, completion_tokens: 11 },
    });
    const respHash = sha256Hex(completionPayload);

    const fakeFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        capturedReqBody = String(init?.body ?? '');
        return new Response(completionPayload, { status: 200 });
      }
      if (url.includes('/signature/chatcmpl_tee_1')) {
        const reqHash = sha256Hex(capturedReqBody);
        return new Response(
          JSON.stringify({
            text: `${DEFAULT_NEAR_AI_MODEL}:${reqHash}:${respHash}`,
            signature: '0xdeadbeef01',
            signing_address: '0x1111222233334444555566667777888899990000',
            signing_algo: 'ecdsa',
            signature_kind: 'provider_tee',
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const res = await new NearAiLlmAdapter(fakeFetch).complete(
      { system: 'You are Colony AI.', messages: [{ role: 'user', content: 'status' }], maxTokens: 64, json: true },
      { NEAR_AI_API_KEY: 'near-test-key' },
    );
    expect(res.text).toBe('{"goal":"terraform_zone"}');
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 11 });
    expect(res.attestation?.verified).toBe(true);
    expect(res.attestation?.signatureKind).toBe('provider_tee');
    expect(res.attestation?.signingAddress).toBe('0x1111222233334444555566667777888899990000');
  });
});

describe('NEAR AI Cloud signature retry & per-request player overrides', () => {
  it('retries transient 404 on TEE node signature lookup and degrades gracefully if unavailable', async () => {
    let sigCalls = 0;
    const completionPayload = JSON.stringify({
      id: 'chatcmpl_tee_2',
      model: DEFAULT_NEAR_AI_MODEL,
      choices: [{ message: { content: 'pong' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });
    const fakeFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) return new Response(completionPayload, { status: 200 });
      sigCalls += 1;
      return new Response('Chat id not found or expired', { status: 404 });
    };

    const res = await new NearAiLlmAdapter(fakeFetch).complete(
      { system: 's', messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 },
      { NEAR_AI_API_KEY: 'near-test-key' },
    );
    expect(res.text).toBe('pong');
    expect(sigCalls).toBe(2);
    expect(res.attestation?.verified).toBe(false);
    expect(res.attestation?.chatId).toBe('chatcmpl_tee_2');
  });

  it('rejects tampered signature hash payloads in verifySignatureHashes', () => {
    const ok = verifySignatureHashes(
      { text: 'reqH:resH', signature: '0xabc', signing_address: '0xdef', signature_kind: 'gateway' },
      'm1',
      'reqH',
      'resH',
    );
    expect(ok).toEqual({ verified: true, kind: 'gateway' });

    const bad = verifySignatureHashes(
      { text: 'm1:wrongReq:resH', signature: '0xabc', signing_address: '0xdef' },
      'm1',
      'reqH',
      'resH',
    );
    expect(bad.verified).toBe(false);
  });

  it('supports per-request player API key and custom NEAR.AI model overrides', async () => {
    let capturedAuth = '';
    let capturedModel = '';
    const fakeFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/chat/completions')) {
        const headers = init?.headers as Record<string, string>;
        capturedAuth = headers?.Authorization ?? '';
        const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        capturedModel = body.model ?? '';
        return new Response(
          JSON.stringify({
            id: 'chatcmpl_player_1',
            model: capturedModel,
            choices: [{ message: { content: '{"action":"hold"}' } }],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const res = await new NearAiLlmAdapter(fakeFetch).complete(
      {
        system: 'sys',
        messages: [{ role: 'user', content: 'obs' }],
        maxTokens: 32,
        apiKey: 'player-nearai-key-999',
        model: 'deepseek/deepseek-v3.2',
      },
      { NEAR_AI_ATTEST: '0' },
    );
    expect(capturedAuth).toBe('Bearer player-nearai-key-999');
    expect(capturedModel).toBe('deepseek/deepseek-v3.2');
    expect(res.model).toBe('deepseek/deepseek-v3.2');
    expect(res.text).toBe('{"action":"hold"}');
  });
});

describe('NEAR AI Cloud GLM-5 reasoning control & APP_ENV fallback', () => {
  it('sets reasoning_effort=low for z-ai/glm-5* unless NEAR_AI_THINKING=1 and reads injected defaultEnv', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let capturedAuth = '';
    const fakeFetch: FetchLike = async (_input, init) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_glm_1',
          model: 'z-ai/glm-5.3-flash',
          choices: [{ message: { content: 'pong' } }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
        { status: 200 },
      );
    };

    const adapter = new NearAiLlmAdapter(fakeFetch, {
      NEAR_AI_API_KEY: 'injected-app-env-key',
      NEAR_AI_ATTEST: '0',
    } as never);
    await adapter.complete({ system: 's', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 });
    expect(capturedAuth).toBe('Bearer injected-app-env-key');
    expect(bodies[0]?.reasoning_effort).toBe('low');

    await adapter.complete(
      { system: 's', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 },
      { NEAR_AI_API_KEY: 'override-key', NEAR_AI_ATTEST: '0', NEAR_AI_THINKING: '1' },
    );
    expect(bodies[1]?.reasoning_effort).toBeUndefined();
  });
});
