// Automatic per-wave presets (runner, model + advisor, subagents, mode, parallel factor, plan gate, skills) and prompt builder.

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

// Short preset names → Grok model ids. Opus/fable/argon lead on grok-4.7; sonnet/flash on the fast build model.
// Grok 1.0.70 has no --context-window flag. Session spawn reads this and uses it instead of the 256k default.
export const GROK_CONTEXT_WINDOW = '500000';
const GROK_MODELS = {
  opus: 'grok-4.7',
  fable: 'grok-4.7',
  argon: 'grok-4.7',
  'argon-medium': 'grok-4.7',
  sonnet: 'grok-4.7-build-fast',
  flash: 'grok-4.7-build-fast',
  'flash-medium': 'grok-4.7-build-fast',
  'flash-low': 'grok-4.7-build-fast',
  'argon-low': 'grok-4.7-build-fast',
};

// Every wave has a preset so `npm run wave` sets runner, model (+ advisor for Claude), subagents, mode, parallel factor, tags & skills automatically.
// Runners: `claude`, `agy`, `grok` (`--runner` overrides the preset).
// Capability hierarchy: sonnet < opus < fable.
// - Standard Claude waves: worker = `sonnet`, advisor = `opus` (`claude:sonnet+opus`)
// - Complex Claude waves:  worker = `opus`,   advisor = `fable` (`claude:opus+fable`)
// - `--runner grok` maps opus/fable/argon → `grok-4.7` and sonnet/flash → `grok-4.7-build-fast`. Pass `--model grok-4.6` (or another id from `grok models`) to override. Grok has no advisor flag.
export const WAVE_PRESETS = {
  W00: { runner: 'claude', model: 'opus', advisor: 'fable', subagents: 'sonnet (M) + flash (S)', mode: 'auto', parallel: 6, tags: ['H'], plan: 'serial-spine', skills: ['diorama-viewport-auditor'], track: 'Spine' },
  W01: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator', 'diorama-viewport-auditor'], track: 'Spine/3D' },
  W02: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'planetary-lighting-and-lightning'], track: 'Spine/Sim' },
  W03: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'planetary-lighting-and-lightning'], track: 'Gameplay/Grid' },
  W04: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 3, tags: ['H'], plan: 'contract-first', skills: ['diorama-viewport-auditor', 'shader-texture-tuning'], track: 'Client/Maps' },
  W05: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['shader-texture-tuning', 'planetary-lighting-and-lightning', 'diorama-viewport-auditor'], track: 'Gameplay/Terra' },
  W06: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Auth' },
  W07: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 5, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator', 'shader-texture-tuning'], track: 'Gameplay/Combat' },
  W08: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'Autonomy/Goals' },
  W09: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 3, tags: ['H'], plan: 'contract-first', skills: [], track: 'Autonomy/Away' },
  W10: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator', 'diorama-viewport-auditor'], track: 'NEAR/Cargo' },
  W11: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 3, tags: ['H'], plan: 'contract-first', skills: ['diorama-viewport-auditor'], track: 'Meta/Lobby' },
  W12: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'Meta/Profile' },
  W13: { runner: 'claude', model: 'opus', advisor: 'fable', subagents: 'sonnet', mode: 'auto', parallel: 5, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Markets' },
  W14: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: ['shader-texture-tuning', 'diorama-viewport-auditor'], track: 'Gameplay/Walls' },
  W15: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Agents' },
  W16: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: [], track: 'Autonomy/LLM' },
  W17: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/T2' },
  W18: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: [], track: 'Gameplay/PvP' },
  W19: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/Air' },
  W20: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 3, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/Deed' },
  W21: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['procedural-kitbash-3d', 'model-geometry-validator'], track: 'Gameplay/Rocket' },
  W22: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'NEAR/DAO' },
  W23: { runner: 'claude', model: 'opus', advisor: 'fable', subagents: 'opus (H2 real NEAR)', mode: 'auto', parallel: 2, tags: ['H2'], plan: 'port-swap-plan', skills: [], track: 'NEAR/Real' },
  W24: { runner: 'agy', model: 'argon', advisor: null, subagents: 'flash (S) + inherit (M)', mode: 'auto', parallel: 4, tags: ['H', 'H+', '-'], plan: 'contract-first', skills: ['diorama-viewport-auditor'], track: 'Client/Mobile' },
  W25: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 3, tags: ['H'], plan: 'contract-first', skills: ['diorama-viewport-auditor'], track: 'Ops/Launch' },
  W26: { runner: 'grok', model: 'grok-4.7', advisor: null, subagents: 'subagents', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'Ops/Sites' },
};

