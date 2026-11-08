-- AlterTable
ALTER TABLE "core"."colony" ADD COLUMN     "founding_sector_id" TEXT NOT NULL DEFAULT 'sec_0_0',
ADD COLUMN     "landing_slot_id" TEXT;

-- AlterTable
ALTER TABLE "core"."planet" ADD COLUMN     "admission" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "atlas_hash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "atlas_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "canonical_type" TEXT,
ADD COLUMN     "config_hash" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fault_code" TEXT,
ADD COLUMN     "health" TEXT NOT NULL DEFAULT 'OK',
ADD COLUMN     "lifecycle" TEXT NOT NULL DEFAULT 'PROVISIONING',
ADD COLUMN     "look" TEXT NOT NULL DEFAULT 'forestRock',
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "core"."planet_atlas_version" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "atlas_version" INTEGER NOT NULL,
    "topology_version" INTEGER NOT NULL,
    "gen_version" INTEGER NOT NULL,
    "config_version" INTEGER NOT NULL,
    "config_hash" TEXT NOT NULL,
    "atlas_hash" TEXT NOT NULL,
    "resource_profile_id" TEXT NOT NULL,
    "resource_profile_hash" TEXT NOT NULL,
    "manifest_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_atlas_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."planet_sector" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "continent_id" TEXT,
    "macro_q" INTEGER NOT NULL,
    "macro_r" INTEGER NOT NULL,
    "center_q" INTEGER NOT NULL,
    "center_r" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'land',
    "radius" INTEGER NOT NULL DEFAULT 24,
    "founding_capacity" INTEGER NOT NULL DEFAULT 4,
    "validated_capacity" INTEGER NOT NULL DEFAULT 4,
    "reserved_seats" INTEGER NOT NULL DEFAULT 0,
    "founded_seats" INTEGER NOT NULL DEFAULT 0,
    "main_resource" TEXT,
    "scarce_resources" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."sector_landing_slot" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "landing_slot_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'FREE',
    "reservation_id" TEXT,
    "colony_id" TEXT,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_landing_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."sector_reservation" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "colony_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "landing_slot_id" TEXT NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "q" INTEGER NOT NULL,
    "r" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."match_ticket" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "party_id" TEXT,
    "idempotency_key" TEXT,
    "mode" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "planet_type" TEXT NOT NULL,
    "sector_intent_kind" TEXT NOT NULL DEFAULT 'auto',
    "requested_sector_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "colony_id" TEXT NOT NULL,
    "reserved_planet_id" TEXT,
    "reserved_sector_id" TEXT,
    "reserved_landing_slot_id" TEXT,
    "reservation_epoch" INTEGER,
    "reservation_expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."party" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "leader_id" TEXT NOT NULL,
    "planet_id" TEXT,
    "sector_intent_kind" TEXT,
    "requested_sector_id" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."party_member" (
    "party_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "colony_id" TEXT,
    "reserved_sector_id" TEXT,
    "reserved_landing_slot_id" TEXT,
    "spawn_status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "party_member_pkey" PRIMARY KEY ("party_id","player_id")
);

-- CreateIndex
CREATE INDEX "planet_atlas_version_planet_id_idx" ON "core"."planet_atlas_version"("planet_id");

-- CreateIndex
CREATE UNIQUE INDEX "planet_atlas_version_planet_id_atlas_version_key" ON "core"."planet_atlas_version"("planet_id", "atlas_version");

-- CreateIndex
CREATE INDEX "planet_sector_planet_id_idx" ON "core"."planet_sector"("planet_id");

-- CreateIndex
CREATE UNIQUE INDEX "planet_sector_planet_id_sector_id_key" ON "core"."planet_sector"("planet_id", "sector_id");

-- CreateIndex
CREATE INDEX "sector_landing_slot_planet_id_sector_id_state_idx" ON "core"."sector_landing_slot"("planet_id", "sector_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "sector_landing_slot_planet_id_landing_slot_id_key" ON "core"."sector_landing_slot"("planet_id", "landing_slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "sector_landing_slot_planet_id_sector_id_slot_index_key" ON "core"."sector_landing_slot"("planet_id", "sector_id", "slot_index");

-- CreateIndex
CREATE UNIQUE INDEX "sector_reservation_ticket_id_key" ON "core"."sector_reservation"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "sector_reservation_colony_id_key" ON "core"."sector_reservation"("colony_id");

-- CreateIndex
CREATE INDEX "sector_reservation_planet_id_sector_id_state_idx" ON "core"."sector_reservation"("planet_id", "sector_id", "state");

-- CreateIndex
CREATE INDEX "sector_reservation_player_id_state_idx" ON "core"."sector_reservation"("player_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "match_ticket_colony_id_key" ON "core"."match_ticket"("colony_id");

-- CreateIndex
CREATE INDEX "match_ticket_player_id_state_idx" ON "core"."match_ticket"("player_id", "state");

-- CreateIndex
CREATE INDEX "match_ticket_state_priority_created_at_idx" ON "core"."match_ticket"("state", "priority", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "match_ticket_player_id_idempotency_key_key" ON "core"."match_ticket"("player_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "party_code_key" ON "core"."party"("code");

-- CreateIndex
CREATE INDEX "party_leader_id_idx" ON "core"."party"("leader_id");

-- CreateIndex
CREATE INDEX "party_member_player_id_idx" ON "core"."party_member"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "planet_canonical_type_key" ON "core"."planet"("canonical_type");

-- AddForeignKey
ALTER TABLE "core"."party_member" ADD CONSTRAINT "party_member_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "core"."party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
