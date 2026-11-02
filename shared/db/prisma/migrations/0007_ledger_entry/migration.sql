-- CreateTable
CREATE TABLE "world"."ledger_entry" (
    "planet_id" TEXT NOT NULL,
    "tick" BIGINT NOT NULL,
    "idx" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "ref" TEXT,
    "legs" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("planet_id","tick","idx")
);
