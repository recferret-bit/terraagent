/**
 * Wire ceilings for the director (AI_ORCHESTRATOR §5, §6). These bound schemas and parsers.
 * Gameplay tunables (reserve floors, call intervals, token budgets) live in `shared/sim/src/data/director.ts` (D-35).
 * Contracts cannot import the sim, so a ceiling that zod must enforce stays here.
 */
export const AI_BRIEF_MAX_BYTES = 8192;
export const AI_INPUT_TOKEN_CAP = 4000;
export const AI_OUTPUT_TOKEN_CAP = 1200;
export const AI_RESPONSE_MAX_BYTES = 16 * 1024;
export const AI_READ_MAX_BYTES = 8192;
export const AI_READ_MAX_RECORDS = 64;
export const AI_MAX_ACTIONS = 5;
export const AI_MAX_SKILLS = 6;
export const AI_MAX_TURNS = 3;
export const AI_MAX_TOOL_CALLS = 6;
export const AI_RATIONALE_MAX_CHARS = 200;
export const AI_NOTE_MAX_CHARS = 500;
export const AI_CONTEXT_MAX_AGE_S = 60;
export const AI_JSON_MAX_DEPTH = 8;
export const AI_MAX_EVENTS = 32;
export const AI_MAX_DECISIONS = 10;
export const AI_SUMMARY_MAX_CHARS = 120;
