-- CreateTable
CREATE TABLE "core"."analytics_event" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "anon_id" UUID NOT NULL,
    "session_id" VARCHAR(64) NOT NULL,
    "props" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_event_name_ts_idx" ON "core"."analytics_event"("name", "ts");
