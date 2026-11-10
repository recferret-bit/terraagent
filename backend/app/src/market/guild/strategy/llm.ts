import type { LlmProviderPort } from '../../../ports/llm-provider.port.js';
import {
  GuildStrategyError,
  GuildStrategyPort,
  parseGuildStrategy,
  type GuildStrategyChoice,
  type GuildStrategyClock,
  type GuildStrategyNpc,
} from './port.js';

/** One hour. The running app never reaches this: `GuildModule` does not construct this class (BE-76). */
const HOUR_MS = 3_600_000;

const SYSTEM = 'Reply with JSON only: route, stockpile, specialisation, risk. Do not include a price or free_price.';

/**
 * W16 slot. Not a Nest provider and not an LLM client.
 * `choose` throws `unused` and does not call or log unless `w16` is true.
 */
export class LlmGuildStrategy extends GuildStrategyPort {
  private readonly issued = new Map<string, { readonly at: number; readonly choice: GuildStrategyChoice }>();

  constructor(
    private readonly llm: LlmProviderPort,
    private readonly w16 = false,
  ) {
    super();
  }

  async choose(npc: GuildStrategyNpc, clock: GuildStrategyClock): Promise<GuildStrategyChoice> {
    if (!this.w16) throw new GuildStrategyError('w16_off', 'unused');
    const prior = this.issued.get(npc.id);
    if (prior && clock.nowMs >= prior.at && clock.nowMs - prior.at < HOUR_MS) return prior.choice;
    const choice = await this.ask(npc);
    this.issued.set(npc.id, { at: clock.nowMs, choice });
    return choice;
  }

  private async ask(npc: GuildStrategyNpc): Promise<GuildStrategyChoice> {
    const res = await this.llm.complete({
      system: SYSTEM,
      messages: [{ role: 'user', content: npc.id }],
      maxTokens: 256,
      temperature: 0,
      json: true,
    });
    const parsed = parseGuildStrategy(readJson(res.text));
    if (!parsed.ok) throw new GuildStrategyError(parsed.code, `Guild strategy rejected: ${parsed.code}`);
    return parsed.value;
  }
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
