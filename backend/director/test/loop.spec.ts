import { describe, expect, it } from 'vitest';
import { LOOP_CAPS, planningStep } from '../src/loop.js';

describe('W16-42 planning caps', () => {
  it('stops at three turns, six tools, or the token cap', () => {
    expect(LOOP_CAPS).toEqual({ turns: 3, tools: 6, tokens: 4000 });
    expect(planningStep({ turns: 3, toolCalls: 6, tokens: 4000 })).toBe('ok');
    expect(planningStep({ turns: 4, toolCalls: 0, tokens: 0 })).toBe('turn_cap');
    expect(planningStep({ turns: 1, toolCalls: 7, tokens: 0 })).toBe('tool_cap');
    expect(planningStep({ turns: 1, toolCalls: 1, tokens: 4001 })).toBe('token_cap');
  });
});
