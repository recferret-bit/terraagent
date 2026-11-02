// Sim purity rules (SIM-D-06): the sim is isomorphic and deterministic, so shared/sim/src may not touch clocks,
// randomness, timers, I/O, host globals, async code or any package but @terra/contracts and @terra/ledger. Spread into the root config.
const WHY = 'SIM-D-06: the sim must be pure and deterministic';
const banned = (names, hint) => names.map((name) => ({ name, message: `${WHY}. ${hint}` }));

const GLOBALS = [
  ...banned(['Date', 'performance'], 'No clock: use ctx.tick / ctx.dt.'),
  ...banned(['setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame'], 'No timers: time is the step tick.'),
  ...banned(['process', 'window', 'document', 'globalThis', 'localStorage', 'indexedDB'], 'No host globals; the host passes everything in via state/ctx.'),
  ...banned(['fetch', 'XMLHttpRequest', 'WebSocket'], 'No I/O inside the sim.'),
  ...banned(['crypto'], 'No randomness: use ctx.rng(stream).'),
  ...banned(['Intl'], 'No locale-dependent formatting or collation: results differ per host.'),
];

const NODE_MODULES = ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'worker_threads', 'http', 'net', '!./*', '!./**', '!../*', '!../**'];

const asyncMsg = `${WHY}. step() is synchronous: no async functions or await.`;

const powMsg = `${WHY}: \`**\` is engine-dependent like Math.pow. Multiply, use a table or integer math.`;

// Banned syntax every purity file shares (each \`no-restricted-syntax\` config below repeats it: a later config
// replaces the rule's options, it does not merge them).
const PURE_SYNTAX = [
  { selector: 'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]', message: asyncMsg },
  { selector: 'AwaitExpression, ForOfStatement[await=true]', message: asyncMsg },
  { selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']", message: powMsg },
];

// ECMAScript leaves these to the engine (V8, JavaScriptCore and SpiderMonkey may differ by an ulp), so a client
// predicting with them can disagree with the server (D-38). +, -, *, /, Math.sqrt, Math.fround, floor/round are exact.
const ENGINE_MATH = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot', 'cbrt']
  .map((property) => ({ object: 'Math', property, message: `${WHY}: Math.${property} is engine-dependent. Use sqrt / tables / integer math, or justify a cosmetic use with an eslint-disable comment.` }));

// Locale-dependent string methods: the result depends on the host's locale and ICU data.
const LOCALE_METHODS = ['localeCompare', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toLocaleUpperCase', 'toLocaleLowerCase']
  .map((property) => ({ property, message: `${WHY}: ${property} depends on the host locale. Compare code units (< / >) or format in the client.` }));

const purity = (files, allowed) => [
  {
    files,
    rules: {
      'no-restricted-globals': ['error', ...GLOBALS],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: `${WHY}. Use ctx.rng(stream).` }, ...ENGINE_MATH, ...LOCALE_METHODS],
      'no-restricted-imports': ['error', {
        patterns: [
          { group: NODE_MODULES, message: `${WHY}. No Node or I/O modules.` },
          { group: ['@terra/*', ...allowed.flatMap((n) => [`!@terra/${n}`, `!@terra/${n}/*`])], message: allowed.length ? `${WHY}. Only ${allowed.map((n) => `@terra/${n}`).join(', ')} may be imported.` : `${WHY}. No @terra/* package may be imported.` },
        ],
      }],
      'no-restricted-syntax': ['error', ...PURE_SYNTAX],
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
  { files: ['shared/sim/src/**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...PURE_SYNTAX, ...POSITION_WRITES, ...ADMIN_RELOCATE] } },
  { files: ['shared/sim/src/systems/dev/**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...PURE_SYNTAX, ...POSITION_WRITES] } },
  { files: ['shared/sim/src/units/movement/locomotion.ts', 'shared/sim/src/ecs/placement.ts'], rules: { 'no-restricted-syntax': ['error', ...PURE_SYNTAX] } },
];

export const simPurity = [
  ...purity(['shared/sim/src/**/*.ts'], ['contracts', 'ledger']),
  // the ledger runs inside step(): same purity, and it imports no other @terra package
  ...purity(['shared/ledger/src/**/*.ts'], []),
  // seed scenarios run on every host (server thread, browser local host, CLI): same purity, plus the engine API itself
  ...purity(['tests/scenarios/*.ts'], ['contracts', 'ledger', 'sim']),
  ...simMovement,
];