const CLAUDE_PAIR = {
  opus: { model: 'sonnet', advisor: 'opus' },
  fable: { model: 'opus', advisor: 'fable' },
  sonnet: { model: 'sonnet', advisor: 'opus' },
};

export function resolvePreset(wave, overrides = {}) {
  const base = WAVE_PRESETS[wave.id] ?? {
    runner: 'claude', model: 'sonnet', advisor: 'opus', subagents: 'sonnet', mode: 'auto', parallel: 4, tags: ['H'], plan: 'contract-first', skills: [], track: 'General',
  };
  const [mOverride, advFromModel] = (overrides.model ?? '').includes('+') ? overrides.model.split('+') : [overrides.model, null];
  const runner = overrides.runner ?? base.runner;
  const pair = runner === 'claude' && mOverride && !overrides.advisor && !advFromModel ? CLAUDE_PAIR[mOverride] : null;
  let model = pair ? pair.model : (mOverride || base.model);
  let advisor = runner === 'claude' ? (overrides.advisor ?? advFromModel ?? pair?.advisor ?? base.advisor ?? 'opus') : null;
  if (runner === 'grok') {
    model = GROK_MODELS[model] ?? model;
    advisor = null;
  }
  const cliModel = runner === 'agy' ? (AGY_MODELS[model] ?? model) : model;
  const label = `${runner}:${model}${advisor ? `+${advisor}` : ''}`;
  const tags = overrides.tags ?? (wave.tags?.H ? ['H'] : base.tags);
  return {
    ...base,
    runner,
    model,
    advisor,
    cliModel,
    label,
    mode: overrides.mode ?? base.mode,
    effort: overrides.effort ?? null,
    parallel: Number(overrides.parallel ?? base.parallel),
    tags,
  };
}

export function buildRunnerCommand(preset, prompt, dirs = []) {
  const dirArgs = dirs.flatMap((d) => ['--add-dir', d]);
  const effortArgs = preset.effort ? ['--effort', preset.effort] : [];
  if (preset.runner === 'agy') {
    const agyMode = preset.mode === 'acceptEdits' ? 'accept-edits' : preset.mode;
    return { cmd: 'agy', args: [...dirArgs, '--model', preset.cliModel, '--mode', agyMode, ...effortArgs, '-i', prompt] };
  }
  const permissionMode = preset.mode === 'accept-edits' ? 'acceptEdits' : preset.mode;
  // Grok rejects additionalDirectories: the session cwd is the wave worktree, set by the spawn.
  if (preset.runner === 'grok') {
    return {
      cmd: 'grok',
      args: ['--model', preset.cliModel, '--permission-mode', permissionMode, ...effortArgs, '--verbatim', prompt],
      env: { GROK_DEBUG_CONTEXT_WINDOW: GROK_CONTEXT_WINDOW },
    };
  }
  if (preset.runner !== 'claude') throw new Error(`unknown runner "${preset.runner}" (use claude, agy or grok)`);
  const advisorArgs = preset.advisor ? ['--advisor', preset.advisor] : [];
  return { cmd: 'claude', args: [...dirArgs, '--model', preset.cliModel, ...advisorArgs, '--permission-mode', permissionMode, ...effortArgs, prompt] };
}

