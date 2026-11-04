-- AlterTable
ALTER TABLE "core"."colony" ADD COLUMN     "stage" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "core"."progression_inbox" (
    "id" TEXT NOT NULL,
    "planet_id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."progression_epoch" (
    "planet_id" TEXT NOT NULL,
    "epoch" TEXT NOT NULL,

    CONSTRAINT "progression_epoch_pkey" PRIMARY KEY ("planet_id")
);

-- CreateTable
CREATE TABLE "core"."player_notification" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progression_inbox_planet_id_tick_idx" ON "core"."progression_inbox"("planet_id", "tick");

-- CreateIndex
CREATE INDEX "player_notification_player_id_created_at_idx" ON "core"."player_notification"("player_id", "created_at");
