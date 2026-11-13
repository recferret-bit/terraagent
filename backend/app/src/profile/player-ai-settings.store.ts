import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_PLAYER_NEAR_AI_MODEL,
  NEAR_AI_AVAILABLE_MODELS,
  type PlayerAiSettings,
  type UpdatePlayerAiSettings,
} from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { normalizeNearAiModel } from '../ai/nearai-models.js';
import { HomeRepository } from '../core/home/index.js';
import { databaseEnabled } from '../core/persistence.js';
import { APP_ENV, type AppEnv } from '../core/tokens.js';
import { PRISMA } from '../db/db.module.js';
import { loadKekRing, openSecret, sealSecret, type KekEnv } from '../near/keystore/index.js';

export interface PlayerAiCredentials {
  readonly playerId: string;
  readonly apiKey: string | null;
  readonly model: string;
}

const ENVELOPE_PREFIX = 'enc:v1:';

/** Encrypt a raw player NEAR.AI API key with AES-256-GCM under the configured NEAR_KEK ring. */
export function sealPlayerApiKey(rawKey: string | null | undefined, env?: KekEnv): string | null {
  const trimmed = rawKey?.trim();
  if (!trimmed) return null;
  const ring = loadKekRing(env ?? {});
  const key = ring.keyFor(ring.currentVersion);
  if (!key) throw new Error(`Missing KEK for version ${String(ring.currentVersion)}`);
  const envelope = sealSecret(key, Buffer.from(trimmed, 'utf8'));
  return `${ENVELOPE_PREFIX}${String(ring.currentVersion)}:${envelope}`;
}

/** Decrypt a sealed player NEAR.AI API key (with plaintext fallback for pre-migration rows). */
export function openPlayerApiKey(stored: string | null | undefined, env?: KekEnv): string | null {
  const trimmed = stored?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith(ENVELOPE_PREFIX)) return trimmed;
  const rest = trimmed.slice(ENVELOPE_PREFIX.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx <= 0) throw new Error('Invalid player API key envelope');
  const version = Number(rest.slice(0, colonIdx));
  const envelope = rest.slice(colonIdx + 1);
  if (!Number.isInteger(version) || version < 1 || !envelope) {
    throw new Error('Invalid player API key envelope metadata');
  }
  const ring = loadKekRing(env ?? {});
  const key = ring.keyFor(version);
  if (!key) throw new Error(`Missing KEK for player API key version ${String(version)}`);
  return openSecret(key, envelope).toString('utf8');
}

