import { z } from 'zod';
import { DirectiveActionSchema } from './actions';
import { DirectiveProposalSchema } from './directive';
import { AI_MAX_ACTIONS, AI_READ_MAX_RECORDS } from './limits';

/** Read tools plus the one proposal tool (AI §6). Any other name is rejected. */
export const MCP_READ_TOOLS = [
  'colony.readBrief',
  'goals.list',
  'world.readSectorSummaries',
  'world.queryObserved',
  'actions.preview',
] as const;
export const MCP_PROPOSE_TOOL = 'director.propose' as const;
export const MCP_TOOL_NAMES = [...MCP_READ_TOOLS, MCP_PROPOSE_TOOL] as const;
export const McpToolNameSchema = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof McpToolNameSchema>;

export const ReadBriefArgsSchema = z.strictObject({});
export const GoalsListArgsSchema = z.strictObject({});
export const SectorSummaryArgsSchema = z.strictObject({
  sectorIds: z.array(z.string().min(1).max(64)).max(AI_READ_MAX_RECORDS).optional(),
});
export const QueryObservedArgsSchema = z.strictObject({
  sectorId: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(AI_READ_MAX_RECORDS).optional(),
});
export const PreviewArgsSchema = z.strictObject({
  actions: z.array(DirectiveActionSchema).min(1).max(AI_MAX_ACTIONS),
});

/** The model submits proposal content only. The host binds colony, fence and revisions. */
export const ProposeArgsSchema = DirectiveProposalSchema;

const TOOL_ARGS = {
  'colony.readBrief': ReadBriefArgsSchema,
  'goals.list': GoalsListArgsSchema,
  'world.readSectorSummaries': SectorSummaryArgsSchema,
  'world.queryObserved': QueryObservedArgsSchema,
  'actions.preview': PreviewArgsSchema,
  'director.propose': ProposeArgsSchema,
} as const;

/** Parses one allowlisted tool call. An unknown tool name fails before the arguments are trusted. */
export function parseToolArgs(name: string, args: unknown) {
  const schema = TOOL_ARGS[name as McpToolName];
  if (!schema) return { success: false as const, code: 'unknown_tool' as const };
  const parsed = schema.safeParse(args);
  return parsed.success
    ? { success: true as const, name: name as McpToolName, data: parsed.data }
    : { success: false as const, code: 'invalid' as const };
}
