// Sim purity rules (SIM-D-06): the sim is isomorphic and deterministic, so shared/sim/src may not touch clocks,
// randomness, timers, I/O, host globals, async code or any package but @terra/contracts. Spread into the root config.
const WHY = 'SIM-D-06: the sim must be pure and deterministic';
const banned = (names, hint) => names.map((name) => ({ name, message: `${WHY}. ${hint}` }));

const GLOBALS = [
  ...banned(['Date', 'performance'], 'No clock: use ctx.tick / ctx.dt.'),
  ...banned(['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame'], 'No timers: time is the step tick.'),
  ...banned(['process', 'window', 'document', 'globalThis', 'localStorage', 'indexedDB'], 'No host globals; the host passes everything in via state/ctx.'),
  ...banned(['fetch', 'XMLHttpRequest', 'WebSocket'], 'No I/O inside the sim.'),
  ...banned(['crypto'], 'No randomness: use ctx.rng(stream).'),
];

const NODE_MODULES = ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'worker_threads', 'http', 'net', '!./*', '!./**', '!../*', '!../**'];

const asyncMsg = `${WHY}. step() is synchronous: no async functions or await.`;

const ASYNC_SYNTAX = [
  { selector: 'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]', message: asyncMsg },
  { selector: 'AwaitExpression, ForOfStatement[await=true]', message: asyncMsg },
];

const purity = (files, allowed) => [
  {
    files,
    rules: {
      'no-restricted-globals': ['error', ...GLOBALS],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: `${WHY}. Use ctx.rng(stream).` }],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: NODE_MODULES, message: `${WHY}. No Node or I/O modules.` },
          { group: ['@terra/*', ...allowed.flatMap((n) => [`!@terra/${n}`, `!@terra/${n}/*`])], message: `${WHY}. Only ${allowed.map((n) => `@terra/${n}`).join(', ')} may be imported.` },
        ],
      }],
      'no-restricted-syntax': ['error', ...ASYNC_SYNTAX],
    },
  },
];

// Unit movement (SIM-M-01): a live entity changes position only by walking a route (units/movement/locomotion.ts),
// so no system can teleport a unit again. Spawning sets the first tile through ecs/placement.ts; admin moves
// (dev.teleport / dev.nudge / dev.land) call adminRelocateEntity, which only systems/dev may use.
const POS = '/^(x|y|q|r)$/';
const moveMsg = 'SIM-M-01: entities move only by walking: issue a unit command (issueUnitCommand / a work provider) and let the movement orchestrator route it. Spawn with placeSpawnedEntity; admin moves live in systems/dev.';
const POSITION_WRITES = [
  { selector: `CallExpression[callee.name='setField'][arguments.2.value=${POS}]`, message: moveMsg },
  // cols.x[row] = …, state.entities.cols.q[row] += …, cols.r[row]++, cols['y'][row] = …
  ...['left', 'argument'].flatMap((side) => ['name', 'property.name'].flatMap((cols) => ['property.name', 'property.value'].map((col) => ({
    selector: `:matches(AssignmentExpression, UpdateExpression)[${side}.type='MemberExpression'][${side}.object.${col}=${POS}][${side}.object.object.${cols}='cols']`,
    message: moveMsg,
  })))),
  // cols.x.set(…), cols.q.fill(…), cols.r.copyWithin(…)
  ...['name', 'property.name'].map((cols) => ({
    selector: `CallExpression[callee.property.name=/^(set|fill|copyWithin)$/][callee.object.property.name=${POS}][callee.object.object.${cols}='cols']`,
    message: moveMsg,
  })),
];
const ADMIN_RELOCATE = [{ selector: "CallExpression[callee.name='adminRelocateEntity']", message: `${moveMsg} adminRelocateEntity is for systems/dev only.` }];

const simMovement = [
  { files: ['shared/sim/src/**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...ASYNC_SYNTAX, ...POSITION_WRITES, ...ADMIN_RELOCATE] } },
  { files: ['shared/sim/src/systems/dev/**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...ASYNC_SYNTAX, ...POSITION_WRITES] } },
  { files: ['shared/sim/src/units/movement/locomotion.ts', 'shared/sim/src/ecs/placement.ts'], rules: { 'no-restricted-syntax': ['error', ...ASYNC_SYNTAX] } },
];

export const simPurity = [
  ...purity(['shared/sim/src/**/*.ts'], ['contracts']),
  // seed scenarios run on every host (server thread, browser local host, CLI): same purity, plus the engine API itself
  ...purity(['scenarios/*.ts'], ['contracts', 'sim']),
  ...simMovement,
];
