-- DropIndex
DROP INDEX "chain"."market_order_ref_key";

-- CreateIndex
CREATE UNIQUE INDEX "market_order_planet_id_ref_key" ON "chain"."market_order"("planet_id", "ref");
