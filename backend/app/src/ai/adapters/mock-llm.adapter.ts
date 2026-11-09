import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../ports/adapters.js';
import { LlmProviderPort, type LlmRequest, type LlmResponse } from '../../ports/llm-provider.port.js';
import { isMockFault, mockDirectorPlan, type MockDirectorInput, type MockFault } from '../mock/director-plan.js';

const MODEL = 'mock-director';

/**
 * Mock provider. The user message is JSON `{ risk, fault?, note? }`.
 * Proposal faults return that proposal as JSON. Every other fault returns text `parseAiJson` rejects.
 * The slow fault does not sleep.
 */
@Injectable()
export class MockLlmAdapter extends LlmProviderPort {
  complete(req: LlmRequest): Promise<LlmResponse> {
    const brief = readBrief(req);
    const text = brief ? planText(brief) : '';
    const input = `${req.system}\n${req.messages.map((message) => message.content).join('\n')}`;
    return Promise.resolve({
      text,
      usage: { inputTokens: tokens(input), outputTokens: tokens(text) },
      model: MODEL,
    });
  }
}

export const adapter = adapterOf({ port: LlmProviderPort, kind: 'mock', useClass: MockLlmAdapter });

function planText(brief: MockDirectorInput): string {
  const plan = mockDirectorPlan(brief);
  return plan.ok ? JSON.stringify(plan.proposal) : plan.raw;
}

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readBrief(req: LlmRequest): MockDirectorInput | null {
  const content = [...req.messages].reverse().find((message) => message.role === 'user')?.content;
  if (content === undefined) return null;
  const record = objectRecord(content);
  if (!record || (record.risk !== 'conservative' && record.risk !== 'risky')) return null;
  const fault = optionalFault(record.fault);
  if (fault === 'reject') return null;
  if (record.note !== undefined && typeof record.note !== 'string') return null;
  return {
    risk: record.risk,
    ...(fault ? { fault } : {}),
    ...(typeof record.note === 'string' ? { note: record.note } : {}),
  };
}

function optionalFault(value: unknown): MockFault | undefined | 'reject' {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isMockFault(value)) return value;
  return 'reject';
}

function objectRecord(content: string): Record<string, unknown> | null {
  try {
    const body = JSON.parse(content) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
