// Automatic per-wave presets (runner, model, subagents, mode, effort, parallel factor, plan gate, skills) and prompt builder.

const AGY_MODELS = {
  argon: 'gemini-4-argon-high',
  'argon-medium': 'gemini-4-argon-medium',
  'argon-low': 'gemini-4-argon-low',
  flash: 'gemini-3.8-flash-high',
  'flash-medium': 'gemini-3.8-flash-medium',
  'flash-low': 'gemini-3.8-flash-low',
  opus: 'claude-opus-5-5-high',
  sonnet: 'claude-sonnet-5-5-high',
};

// Every wave has a preset so `npm run wave` sets runner, model, subagents, mode, effort, parallel factor, tags & skills automatically.
export const WAVE_PRESETS = {
  W00: { runner: 'claude', model: 'opus', subagents: 'sonnet (M) + flash (S)', mode: 'auto', effort: 'xhigh', parallel: 6, tags: ['H'], plan: 'serial-spine', skills: ['diorama-viewport-auditor'], track: 'Spine' },
  W01: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator', 'diorama-viewport-auditor'], track: 'Spine/3D' },
  W02: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'planetary-lighting-and-lightning'], track: 'Spine/Sim' },
  W03: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'planetary-lighting-and-lightning'], track: 'Gameplay/Grid' },
  W04: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 3, tags: ['H'], plan: 'contract-first', skills: ['diorama-viewport-auditor', 'shader-texture-tuning'], track: 'Client/Maps' },
  W05: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['shader-texture-tuning', 'planetary-lighting-and-lightning', 'diorama-viewport-auditor'], track: 'Gameplay/Terra' },
  W06: { runner: 'claude', model: 'opus', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Auth' },
  W07: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'xhigh', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator', 'shader-texture-tuning'], track: 'Gameplay/Combat' },
  W08: { runner: 'claude', model: 'fable', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'Autonomy/Goals' },
  W09: { runner: 'claude', model: 'fable', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 3, tags: ['H'], plan: 'contract-first', skills: [], track: 'Autonomy/Away' },
  W10: { runner: 'claude', model: 'opus', subagents: 'sonnet (+ argon on W10-16)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'NEAR/Cargo' },
  W11: { runner: 'claude', model: 'fable', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 3, tags: ['H'], plan: 'contract-first', skills: [], track: 'Meta/Lobby' },
  W12: { runner: 'claude', model: 'fable', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'Meta/Profile' },
  W13: { runner: 'claude', model: 'opus', subagents: 'sonnet', mode: 'auto', effort: 'xhigh', parallel: 5, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Markets' },
  W14: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['shader-texture-tuning', 'diorama-viewport-auditor'], track: 'Gameplay/Walls' },
  W15: { runner: 'claude', model: 'opus', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Agents' },
  W16: { runner: 'claude', model: 'fable', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: [], track: 'Autonomy/LLM' },
  W17: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/T2' },
  W18: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: [], track: 'Gameplay/PvP' },
  W19: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/Air' },
  W20: { runner: 'claude', model: 'opus', subagents: 'sonnet + fable (card)', mode: 'auto', effort: 'high', parallel: 3, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Deed' },
  W21: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/Rocket' },
  W22: { runner: 'claude', model: 'opus', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/DAO' },
  W23: { runner: 'claude', model: 'opus', subagents: 'opus (H2 real NEAR)', mode: 'auto', effort: 'max', parallel: 2, tags: ['H2'], plan: 'port-swap-plan', skills: [], track: 'NEAR/Real' },
  W24: { runner: 'agy', model: 'argon', subagents: 'flash (S) + inherit (M)', mode: 'auto', effort: 'high', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['diorama-viewport-auditor'], track: 'Client/Mobile' },
  W25: { runner: 'claude', model: 'fable', subagents: 'sonnet + argon (e2e)', mode: 'auto', effort: 'high', parallel: 3, tags: ['H'], plan: 'contract-first', skills: ['diorama-viewport-auditor'], track: 'Ops/Launch' },
};

export function resolvePreset(wave, overrides = {}) {
  const base = WAVE_PRESETS[wave.id] ?? {
    runner: 'claude', model: 'opus', subagents: 'sonnet', mode: 'auto', effort: 'high', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'General',
  };
  const runner = overrides.runner ?? base.runner;
  const model = overrides.model ?? base.model;
  const cliModel = runner === 'agy' ? (AGY_MODELS[model] ?? model) : model;
  const tags = overrides.tags ?? (wave.tags?.H ? ['H'] : base.tags);
  return {
    ...base,
    runner,
    model,
    cliModel,
    mode: overrides.mode ?? base.mode,
    effort: overrides.effort ?? base.effort,
    parallel: Number(overrides.parallel ?? base.parallel),
    tags,
  };
}

export function buildRunnerCommand(preset, prompt, dirs = []) {
  const dirArgs = dirs.flatMap((d) => ['--add-dir', d]);
  if (preset.runner === 'agy') {
    const agyMode = preset.mode === 'acceptEdits' ? 'accept-edits' : preset.mode;
    return { cmd: 'agy', args: [...dirArgs, '--model', preset.cliModel, '--mode', agyMode, '--effort', preset.effort, '-i', prompt] };
  }
  const claudeMode = preset.mode === 'accept-edits' ? 'acceptEdits' : preset.mode;
  return { cmd: 'claude', args: [...dirArgs, '--model', preset.cliModel, '--permission-mode', claudeMode, '--effort', preset.effort, prompt] };
}

function planGateText(w, preset) {
  if (preset.plan === 'serial-spine') {
    return '1. **Phase 1 — Serial Spine Bootstrap (no subagents yet):** Write a concise execution plan for the wave dependency graph, then build and merge `W00-02` (workspaces) → `W00-04` (frontend workspaces) → `W00-05` (`@terra/config`) → `W00-01` (contracts core) → `W00-14` (`@terra/sim` kernel) SERIALLY into `' + w.branch + '`. Only after those 5 root blockers are green on `' + w.branch + '`, fan out to parallel subagents.';
  }
  if (preset.plan === 'port-swap-plan') {
    return '1. **Phase 1 — Port Contract Gate:** Verify each port\'s contract test suite against the mock first, then swap one port at a time (`IdentityPort`/`RelayerPort` → `CargoTokenPort` → `IntentsPort` with `dry: true` first).';
  }
  return `1. **Phase 1 — Plan & Contract-First Gate (serial):** Map out the dependency tiers for ${w.id}, then build and merge \`${w.id}-01\` (contracts, schemas, data rows, wave flag) SERIALLY into \`${w.branch}\` first before spawning any parallel subagents.`;
}

export function wavePrompt(w, title, { preset, stacked, progress }) {
  const stack = stacked.length
    ? `\nThis branch stacks the unlanded wave(s) ${stacked.join(', ')} (PRODUCT_WAVES §7 step 2); never commit on their branches.`
    : '';
  const skillsLine = preset.skills.length
    ? `\nMandatory skills for this wave: activate ${preset.skills.map((s) => `\`.agents/skills/${s}/SKILL.md\``).join(', ')} whenever touching their domain.`
    : '';
  const progressBlock = progress.done.length
    ? `\nProgress on \`${w.branch}\`: ${progress.done.length}/${progress.total.length} issues already merged (${progress.done.join(', ')}).\nRemaining in-scope issues to build (${progress.remaining.length}): ${progress.remaining.join(', ')}.`
    : `\nIn-scope issues (${progress.total.length}, tags: ${preset.tags.join(', ')}): ${progress.total.join(', ')}.`;

  const runtimeStrategy = preset.runner === 'agy'
    ? `2. **Phase 2 — Parallel Subagent Execution (AGY \`${preset.model}\` lead, mode=\`${preset.mode}\`, effort=\`${preset.effort}\`, parallel=\`${preset.parallel}\`):**
   - Handle \`${w.id}-01\`, cross-file architecture, \`@terra/sim\` rules, and 3D kitbash/shader work directly on Argon or \`Model: 'inherit'\` subagents.
   - Dispatch independent \`Size S\` leaf issues (data tables, vanilla DOM Faction Plate HUDs, seed scenarios, unit tests) via \`invoke_subagent\` with \`Model: 'flash'\` (at most ${preset.parallel} concurrent subagents in isolated \`../TerraAgent-wt/${w.id}-XX\` worktrees).
   - Run 4-view visual QA in \`/playground.html?inspect=<id>&validate=1\` (for any model change) and verify \`/play.html?scenario=${w.id.toLowerCase()}\` before concluding.`
    : `2. **Phase 2 — Parallel Subagent Execution (Claude \`${preset.model}\` lead, subagents=\`${preset.subagents}\`, mode=\`${preset.mode}\`, effort=\`${preset.effort}\`, parallel=\`${preset.parallel}\`):**
   - Handle \`${w.id}-01\` (contracts & data), port/outbox/matcher invariants, and high-craft UX/narrative directly as lead.
   - Spawn up to ${preset.parallel} concurrent \`sonnet\` subagents in isolated \`../TerraAgent-wt/${w.id}-XX\` worktrees for independent \`Size S\` and \`Size M\` implementation and test issues.
   - If an issue touches a 3D kitbash archetype (e.g. \`W10-16\`), follow \`procedural-kitbash-3d\` and require \`npm run validate:models -- <id>\` with 0 errors and 0 warnings.`;

  return `You are the lead for wave ${w.id} — ${title} — of TerraAgent. You work in this git worktree on branch \`${w.branch}\`.${stack}

Read first: CLAUDE.md, AGENTS.md (§6 architecture rules), docs/plan/PRODUCT_WAVES.md §3–§7, the wave file \`${w.file}\`, every spec section it cites, and docs/plan/OWNER_TASKS.md (owner decisions; where a question is open, use its proposed default and say so in the commit).${skillsLine}
${progressBlock}

## Execution Protocol (Preset: \`${preset.runner}:${preset.model}\` · effort=\`${preset.effort}\` · parallel=\`${preset.parallel}\`)
${planGateText(w, preset)}
${runtimeStrategy}

For each issue:
1. Build it on its own branch \`issue/${w.id}-XX\` cut from \`${w.branch}\` in worktree \`../TerraAgent-wt/${w.id}-XX\`. Run independent issues in parallel, at most ${preset.parallel} at a time.
2. Meet its single acceptance check ("do X → see Y") and check it yourself.
3. Keep the gates green: \`npm run build\` (typecheck + check:structure: ≤500 lines/file, ≤100 lines/fn), plus any unit, contract or e2e suites that exist by then.
4. Merge it into \`${w.branch}\` with \`git merge --no-ff\` and the commit message \`${w.id}-XX: <title>\`, then delete the issue branch and its worktree.

Rules: build on the existing 3D renderer in \`frontend/render\` and the prototype views in \`frontend/game\` (PRODUCT_WAVES §4 "One renderer": extend and register, never replace or duplicate; keep its approved look and run the model validator + playground 4-view check for any model change); one engine (game rules only in \`shared/sim\`, D-31), registries instead of edits to shared files, balance numbers only in data tables (D-35), the layout of D-32 and the size/layer limits of AGENTS.md §6. Touch another wave's owned paths only where the wave file says so. Never push, never touch \`main\`.

When every in-scope issue (${progress.total.length}/${progress.total.length}) has landed: merge the latest \`main\` into \`${w.branch}\`, run the wave e2e and every earlier wave's e2e (once the harness exists), start the dev stack, and finish with the wave's demo steps and the URL for the owner's manual check. On the next \`npm run wave\`, the completed wave will automatically land into \`main\` and open the next wave.`;
}
