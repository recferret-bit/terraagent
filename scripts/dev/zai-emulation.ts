import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import { z } from 'zod';

export const DecisionSchema = z.object({
  actionKind: z.enum(['placeBuilding', 'moveUnit', 'setHarvestWeights', 'queueGoal']),
  category: z.enum(['what_to_build', 'where_to_go', 'what_to_do']),
  target: z.string().min(1),
  coordinates: z.object({ q: z.number(), r: z.number() }).nullable().optional(),
  harvestWeights: z.object({ metals: z.number(), minerals: z.number(), bio: z.number() }).nullable().optional(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  rationale: z.string().min(10),
});

export type Decision = z.infer<typeof DecisionSchema>;

export interface EmulatedCase {
  readonly id: string;
  readonly title: string;
  readonly category: 'what_to_build' | 'where_to_go' | 'what_to_do';
  readonly situation: string;
  readonly expectedActionKind: Decision['actionKind'];
  readonly validateDecision: (d: Decision) => boolean;
}

export const CASES: readonly EmulatedCase[] = [
  {
    id: 'case-01-power-blackout',
    title: 'Power Grid Blackout at Dusk',
    category: 'what_to_build',
    situation:
      'Biome: Dune. Solar cycle: Dusk (0 solar incoming for next 150s). Net Power: -48/s deficit. Power grid collapsed. Colony metals: 140. Non-solar generators or wind turbines are needed to prevent total shutdown.',
    expectedActionKind: 'placeBuilding',
    validateDecision: (d) =>
      d.actionKind === 'placeBuilding' || d.target.toLowerCase().includes('turbine') || d.target.toLowerCase().includes('generator') || d.target.toLowerCase().includes('power'),
  },
  {
    id: 'case-02-metal-vein-mining',
    title: 'Rich Metal Deposit Discovered in Outer Rim',
    category: 'what_to_build',
    situation:
      'Colony metals stock: 8 units (critically depleted). Scout detected an unharvested rich metal ore vein at hex coordinates (q: 8, r: -5). Decide building to extract this ore.',
    expectedActionKind: 'placeBuilding',
    validateDecision: (d) =>
      d.actionKind === 'placeBuilding' && (d.target.toLowerCase().includes('extractor') || d.target.toLowerCase().includes('mine') || d.target.toLowerCase().includes('refinery')),
  },
  {
    id: 'case-03-insect-swarm-incursion',
    title: 'Acid Spitter Insect Swarm Advancing',
    category: 'where_to_go',
    situation:
      'Hostile insect swarm (acid spitters) spotted advancing from the East at hex (q: 14, r: 2) towards our perimeter. Combat drone drone-01 is currently idle at base (q: 0, r: 0). Defense line is undefended. Move drone to intercept position.',
    expectedActionKind: 'moveUnit',
    validateDecision: (d) =>
      d.actionKind === 'moveUnit' || (d.coordinates !== null && d.coordinates !== undefined),
  },
  {
    id: 'case-04-resource-imbalance',
    title: 'Severe Biomass Overflow vs Metals Starvation',
    category: 'what_to_do',
    situation:
      'Colony storage telemetry: Bio is at 98% capacity (490/500), but Metals are starved at 4% (10/250), stalling all building queues. Workers are currently splitting harvest equally 33/33/33. Rebalance harvest weights prioritizing Metals.',
    expectedActionKind: 'setHarvestWeights',
    validateDecision: (d) =>
      d.actionKind === 'setHarvestWeights' || (d.harvestWeights !== null && (d.harvestWeights?.metals ?? 0) >= 50),
  },
  {
    id: 'case-05-critical-unit-retreat',
    title: 'Heavy Drone Hull Integrity Failure Under Fire',
    category: 'where_to_go',
    situation:
      'Worker drone unit-03 at hex (q: 6, r: 4) took corrosive acid damage and is down to 12% HP. Base repair plinth is located at colony hub (q: 0, r: 0). If it stays mining, it will be destroyed. Issue movement command to retreat.',
    expectedActionKind: 'moveUnit',
    validateDecision: (d) =>
      d.actionKind === 'moveUnit' || (d.coordinates?.q === 0 && d.coordinates?.r === 0),
  },
  {
    id: 'case-06-frontier-alien-ruins',
    title: 'Uncharted Ancient Anomaly Discovered',
    category: 'where_to_go',
    situation:
      'Long-range sensors detected an ancient pre-collapse technological relic cache at uncharted frontier hex (q: -12, r: 16). Fast recon rover rover-02 is ready. Dispatch recon unit to explore the anomaly coordinates.',
    expectedActionKind: 'moveUnit',
    validateDecision: (d) =>
      d.actionKind === 'moveUnit' && (d.coordinates?.q === -12 || d.target.includes('rover') || d.target.includes('scout')),
  },
  {
    id: 'case-07-toxic-soil-blocker',
    title: 'Toxic Ash Blocker on Expansion Corridor',
    category: 'what_to_do',
    situation:
      'Sector expansion toward eastern canyon is blocked by volatile volcanic sulfur soil at (q: 5, r: 1). Builders cannot pass. Goal catalog offers terraform_zone to scrub toxic soil and neutralize hazard.',
    expectedActionKind: 'queueGoal',
    validateDecision: (d) =>
      d.actionKind === 'queueGoal' || d.target.toLowerCase().includes('terraform'),
  },
  {
    id: 'case-08-forward-hub-expansion',
    title: 'Sector 1 Saturated — Establish Forward Outpost',
    category: 'what_to_build',
    situation:
      'Colony base sector build density has reached 100%. Stage 3 expansion unlocked sector-02 centered at (q: 0, r: 15). We have 300 metals and 200 power available. Decide what key structure to place at sector center.',
    expectedActionKind: 'placeBuilding',
    validateDecision: (d) =>
      d.actionKind === 'placeBuilding' && (d.target.toLowerCase().includes('hub') || d.target.toLowerCase().includes('outpost') || d.target.toLowerCase().includes('command')),
  },
  {
    id: 'case-09-night-battery-conservation',
    title: 'Approaching 180s Night with Low Energy Storage',
    category: 'what_to_build',
    situation:
      'Day/night cycle telemetry: Sunset in 10s. Night duration: 180s. Solar arrays will output 0 kW. Current battery storage capacity is only 20 kW-h, while nighttime base drain is 80 kW-h. Need energy storage or auxiliary power.',
    expectedActionKind: 'placeBuilding',
    validateDecision: (d) =>
      d.actionKind === 'placeBuilding' && (d.target.toLowerCase().includes('battery') || d.target.toLowerCase().includes('storage') || d.target.toLowerCase().includes('substation') || d.target.toLowerCase().includes('power') || d.target.toLowerCase().includes('generator')),
  },
  {
    id: 'case-10-economic-boom-risky',
    title: 'Economic Boom & Alloy Specialization (Risky Policy)',
    category: 'what_to_do',
    situation:
      'Director policy is set to Risky. Colony basic survival needs are 100% satisfied. World market alloy prices surged by +140%. Colony has 500 unallocated metals. Queue aggressive economic expansion goal.',
    expectedActionKind: 'queueGoal',
    validateDecision: (d) =>
      d.actionKind === 'queueGoal' || d.target.toLowerCase().includes('economy') || d.target.toLowerCase().includes('grow'),
  },
];

export function parseDecisionJson(rawText: string): Decision {
  const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) ?? rawText.match(/```\s*([\s\S]*?)\s*```/);
  const clean = jsonMatch ? jsonMatch[1] : rawText;
  const parsed = JSON.parse(clean.trim());
  return DecisionSchema.parse(parsed);
}

