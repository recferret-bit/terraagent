-- CreateTable
CREATE TABLE "chain"."director_key" (
    "colony_id" VARCHAR(64) NOT NULL,
    "account_id" VARCHAR(64) NOT NULL,
    "public_key" VARCHAR(128) NOT NULL,
    "allowance" DECIMAL(78,0) NOT NULL,
    "spent" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "tokens" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "director_key_pkey" PRIMARY KEY ("colony_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "director_key_public_key_key" ON "chain"."director_key"("public_key");
