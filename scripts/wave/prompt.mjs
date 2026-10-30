// The instructions handed to the Claude Code session that builds a wave.

export function wavePrompt(w, title, { tags, parallel, stacked }) {
  const stack = stacked.length
    ? `\nThis branch stacks the unlanded wave(s) ${stacked.join(', ')} (PRODUCT_WAVES §7 step 2); never commit on their branches.`
    : '';
  return `You are the lead for wave ${w.id} — ${title} — of TerraAgent. You work in this git worktree on branch \`${w.branch}\`.${stack}

Read first: CLAUDE.md, AGENTS.md (§6 architecture rules), docs/plan/PRODUCT_WAVES.md §3–§7, the wave file \`${w.file}\`, every spec section it cites, and docs/plan/OWNER_TASKS.md (owner decisions; where a question is open, use its proposed default and say so in the commit).

Scope: the issues in the wave table tagged ${tags.map((t) => `\`${t === '-' ? 'blank' : t}\``).join(', ')}. The table is the source of truth; its Deps column decides the order, and \`${w.id}-01\` (contracts and data) comes first.

For each issue:
1. Build it on its own branch \`issue/${w.id}-XX\` cut from \`${w.branch}\`. Run independent issues in parallel with subagents in isolated worktrees, at most ${parallel} at a time.
2. Meet its single acceptance check ("do X → see Y") and check it yourself.
3. Keep the gates green: \`npm run build\` (typecheck + check:structure), plus any unit, contract or e2e suites that exist by then.
4. Merge it into \`${w.branch}\` with \`git merge --no-ff\` and the commit message \`${w.id}-XX: <title>\`, then delete the issue branch and its worktree.

Rules: build on the existing 3D renderer in \`frontend/render\` and the prototype views in \`frontend/game\` (PRODUCT_WAVES §4 "One renderer": extend and register, never replace or duplicate; keep its approved look and run the model validator + playground 4-view check for any model change); one engine (game rules only in \`shared/sim\`, D-31), registries instead of edits to shared files, balance numbers only in data tables (D-35), the layout of D-32 and the size/layer limits of AGENTS.md §6. Touch another wave's owned paths only where the wave file says so. Never push, never touch \`main\`.

When every in-scope issue has landed: merge the latest \`main\` into \`${w.branch}\`, run the wave e2e and every earlier wave's e2e (once the harness exists), start the dev stack, and finish with the wave's demo steps and the URL for the owner's manual check. The owner lands it afterwards with \`npm run wave -- land\`.`;
}
