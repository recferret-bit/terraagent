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

const NODE_MODULES = ['node:*', 'fs', 'fs/*', 'path', 'os', 'child_process', 'worker_threads', 'http', 'net'];

const asyncMsg = `${WHY}. step() is synchronous: no async functions or await.`;

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
      'no-restricted-syntax': ['error',
        { selector: 'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]', message: asyncMsg },
        { selector: 'AwaitExpression, ForOfStatement[await=true]', message: asyncMsg },
      ],
    },
  },
];

export const simPurity = [
  ...purity(['shared/sim/src/**/*.ts'], ['contracts']),
  // seed scenarios run on every host (server thread, browser local host, CLI): same purity, plus the engine API itself
  ...purity(['scenarios/*.ts'], ['contracts', 'sim']),
];
