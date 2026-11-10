-- CreateTable
CREATE TABLE "chain"."guild_visit" (
    "id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "arrives_at" TIMESTAMPTZ(3) NOT NULL,
    "subsidy" BOOLEAN NOT NULL,
    "organic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "guild_visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guild_visit_planet_id_arrives_at_idx" ON "chain"."guild_visit"("planet_id", "arrives_at");
