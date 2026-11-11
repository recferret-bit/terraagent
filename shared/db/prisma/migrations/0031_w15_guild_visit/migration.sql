-- CreateTable
CREATE TABLE "chain"."guild_visit" (
    "id" VARCHAR(160) NOT NULL,
    "npc_id" VARCHAR(32) NOT NULL,
    "ship_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "arrive_at" TIMESTAMPTZ(3) NOT NULL,
    "depart_at" TIMESTAMPTZ(3) NOT NULL,
    "offers" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'docked',
    "kind" VARCHAR(16) NOT NULL DEFAULT 'cadence',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guild_visit_npc_id_planet_id_kind_arrive_at_idx" ON "chain"."guild_visit"("npc_id", "planet_id", "kind", "arrive_at");

-- CreateIndex
CREATE INDEX "guild_visit_planet_id_status_depart_at_idx" ON "chain"."guild_visit"("planet_id", "status", "depart_at");