function planGateText(w, preset) {
  const consult = preset.advisor ? `Consult your \`${preset.advisor}\` advisor to map` : 'Map';
  if (preset.plan === 'serial-spine') {
    return `1. **Phase 1 — Serial Spine Bootstrap (no subagents yet):** ${consult} the wave dependency graph, then build and merge \`W00-02\` (workspaces) → \`W00-04\` (frontend workspaces) → \`W00-05\` (\`@terra/config\`) → \`W00-01\` (contracts core) → \`W00-14\` (\`@terra/sim\` kernel) SERIALLY into \`${w.branch}\`. Only after those 5 root blockers are green on \`${w.branch}\`, fan out to parallel subagents.`;
  }
  if (preset.plan === 'port-swap-plan') {
    const withAdvisor = preset.advisor ? `With your \`${preset.advisor}\` advisor, verify` : 'Verify';
    return `1. **Phase 1 — Port Contract Gate:** ${withAdvisor} each port's contract test suite against the mock first, then swap one port at a time (\`IdentityPort\`/\`RelayerPort\` → \`CargoTokenPort\` → \`IntentsPort\` with \`dry: true\` first).`;
  }
  return `1. **Phase 1 — Plan & Contract-First Gate (serial):** Map out the dependency tiers for ${w.id}, then build and merge \`${w.id}-01\` (contracts, schemas, data rows, wave flag) SERIALLY into \`${w.branch}\` first before spawning any parallel subagents.`;
}

function runtimeStrategy(w, preset) {
  if (preset.runner === 'agy') {
    return `2. **Phase 2 — Parallel Subagent Execution (AGY \`${preset.model}\` lead, mode=\`${preset.mode}\`, parallel=\`${preset.parallel}\`):**
   - Handle \`${w.id}-01\`, cross-file architecture, \`@terra/sim\` rules, and 3D kitbash/shader work directly on Argon or \`Model: 'inherit'\` subagents.
   - Dispatch independent \`Size S\` leaf issues (data tables, vanilla DOM Faction Plate HUDs, seed scenarios, unit tests) via \`invoke_subagent\` with \`Model: 'flash'\` (at most ${preset.parallel} concurrent subagents in isolated \`../TerraAgent-wt/${w.id}-XX\` worktrees).
   - Run 4-view visual QA in \`/playground.html?inspect=<id>&validate=1\` (for any model change) and verify \`/play.html?scenario=${w.id.toLowerCase()}\` before concluding.`;
  }
  if (preset.runner === 'grok') {
    return `2. **Phase 2 — Parallel Subagent Execution (Grok \`${preset.model}\` lead, mode=\`${preset.mode}\`, parallel=\`${preset.parallel}\`):**
   - Build \`${w.id}-01\`, cross-file architecture, \`@terra/sim\` rules, and 3D kitbash/shader work in this session.
   - Dispatch independent issues with the subagent tool, at most ${preset.parallel} at a time, each in its own worktree \`../TerraAgent-wt/${w.id}-XX\`.
   - Run 4-view visual QA in \`/playground.html?inspect=<id>&validate=1\` (for any model change) and verify \`/play.html?scenario=${w.id.toLowerCase()}\` before concluding.`;
  }
  return `2. **Phase 2 — Parallel Subagent Execution (Claude worker=\`${preset.model}\` + advisor=\`${preset.advisor}\`, subagents=\`${preset.subagents}\`, mode=\`${preset.mode}\`, parallel=\`${preset.parallel}\`):**
   - Consult your \`${preset.advisor}\` advisor for \`${w.id}-01\` contract schemas, port/outbox/matcher invariants, and architectural decisions while driving implementation on \`${preset.model}\`.
   - Spawn up to ${preset.parallel} concurrent \`sonnet\` subagents in isolated \`../TerraAgent-wt/${w.id}-XX\` worktrees for independent \`Size S\` and \`Size M\` implementation and test issues.
   - If an issue touches a 3D kitbash archetype (e.g. \`W10-16\`), follow \`procedural-kitbash-3d\` and require \`npm run validate:models -- <id>\` with 0 errors and 0 warnings.`;
}

