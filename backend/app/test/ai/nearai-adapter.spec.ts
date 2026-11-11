import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEAR_AI_MODEL,
  NEAR_AI_KEY_MISSING,
  NearAiLlmAdapter,
  nearAiKey,
  sha256Hex,
  verifySignatureHashes,
  type FetchLike,
} from '../../src/ai/adapters/nearai-llm.adapter.js';

describe('NEAR AI Cloud LLM adapter & TEE attestation', () => {
  it('refuses to start without NEAR_AI_API_KEY and never leaks sibling secrets', async () => {
    const secret = 'sk-do-not-leak-me';
    expect(() => nearAiKey({})).toThrow(NEAR_AI_KEY_MISSING);
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
});