export function loadTestEnv(): Record<string, string | undefined> {
  const root = process.cwd();
  const infraWorktree = resolve(root, 'infra/.env.worktree');
  const infraEnv = resolve(root, 'infra/.env');
  const worktreeEnv = existsSync(infraWorktree) ? parseEnv(readFileSync(infraWorktree, 'utf8')) : {};
  const baseEnv = existsSync(infraEnv) ? parseEnv(readFileSync(infraEnv, 'utf8')) : {};
  return { ...baseEnv, ...worktreeEnv, ...process.env };
}

export async function runEmulationCase(
  c: EmulatedCase,
  env: Record<string, string | undefined>,
): Promise<{
  caseId: string;
  decision: Decision | null;
  latencyMs: number;
  tokens: { prompt: number; completion: number; reasoning?: number };
  passed: boolean;
  error?: string;
}> {
  const apiKey = env.NEAR_AI_API_KEY || env.NEARAI_API_KEY || env.NEARAI_CLOUD_API_KEY;
  if (!apiKey) throw new Error('NEAR_AI_API_KEY not configured');

  const provider = createOpenAICompatible({
    name: 'nearai',
    baseURL: env.NEAR_AI_BASE_URL || env.NEARAI_BASE_URL || env.AI_BASE_URL || 'https://cloud-api.near.ai/v1',
    apiKey,
  });

  const system = [
    'You are the AI Strategic Colony Director for TerraAgent.',
    'Decide the immediate strategic action for the colony based on the telemetry.',
    'Respond with ONLY a valid JSON object conforming to this schema:',
    '{',
    '  "actionKind": "placeBuilding" | "moveUnit" | "setHarvestWeights" | "queueGoal",',
    '  "category": "what_to_build" | "where_to_go" | "what_to_do",',
    '  "target": string,',
    '  "coordinates": {"q": number, "r": number} | null,',
    '  "harvestWeights": {"metals": number, "minerals": number, "bio": number} | null,',
    '  "urgency": "low" | "medium" | "high" | "critical",',
    '  "rationale": string',
    '}',
  ].join('\n');

  const start = Date.now();
  try {
    const result = await generateText({
      model: provider.chatModel(env.NEAR_AI_MODEL || env.NEARAI_MODEL || env.AI_MODEL || 'z-ai/glm-5.3'),
      system,
      messages: [{ role: 'user', content: `Case: ${c.title}\nSituation:\n${c.situation}` }],
      maxOutputTokens: 1536,
    });
    const latencyMs = Date.now() - start;
    const decision = parseDecisionJson(result.text);
    const passed = c.validateDecision(decision);

    const rawUsage = result.usage as {
      raw?: { completion_tokens_details?: { reasoning_tokens?: number } };
      outputTokenDetails?: { reasoningTokens?: number };
    };
    const reasoning = rawUsage?.raw?.completion_tokens_details?.reasoning_tokens ?? rawUsage?.outputTokenDetails?.reasoningTokens;

    return {
      caseId: c.id,
      decision,
      latencyMs,
      tokens: {
        prompt: result.usage.inputTokens ?? 0,
        completion: result.usage.outputTokens ?? 0,
        reasoning,
      },
      passed,
    };
  } catch (err) {
    return {
      caseId: c.id,
      decision: null,
      latencyMs: Date.now() - start,
      tokens: { prompt: 0, completion: 0 },
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
