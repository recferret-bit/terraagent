import { describe, expect, it } from 'vitest';
import { classifyNearAiFailure, parseErrorBody } from '../../src/ai/adapters/nearai-errors.js';
import { NEAR_AI_KEY_MISSING, NearAiLlmAdapter, type FetchLike } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { LlmProviderError } from '../../src/ports/llm-provider.port.js';

/** NEAR AI Cloud's own envelope (nearai/cloud-api `ErrorResponse::new(message, type)`). */
const body = (type: string, message = 'x'): string => JSON.stringify({ error: { message, type, param: null, code: null } });
const REQ = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 8 };
const ENV = { NEAR_AI_API_KEY: 'sk-protocol', NEAR_AI_ATTEST: '0' };

describe('NEAR AI Cloud failure classification', () => {
  it.each([
    [402, body('no_credits', 'No credits available. Please purchase credits to use the API.'), 'unfunded'],
    [402, body('insufficient_credits', 'Credit limit exceeded. Spent: $5, Limit: $5. Please purchase more credits.'), 'unfunded'],
    [402, body('api_key_limit_exceeded', 'API key spend limit exceeded.'), 'unfunded'],
    [402, body('no_limit_configured'), 'unfunded'],
    [402, '', 'unfunded'],
    [402, body('provider_error', 'Vendor payment required'), 'server'],
    [401, body('invalid_api_key'), 'unauthorized'],
    [401, body('unauthorized', "Authorization header does not start with 'Bearer '"), 'unauthorized'],
    [403, body('permission_error'), 'unauthorized'],
    [429, body('rate_limit_exceeded'), 'rate_limited'],
    [429, body('insufficient_quota', 'You exceeded your current quota'), 'unfunded'],
    [429, JSON.stringify({ error: { message: 'Insufficient balance, top up' } }), 'unfunded'],
    [400, JSON.stringify({ error: { message: 'Your credit balance is too low' } }), 'unfunded'],
    [400, body('invalid_request_error', 'max_tokens too large'), 'rejected'],
    // wording never overrides a typed reply, and rate-limit / capacity wording is not a balance problem
    [400, body('invalid_request_error', 'insufficient context: billing address field is not a model input'), 'rejected'],
    [404, body('not_found', 'model credits-v2 not found'), 'rejected'],
    [429, JSON.stringify({ error: { message: 'Quota exceeded for requests per minute' } }), 'rate_limited'],
    [429, JSON.stringify({ error: { message: 'Insufficient capacity, retry later' } }), 'rate_limited'],
    // a proxy / WAF page in front of the provider says nothing about the key
    [403, '<html><body>Access denied by firewall</body></html>', 'server'],
    [403, JSON.stringify({ error: { message: 'forbidden' } }), 'unauthorized'],
    [503, body('service_overloaded'), 'server'],
    [500, '<html>oops</html>', 'server'],
    [504, '', 'timeout'],
  ])('HTTP %i %s -> %s', (status, raw, kind) => {
    const err = classifyNearAiFailure(status, raw);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.kind).toBe(kind);
    expect(err.message).toBe(`NEAR AI Cloud HTTP ${status}`);
    expect(err.message).not.toContain('credits');
  });

  it('reads OpenAI-style, flat and non-JSON bodies', () => {
    expect(parseErrorBody(body('no_credits', 'm'))).toEqual({ type: 'no_credits', code: undefined, message: 'm', json: true });
    expect(parseErrorBody(JSON.stringify({ type: 'authentication_error', message: 'bad' }))).toMatchObject({ type: 'authentication_error' });
    expect(parseErrorBody(JSON.stringify({ error: 'quota exceeded' }))).toMatchObject({ message: 'quota exceeded' });
    expect(parseErrorBody('not json')).toEqual({ message: 'not json', json: false });
  });
});

describe('NearAiLlmAdapter typed errors and timeout', () => {
  it('a 402 zero balance rejects with kind unfunded and one HTTP call', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(body('no_credits'), { status: 402 });
    };
    await expect(new NearAiLlmAdapter(fetchImpl).complete(REQ, ENV)).rejects.toMatchObject({ kind: 'unfunded', status: 402, providerType: 'no_credits' });
    expect(calls).toBe(1);
  });

  it('a missing key is unauthorized with no HTTP call', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response('{}');
    };
    await expect(new NearAiLlmAdapter(fetchImpl).complete(REQ, {})).rejects.toMatchObject({ kind: 'unauthorized', message: NEAR_AI_KEY_MISSING });
    expect(calls).toBe(0);
  });

  it('a non-JSON 200 is bad_response; a network error is server', async () => {
    await expect(new NearAiLlmAdapter(async () => new Response('<html/>', { status: 200 })).complete(REQ, ENV)).rejects.toMatchObject({ kind: 'bad_response' });
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(new NearAiLlmAdapter(down).complete(REQ, ENV)).rejects.toMatchObject({ kind: 'server' });
  });

  it('times out a hung provider as kind timeout, but a caller abort stays the caller abort', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await expect(new NearAiLlmAdapter(hang).complete({ ...REQ, timeoutMs: 20 }, ENV)).rejects.toMatchObject({ kind: 'timeout' });
    const ctl = new AbortController();
    const pending = new NearAiLlmAdapter(hang).complete({ ...REQ, signal: ctl.signal, timeoutMs: 5_000 }, ENV);
    ctl.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LlmProviderError);
  });
});
