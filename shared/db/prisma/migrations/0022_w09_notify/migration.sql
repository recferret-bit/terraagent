-- CreateTable
CREATE TABLE "core"."notification_subscription" (
    "id" VARCHAR(80) NOT NULL,
    "player_id" VARCHAR(64) NOT NULL,
    "colony_id" VARCHAR(64),
    "channel" VARCHAR(16) NOT NULL,
    "endpoint" VARCHAR(500),
    "p256dh" VARCHAR(200),
    "auth_key" VARCHAR(64),
    "chat_id" VARCHAR(64),
    "kinds" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world"."planet_event_digest" (
    "id" BIGSERIAL NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "seen_at" TIMESTAMPTZ(3),
    "last_event_seq" BIGINT NOT NULL DEFAULT 0,
    "body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_event_digest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."mock_notify" (
    "id" BIGSERIAL NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "event_id" VARCHAR(128) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_notify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_subscription_player_id_channel_idx" ON "core"."notification_subscription"("player_id", "channel");

-- CreateIndex
CREATE INDEX "planet_event_digest_colony_id_opened_at_idx" ON "world"."planet_event_digest"("colony_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "planet_event_digest_planet_id_opened_at_idx" ON "world"."planet_event_digest"("planet_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "mock_notify_colony_id_created_at_idx" ON "core"."mock_notify"("colony_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mock_notify_colony_id_event_id_channel_key" ON "core"."mock_notify"("colony_id", "event_id", "channel");
