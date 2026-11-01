// Load the catalog and see the eight D-37 hosts, each on its compose stack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogOrigins, loadCatalog, loadEnvExample, validateDeployEnv } from './load-catalog.mjs';

const EXPECTED = [
  ['terraagent.fun', 'frontend'],
  ['pitchdeck.terraagent.fun', 'frontend'],
  ['whitepaper.terraagent.fun', 'frontend'],
  ['design.terraagent.fun', 'frontend'],
  ['play.terraagent.fun', 'frontend'],
  ['playground.terraagent.fun', 'frontend'],
  ['devchain.terraagent.fun', 'chain'],
  ['api.terraagent.fun', 'backend'],
];

test('eight hosts, tagged as in D-37', () => {
  const catalog = loadCatalog();
  assert.deepEqual(catalog.stacks, ['infra', 'frontend', 'backend', 'chain']);
  assert.equal(catalog.wave, 'W26');
  assert.deepEqual(catalog.hosts.map((h) => [h.host, h.stack]), EXPECTED);
  assert.equal(catalog.hosts.find((h) => h.stack === 'infra'), undefined);
  assert.equal(catalog.hosts.find((h) => h.id === 'api').index, null);
  assert.equal(catalog.hosts.find((h) => h.id === 'api').health, '/v1/healthz');
  assert.deepEqual(catalogOrigins(catalog), EXPECTED.map(([host]) => `http://${host}`));
});

test('env example has the domain, an empty DEPLOY_HOST and DEPLOY_USER=deploy', () => {
  const env = loadEnvExample();
  assert.equal(env.TA_DOMAIN, 'terraagent.fun');
  assert.equal(env.DEPLOY_HOST, '');
  assert.equal(env.DEPLOY_USER, 'deploy');
});

test('validate-env names an empty DEPLOY_HOST and rejects CHANGE_ME', () => {
  assert.throws(() => validateDeployEnv({ TA_DOMAIN: 'terraagent.fun', DEPLOY_HOST: '', DEPLOY_USER: 'deploy' }), /DEPLOY_HOST/);
  assert.throws(() => validateDeployEnv({ TA_DOMAIN: 'terraagent.fun', DEPLOY_HOST: 'CHANGE_ME', DEPLOY_USER: 'deploy' }), /DEPLOY_HOST/);
  assert.deepEqual(validateDeployEnv({ TA_DOMAIN: 'terraagent.fun', DEPLOY_HOST: '203.0.113.10', DEPLOY_USER: 'deploy' }), {
    TA_DOMAIN: 'terraagent.fun', DEPLOY_HOST: '203.0.113.10', DEPLOY_USER: 'deploy',
  });
});