export function maskApiKey(apiKey: string | null | undefined): string | null {
  const trimmed = apiKey?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return `••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

@Injectable()
export class PlayerAiSettingsStore {
  private readonly memory = new Map<string, { sealedApiKey: string | null; model: string }>();
  private readonly colonyOwners = new Map<string, string>();

  constructor(
    @Optional() @Inject(PRISMA) private readonly prisma?: PrismaClient,
    @Optional() @Inject(APP_ENV) private readonly env?: AppEnv,
    @Optional() private readonly home?: HomeRepository,
  ) {}

  private isDbActive(): boolean {
    return Boolean(this.prisma && databaseEnabled(this.env));
  }

  bindColonyPlayer(planetId: string, colonyIndex: number, playerId: string): void {
    this.colonyOwners.set(`${planetId}:${colonyIndex}`, playerId);
  }

  async getCredentials(playerId: string): Promise<{ apiKey: string | null; model: string }> {
    if (this.isDbActive() && this.prisma) {
      const row = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: { nearAiApiKey: true, nearAiModel: true },
      });
      if (row) {
        const stored = row.nearAiApiKey?.trim() || null;
        const model = normalizeNearAiModel(row.nearAiModel || DEFAULT_PLAYER_NEAR_AI_MODEL);
        this.memory.set(playerId, { sealedApiKey: stored, model });
        return { apiKey: openPlayerApiKey(stored, this.env), model };
      }
    }
    const cached = this.memory.get(playerId);
    return {
      apiKey: openPlayerApiKey(cached?.sealedApiKey ?? null, this.env),
      model: normalizeNearAiModel(cached?.model ?? DEFAULT_PLAYER_NEAR_AI_MODEL),
    };
  }

  async getSettings(playerId: string): Promise<PlayerAiSettings> {
    const creds = await this.getCredentials(playerId);
    return {
      hasApiKey: Boolean(creds.apiKey),
      apiKeyPreview: maskApiKey(creds.apiKey),
      model: creds.model,
      availableModels: [...NEAR_AI_AVAILABLE_MODELS],
    };
  }

  async updateSettings(
    player: { readonly id: string; readonly handle: string },
    input: UpdatePlayerAiSettings,
  ): Promise<PlayerAiSettings> {
    const current = await this.getCredentials(player.id);
    const nextModel = normalizeNearAiModel(input.model || current.model);
    const nextKey =
      input.apiKey === undefined
        ? current.apiKey
        : input.apiKey === null || input.apiKey.trim() === ''
          ? null
          : input.apiKey.trim();
    const sealedApiKey = sealPlayerApiKey(nextKey, this.env);

    this.memory.set(player.id, { sealedApiKey, model: nextModel });

    if (this.isDbActive() && this.prisma) {
      const existing = await this.prisma.player.findUnique({
        where: { id: player.id },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.player.update({
          where: { id: player.id },
          data: { nearAiApiKey: sealedApiKey, nearAiModel: nextModel },
        });
      } else {
        const byHandle = await this.prisma.player.findUnique({
          where: { handle: player.handle },
          select: { id: true },
        });
        const safeHandle =
          byHandle && byHandle.id !== player.id
            ? `${player.handle}-${player.id.slice(-6)}`
            : player.handle;
        await this.prisma.player.upsert({
          where: { id: player.id },
          create: {
            id: player.id,
            handle: safeHandle,
            nearAiApiKey: sealedApiKey,
            nearAiModel: nextModel,
          },
          update: { nearAiApiKey: sealedApiKey, nearAiModel: nextModel },
        });
      }
    }

    return {
      hasApiKey: Boolean(nextKey),
      apiKeyPreview: maskApiKey(nextKey),
      model: nextModel,
      availableModels: [...NEAR_AI_AVAILABLE_MODELS],
    };
  }

  async resolvePlanetPlayerAiConfigs(
    planetId: string,
    stateColonies?: ReadonlyArray<{ readonly index: number; readonly playerId?: unknown } | undefined>,
  ): Promise<Record<number, PlayerAiCredentials>> {
    const indexToPlayer = new Map<number, string>();
    if (stateColonies) {
      for (const col of stateColonies) {
        if (!col) continue;
        const pid = typeof col.playerId === 'string' ? col.playerId.trim() : '';
        if (pid && !pid.startsWith('ai:')) {
          indexToPlayer.set(col.index, pid);
        }
      }
    }
    for (const [key, pid] of this.colonyOwners.entries()) {
      if (key.startsWith(`${planetId}:`)) {
        const idx = Number(key.slice(planetId.length + 1));
        if (Number.isInteger(idx)) indexToPlayer.set(idx, pid);
      }
    }
    if (this.home) {
      const colonies = await this.home.listColoniesByPlanetId(planetId);
      for (const col of colonies) {
        if (col.playerId) indexToPlayer.set(col.colonyIndex, col.playerId);
      }
    }
    if (this.isDbActive() && this.prisma) {
      const rows = await this.prisma.colony.findMany({
        where: { planetId },
        select: { colonyIndex: true, playerId: true },
      });
      for (const row of rows) {
        if (row.playerId) indexToPlayer.set(row.colonyIndex, row.playerId);
      }
    }

    const out: Record<number, PlayerAiCredentials> = {};
    for (const [colonyIndex, playerId] of indexToPlayer.entries()) {
      const creds = await this.getCredentials(playerId);
      out[colonyIndex] = { playerId, apiKey: creds.apiKey, model: creds.model };
    }
    return out;
  }
}
