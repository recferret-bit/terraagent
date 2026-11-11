-- CreateTable
CREATE TABLE "chain"."guild_funding" (
    "scope" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "allocation_id" VARCHAR(96),
    "cash_cap_atomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "cash_reserved_atomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "cash_spent_atomic" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "inventory_cap_units" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "inventory_reserved" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "inventory_spent" DECIMAL(78,0) NOT NULL DEFAULT 0,
    "killed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_funding_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE UNIQUE INDEX "guild_funding_allocation_id_key" ON "chain"."guild_funding"("allocation_id");