export function wavePrompt(w, title, { preset, progress }) {
  const stack = `\nThis branch was cut from \`main\` after every wave it depends on landed there (PRODUCT_WAVES §7: no stacking of unlanded waves). After any other wave lands, merge \`main\` into \`${w.branch}\` before building further.`;
  const skillsLine = preset.skills.length
    ? `\nMandatory skills for this wave: activate ${preset.skills.map((s) => `\`.agents/skills/${s}/SKILL.md\``).join(', ')} whenever touching their domain.`
    : '';
  const progressBlock = progress.done.length
    ? `\nProgress on \`${w.branch}\`: ${progress.done.length}/${progress.total.length} issues already merged (${progress.done.join(', ')}).\nRemaining in-scope issues to build (${progress.remaining.length}): ${progress.remaining.join(', ')}.`
    : `\nIn-scope issues (${progress.total.length}, tags: ${preset.tags.join(', ')}): ${progress.total.join(', ')}.`;

  return `You are the lead for wave ${w.id} — ${title} — of TerraAgent. You work in this git worktree on branch \`${w.branch}\`.${stack}

Read first: CLAUDE.md, AGENTS.md (§6 architecture rules), docs/plan/PRODUCT_WAVES.md §3–§7, the wave file \`${w.file}\`, every spec section it cites, and docs/plan/OWNER_TASKS.md (owner decisions; where a question is open, use its proposed default and say so in the commit).${skillsLine}
${progressBlock}

## Execution Protocol (Preset: \`${preset.label}\` · parallel=\`${preset.parallel}\`)
${planGateText(w, preset)}
${runtimeStrategy(w, preset)}

For each issue:
1. Build it on its own branch \`issue/${w.id}-XX\` cut from \`${w.branch}\` in worktree \`../TerraAgent-wt/${w.id}-XX\`. Run independent issues in parallel, at most ${preset.parallel} at a time.
2. Meet its single acceptance check ("do X → see Y") and check it yourself.
3. Keep the gates green: \`npm run build\` (typecheck + check:structure: ≤500 lines/file, ≤100 lines/fn), plus any unit, contract or e2e suites that exist by then.
4. Merge it into \`${w.branch}\` with \`git merge --no-ff\` and the commit message \`${w.id}-XX: <title>\`, then delete the issue branch and its worktree.

Rules: build on the existing 3D renderer in \`frontend/render\` and the prototype views in \`frontend/game\` (PRODUCT_WAVES §4 "One renderer": extend and register, never replace or duplicate; keep its approved look and run the model validator + playground 4-view check for any model change); one engine (game rules only in \`shared/sim\`, D-31), registries instead of edits to shared files, balance numbers only in data tables (D-35), the layout of D-32 and the size/layer limits of AGENTS.md §6. Touch another wave's owned paths only where the wave file says so. Never push, never touch \`main\`.

When every in-scope issue (${progress.total.length}/${progress.total.length}) has landed: merge the latest \`main\` into \`${w.branch}\`, run the wave e2e and every earlier wave's e2e, and start the dev stack on this worktree's ports (\`.env.worktree\`). Then play every demo step yourself on that running stack and write the **owner check guide** \`docs/plan/checks/w${w.id.slice(1)}-check.md\` in the format of \`docs/plan/checks/README.md\` (worked example: \`docs/plan/checks/w00-check.md\`): before-you-start (ports, start/stop, how to reach every tool — the in-game dev console is the \`\` \` \`\` key, not DevTools), one numbered step per demo-story step with exact where / how / see, deferred and e2e-only steps marked, the automated checks, and "when you're done": \`npm run wave -- land ${w.id.slice(1)}\`. Add any new dev tool (URL parameter, console command, dev page, env variable) to \`docs/dev/DEV_TOOLS.md\`. Commit both, then finish with the guide as your final message. The owner lands the wave with \`npm run wave -- land ${w.id.slice(1)}\` (or the next \`npm run wave\`) after the check.`;
}
