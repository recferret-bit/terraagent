-- CreateTable
CREATE TABLE "core"."player" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "device_secret_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."auth_session" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."planet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'temperate',
    "seed" TEXT NOT NULL DEFAULT 'dev',
    "state" TEXT NOT NULL DEFAULT 'RECRUITING',
    "capacity" INTEGER NOT NULL DEFAULT 5,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."colony" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "colony_index" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "spawn_q" INTEGER NOT NULL DEFAULT 0,
    "spawn_r" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "colony_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_handle_key" ON "core"."player"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "player_device_secret_hash_key" ON "core"."player"("device_secret_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refresh_token_hash_key" ON "core"."auth_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_session_player_id_idx" ON "core"."auth_session"("player_id");

-- CreateIndex
CREATE INDEX "colony_player_id_idx" ON "core"."colony"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "colony_planet_id_colony_index_key" ON "core"."colony"("planet_id", "colony_index");

-- AddForeignKey
ALTER TABLE "core"."auth_session" ADD CONSTRAINT "auth_session_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "core"."player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
