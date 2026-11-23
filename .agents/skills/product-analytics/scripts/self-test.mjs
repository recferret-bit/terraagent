#!/usr/bin/env node
// Fixture proofs for the product-analytics harness. Does not read the live tree.
//   npm run test:analytics
import assert from 'node:assert/strict';
import { validateAnalytics } from './validate.mjs';

const client = (name, props = []) => ({ name, plane: 'client', props });
const server = (name, props = []) => ({ name, plane: 'server', props });
const both = (name, props = []) => ({ name, plane: 'both', props });
const legacy = (name) => ({ name, plane: 'client', legacy: true, props: [] });
const file = (path, text) => ({ path, text });

const devHelper = [
  '/** Dev helper: `window.__track.setConsent(true); __track.track(\'x\'); await __track.flush()`. */',
  'export const track = (name: string): void => get().track(name);',
].join('\n');

function failures(input) {
  return validateAnalytics(input).failures;
}

function blob(input) {
  return failures(input).join('\n');
}

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

check('a client event with no emitter fails', () => {
  const text = blob({
    events: [client('surface_viewed')],
    files: [file('frontend/game/a.ts', "// track('surface_viewed')\nconst note = 'unrelated';")],
  });
  assert.match(text, /client event 'surface_viewed'/);
  assert.match(text, /frontend\//);
  assert.doesNotMatch(text, /not in the catalog/);
});

check('a server event emitted only from the browser fails the server check', () => {
  const text = blob({
    events: [server('auth_completed')],
    files: [file('frontend/game/a.ts', "track('auth_completed')")],
  });
  assert.match(text, /server event 'auth_completed'/);
  assert.match(text, /backend\/app\/src/);
  assert.doesNotMatch(text, /no quoted emitter in frontend/);
});

check('a reason value that never appears as a literal fails', () => {
  const text = blob({
    events: [client('auth_failed', [{ key: 'reason', values: ['popup_blocked', 'dismissed'] }])],
    files: [file('frontend/game/a.ts', "track('auth_failed'); const reason = 'popup_blocked';")],
  });
  assert.match(text, /reason 'dismissed'/);
  assert.doesNotMatch(text, /popup_blocked/);
});

check('a known-good fixture passes', () => {
  const result = validateAnalytics({
    events: [
      client('surface_viewed', [{ key: 'surface' }, { key: 'runtime' }]),
      server('auth_completed', [{ key: 'method' }]),
      both('trade_order_failed', [{ key: 'reason', values: ['rejected'] }]),
      legacy('deed_viewed'),
    ],
    funnels: [{
      id: 'trade-fail',
      steps: [
        { event: 'surface_viewed', where: [{ key: 'surface', value: 'landing' }, { key: 'runtime', value: 'prod' }] },
        { event: 'trade_order_failed' },
      ],
      exclusion: 'auth_completed',
      breakdown: 'reason',
    }],
    trends: [{
      id: 'visitors',
      event: 'surface_viewed',
      breakdown: 'surface',
      where: [{ key: 'runtime', value: 'prod' }],
    }],
    files: [
      file('frontend/game/a.ts', "track('surface_viewed'); track('trade_order_failed'); const reason = 'rejected'; track('deed_viewed');"),
      file('backend/app/src/analytics/record.ts', "record('auth_completed'); record('trade_order_failed');"),
      file('frontend/game/core/analytics/index.ts', devHelper),
      file('frontend/game/a.spec.ts', "track('not_a_real_event'); track('surface_viewed');"),
    ],
  });
  assert.equal(result.ok, true, result.failures.join('\n'));
});

check('posthog-js fails', () => {
  const text = blob({
    events: [client('surface_viewed')],
    files: [file('frontend/game/a.ts', "import 'posthog-js';\ntrack('surface_viewed');")],
  });
  assert.match(text, /posthog-js/);
});

check('a posthog.com script URL fails', () => {
  const text = blob({
    events: [client('surface_viewed')],
    files: [
      file('frontend/game/a.ts', "track('surface_viewed');"),
      file('frontend/index.html', '<script src="https://us.i.posthog.com/static/array.js"></script>'),
    ],
  });
  assert.match(text, /posthog\.com/);
});

check('a direct track() name outside the catalog fails', () => {
  const text = blob({
    events: [client('surface_viewed')],
    files: [file('frontend/game/a.ts', "track('surface_viewed'); track?.('made_up');")],
  });
  assert.match(text, /track\('made_up'\) is not in the catalog/);
});

check('director.policy_changed under frontend fails', () => {
  const text = blob({
    events: [client('surface_viewed'), legacy('director_policy_changed')],
    files: [
      file('frontend/game/a.ts', "track('surface_viewed'); track('director_policy_changed');"),
      file('frontend/game/features/director/index.ts', "ctx.services.track?.('director.policy_changed');"),
    ],
  });
  assert.match(text, /director\.policy_changed/);
  assert.match(text, /not in the catalog/);
});

check('an unknown funnel event and a where key that is not a prop fail', () => {
  const text = blob({
    events: [client('surface_viewed', [{ key: 'runtime' }])],
    funnels: [{
      id: 'acquisition',
      steps: [{ event: 'surface_viewed', where: [{ key: 'nope', value: '1' }] }, { event: 'missing_step' }],
      exclusion: 'missing_success',
    }],
    files: [file('frontend/game/a.ts', "track('surface_viewed')")],
  });
  assert.match(text, /unknown event 'missing_step'/);
  assert.match(text, /unknown exclusion 'missing_success'/);
  assert.match(text, /where 'nope'/);
});

check('a legacy name missing from both trees fails', () => {
  const text = blob({
    events: [legacy('deed_viewed')],
    files: [file('frontend/game/deed.spec.ts', "track('deed_viewed')")],
  });
  assert.match(text, /legacy event 'deed_viewed'/);
});

check('GeoIP system breakdown passes and raw PostHog token in source fails', () => {
  const geoOk = validateAnalytics({
    events: [client('surface_viewed', [{ key: 'surface' }])],
    trends: [{ id: 'geo', event: 'surface_viewed', breakdown: '$geoip_country_name' }],
    retention: [{ id: 'ret', targetEvent: 'surface_viewed', returningEvent: 'surface_viewed' }],
    files: [file('frontend/game/a.ts', "track('surface_viewed')")],
  });
  assert.equal(geoOk.ok, true, geoOk.failures.join('\n'));

  const badToken = blob({
    events: [client('surface_viewed')],
    files: [file('frontend/game/a.ts', `track('surface_viewed'); const k = '${'phc'}_1234567890abcdef';`)],
  });
  assert.match(badToken, /raw PostHog token/);
});

check('unknown retention event fails', () => {
  const text = blob({
    events: [client('surface_viewed')],
    retention: [{ id: 'ret', targetEvent: 'surface_viewed', returningEvent: 'missing_ret' }],
    files: [file('frontend/game/a.ts', "track('surface_viewed')")],
  });
  assert.match(text, /unknown returningEvent 'missing_ret'/);
});

if (failed) {
  console.error(`analytics self-test failed (${failed})`);
  process.exit(1);
}
console.log('analytics self-test passed');
