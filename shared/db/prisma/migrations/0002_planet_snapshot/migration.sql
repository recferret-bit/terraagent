-- CreateEnum
CREATE TYPE "world"."SnapshotKind" AS ENUM ('PERIODIC', 'SHUTDOWN', 'SEAL', 'END', 'HOURLY');

-- CreateTable
CREATE TABLE "world"."planet_snapshot" (
    "id" BIGSERIAL NOT NULL,
    "planet_id" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "sim_version" INTEGER NOT NULL,
    "codec" VARCHAR(16) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "raw_bytes" INTEGER NOT NULL,
    "crc32" INTEGER NOT NULL,
    "kind" "world"."SnapshotKind" NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planet_snapshot_planet_id_tick_idx" ON "world"."planet_snapshot"("planet_id", "tick" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "planet_snapshot_planet_id_tick_key" ON "world"."planet_snapshot"("planet_id", "tick");

-- DATA_MODEL §7: snapshot bytes are already gzip-compressed, skip TOAST compression.
ALTER TABLE "world"."planet_snapshot" ALTER COLUMN "data" SET STORAGE EXTERNAL;
-- NOTE: the FK planet_snapshot_planet_fk -> core.planet(id) (DATA_MODEL §7) is intentionally omitted: core.planet
-- does not exist until the lobby wave, which adds it in its own migration.
