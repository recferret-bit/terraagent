import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolvePostHogHosts(region = 'eu', explicitApiHost, explicitIngestHost) {
  const norm = region.trim().toLowerCase() === 'us' ? 'us' : 'eu';
  const apiHost = (explicitApiHost ?? `https://${norm}.posthog.com`).replace(/\/+$/, '');
  const ingestHost = (explicitIngestHost ?? `https://${norm}.i.posthog.com`).replace(/\/+$/, '');
  return { region: norm, apiHost, ingestHost };
}

export function loadPostHogEnv(root, envOverrides = process.env) {
  const filePath = join(root, 'infra/.env.posthog');
  const fileVars = existsSync(filePath) ? parseEnv(readFileSync(filePath, 'utf8')) : {};
  const merged = { ...fileVars, ...envOverrides };

  const rawProjectApiKey = clean(merged.project_api_key) ?? clean(merged.PROJECT_API_KEY);
  const projectToken =
    clean(merged.POSTHOG_KEY) ??
    clean(merged.project_token) ??
    (rawProjectApiKey?.startsWith('phc_') ? rawProjectApiKey : undefined);
  const projectId = clean(merged.POSTHOG_PROJECT_ID) ?? clean(merged.project_id);
  const region = clean(merged.POSTHOG_REGION) ?? clean(merged.region) ?? 'eu';
  const personalApiKey =
    clean(merged.POSTHOG_PERSONAL_API_KEY) ??
    clean(merged.personal_api_key) ??
    clean(merged.PERSONAL_API_KEY) ??
    (rawProjectApiKey?.startsWith('phx_') ? rawProjectApiKey : undefined);
  const personSalt = clean(merged.POSTHOG_PERSON_SALT) ?? clean(merged.person_salt);
  const { apiHost, ingestHost } = resolvePostHogHosts(
    region,
    clean(merged.POSTHOG_API_HOST) ?? clean(merged.api_host),
    clean(merged.POSTHOG_HOST) ?? clean(merged.ingest_host),
  );

  return {
    fileExists: existsSync(filePath),
    projectToken,
    projectId,
    region: region.toLowerCase() === 'us' ? 'us' : 'eu',
    personalApiKey,
    personSalt,
    apiHost,
    ingestHost,
  };
}

export function redactSecrets(text, cfg = {}) {
  let out = String(text ?? '')
    .replace(/\bphc_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bphx_[A-Za-z0-9_-]+/g, '[redacted]');
  for (const secret of [cfg.projectToken, cfg.personalApiKey, cfg.personSalt]) {
    if (secret && secret.length > 0) out = out.split(secret).join('[redacted]');
  }
  return out;
}
