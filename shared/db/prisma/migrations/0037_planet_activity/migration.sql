-- CreateTable
CREATE TABLE "world"."planet_activity" (
    "planet_id" TEXT NOT NULL,
    "last_human_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "dormant_since" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planet_activity_pkey" PRIMARY KEY ("planet_id")
);

-- CreateIndex
CREATE INDEX "planet_activity_dormant_since_idx" ON "world"."planet_activity"("dormant_since");
