-- AlterTable
ALTER TABLE "core"."colony" ADD COLUMN     "bot_persona" TEXT,
ADD COLUMN     "is_bot" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "colony_planet_id_founding_sector_id_idx" ON "core"."colony"("planet_id", "founding_sector_id");

-- AlterTable
ALTER TABLE "core"."planet_sector" ADD COLUMN     "active_bots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "active_humans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_synced_tick" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "world"."sector_participant_state" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "colony_id" TEXT NOT NULL,
    "colony_index" INTEGER NOT NULL,
    "player_id" TEXT,
    "actor_kind" TEXT NOT NULL DEFAULT 'player',
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "handle" TEXT NOT NULL,
    "bot_persona" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stage" INTEGER NOT NULL DEFAULT 1,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
    "alive" BOOLEAN NOT NULL DEFAULT true,
    "hq_q" INTEGER,
    "hq_r" INTEGER,
    "unit_count" INTEGER NOT NULL DEFAULT 0,
    "building_count" INTEGER NOT NULL DEFAULT 0,
    "stock_json" JSONB NOT NULL DEFAULT '{}',
    "caps_json" JSONB NOT NULL DEFAULT '{}',
    "power_json" JSONB NOT NULL DEFAULT '{}',
    "queue_json" JSONB NOT NULL DEFAULT '[]',
    "goals_json" JSONB NOT NULL DEFAULT '[]',
    "entities_json" JSONB NOT NULL DEFAULT '[]',
    "last_input_at_tick" INTEGER,
    "last_tick" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_participant_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sector_participant_state_planet_id_colony_id_key" ON "world"."sector_participant_state"("planet_id", "colony_id");
CREATE INDEX "sector_participant_state_planet_id_sector_id_idx" ON "world"."sector_participant_state"("planet_id", "sector_id");
CREATE INDEX "sector_participant_state_planet_id_is_bot_idx" ON "world"."sector_participant_state"("planet_id", "is_bot");
CREATE INDEX "sector_participant_state_player_id_idx" ON "world"."sector_participant_state"("player_id");

-- CreateTable
CREATE TABLE "world"."sim_input_history" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL DEFAULT 'sec_0_0',
    "colony_id" TEXT,
    "colony_index" INTEGER,
    "actor_id" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "args_json" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reject_code" TEXT,
    "reject_detail" TEXT,
    "issued_at_tick" INTEGER,
    "applied_at_tick" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_input_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sim_input_history_planet_id_created_at_idx" ON "world"."sim_input_history"("planet_id", "created_at");
CREATE INDEX "sim_input_history_planet_id_sector_id_created_at_idx" ON "world"."sim_input_history"("planet_id", "sector_id", "created_at");
CREATE INDEX "sim_input_history_planet_id_colony_index_created_at_idx" ON "world"."sim_input_history"("planet_id", "colony_index", "created_at");
CREATE INDEX "sim_input_history_planet_id_is_bot_created_at_idx" ON "world"."sim_input_history"("planet_id", "is_bot", "created_at");
CREATE INDEX "sim_input_history_command_id_idx" ON "world"."sim_input_history"("command_id");

-- CreateTable
CREATE TABLE "ai"."agent_decision_history" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL DEFAULT 'sec_0_0',
    "colony_id" TEXT,
    "colony_index" INTEGER,
    "actor_id" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "actor_source" TEXT NOT NULL,
    "decision_kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT,
    "command_id" TEXT,
    "command_kind" TEXT,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL DEFAULT 'emitted',
    "at_tick" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_decision_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_decision_history_planet_id_created_at_idx" ON "ai"."agent_decision_history"("planet_id", "created_at");
CREATE INDEX "agent_decision_history_planet_id_sector_id_created_at_idx" ON "ai"."agent_decision_history"("planet_id", "sector_id", "created_at");
CREATE INDEX "agent_decision_history_planet_id_colony_index_at_tick_idx" ON "ai"."agent_decision_history"("planet_id", "colony_index", "at_tick");
CREATE INDEX "agent_decision_history_command_id_idx" ON "ai"."agent_decision_history"("command_id");

-- CreateTable
CREATE TABLE "world"."sim_worker_lease" (
    "planet_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'all',
    "mode" TEXT NOT NULL DEFAULT 'active',
    "last_tick" INTEGER NOT NULL DEFAULT 0,
    "alive_players" INTEGER NOT NULL DEFAULT 0,
    "alive_bots" INTEGER NOT NULL DEFAULT 0,
    "leased_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_worker_lease_pkey" PRIMARY KEY ("planet_id")
);

-- CreateIndex
CREATE INDEX "sim_worker_lease_worker_id_expires_at_idx" ON "world"."sim_worker_lease"("worker_id", "expires_at");
CREATE INDEX "sim_worker_lease_expires_at_idx" ON "world"."sim_worker_lease"("expires_at");
