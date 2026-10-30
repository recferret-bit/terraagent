import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/** Layers with their own level (`LOG_LEVELS="sim=warn,http=info"`). */
export const LAYERS = ['http', 'domain', 'infra', 'sim'] as const;
export type Layer = (typeof LAYERS)[number];

/** PII masking paths (pino `redact`), applied to every log line. */
export const REDACT_PATHS = [
  'accessToken', 'password', 'token', 'email',
  '*.accessToken', '*.password', '*.token', '*.email',
  '*.*.accessToken', '*.*.password', '*.*.token', '*.*.email',
  'req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie',
];

export function parseLayerLevels(spec: string | undefined): Partial<Record<Layer, string>> {
  const out: Partial<Record<Layer, string>> = {};
  for (const part of (spec ?? '').split(',')) {
    const [layer, level] = part.split('=').map((s) => s.trim());
    if (layer && level && (LAYERS as readonly string[]).includes(layer)) out[layer as Layer] = level;
  }
  return out;
}

export interface LoggerConfig {
  readonly level: string;
  readonly nodeEnv: string;
  readonly layerLevels?: string;
  /** Test hook: capture output here instead of stdout. */
  readonly destination?: DestinationStream;
}

/** Root logger: JSON in production/test, pino-pretty only in development on a TTY. */
export function createRootLogger(cfg: LoggerConfig): Logger {
  const options: LoggerOptions = { level: cfg.level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } };
  if (cfg.destination) return pino(options, cfg.destination);
  if (cfg.nodeEnv === 'development' && process.stdout.isTTY) {
    return pino({ ...options, transport: { target: 'pino-pretty', options: { colorize: true } } });
  }
  return pino(options);
}

/** One child per layer; `layerLevels` overrides the root level for that layer. */
export function layerLogger(root: Logger, layer: Layer, layerLevels?: string): Logger {
  const level = parseLayerLevels(layerLevels)[layer];
  return level ? root.child({ layer }, { level }) : root.child({ layer });
}
