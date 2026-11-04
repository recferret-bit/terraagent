-- AlterTable
ALTER TABLE "economy"."profile_version" DROP COLUMN "logistics",
DROP COLUMN "regions";

-- CreateTable
CREATE TABLE "economy"."region_profile" (
    "version_id" VARCHAR(64) NOT NULL,
    "region_profile_id" VARCHAR(64) NOT NULL,
    "sector_archetype" VARCHAR(64) NOT NULL DEFAULT '',
    "deposit_density_per_1000_tiles" INTEGER,
    "main_resource" VARCHAR(32),

    CONSTRAINT "region_profile_pkey" PRIMARY KEY ("version_id","region_profile_id")
);

-- CreateTable
CREATE TABLE "economy"."region_resource" (
    "version_id" VARCHAR(64) NOT NULL,
    "region_profile_id" VARCHAR(64) NOT NULL,
    "resource_key" VARCHAR(32) NOT NULL,
    "occurrence_weight_bp" INTEGER,
    "reserve_units_min" BIGINT,
    "reserve_units_max" BIGINT,
    "terraform_find_weight_bp" INTEGER,
    "starter_guarantee" BIGINT,
    "extraction_yield_bp" INTEGER,
    "renewable_units_per_sim_hour" BIGINT,

    CONSTRAINT "region_resource_pkey" PRIMARY KEY ("version_id","region_profile_id","resource_key")
);

-- CreateTable
CREATE TABLE "economy"."scope_binding" (
    "version_id" VARCHAR(64) NOT NULL,
    "scope_kind" VARCHAR(16) NOT NULL,
    "planet_type" VARCHAR(60) NOT NULL DEFAULT '',
    "planet_id" VARCHAR(64) NOT NULL DEFAULT '',
    "sector_id" VARCHAR(64) NOT NULL DEFAULT '',
    "archetype" VARCHAR(64) NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "region_profile_id" VARCHAR(64) NOT NULL,

    CONSTRAINT "scope_binding_pkey" PRIMARY KEY ("version_id","scope_kind","planet_type","planet_id","sector_id","archetype","priority")
);

-- CreateTable
CREATE TABLE "economy"."logistics_policy" (
    "version_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "subject_id" VARCHAR(80) NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "load_weight_milli" BIGINT NOT NULL,
    "throughput_milli" BIGINT,
    "reach_tiles" INTEGER,
    "base_consumption" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "logistics_policy_pkey" PRIMARY KEY ("version_id","kind","subject_id","tier")
);

-- AddForeignKey
ALTER TABLE "economy"."region_profile" ADD CONSTRAINT "region_profile_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."region_resource" ADD CONSTRAINT "region_resource_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."region_resource" ADD CONSTRAINT "region_resource_version_id_region_profile_id_fkey" FOREIGN KEY ("version_id", "region_profile_id") REFERENCES "economy"."region_profile"("version_id", "region_profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."scope_binding" ADD CONSTRAINT "scope_binding_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."scope_binding" ADD CONSTRAINT "scope_binding_version_id_region_profile_id_fkey" FOREIGN KEY ("version_id", "region_profile_id") REFERENCES "economy"."region_profile"("version_id", "region_profile_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."logistics_policy" ADD CONSTRAINT "logistics_policy_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written (Prisma cannot express these): CHECK constraints and immutability triggers (W13-50).
-- ============================================================================================================

ALTER TABLE "economy"."region_profile"
  ADD CONSTRAINT "region_profile_density_check" CHECK ("deposit_density_per_1000_tiles" IS NULL OR "deposit_density_per_1000_tiles" >= 0),
  ADD CONSTRAINT "region_profile_main_resource_check" CHECK ("main_resource" IS NULL OR "main_resource" IN ('metals.t1','metals.t2','metals.t3','minerals.t1','minerals.t2','minerals.t3','bio.water','bio.biomass','bio.t2','bio.t3'));

ALTER TABLE "economy"."region_resource"
  ADD CONSTRAINT "region_resource_key_check" CHECK ("resource_key" IN ('metals.t1','metals.t2','metals.t3','minerals.t1','minerals.t2','minerals.t3','bio.water','bio.biomass','bio.t2','bio.t3')),
  ADD CONSTRAINT "region_resource_bp_check" CHECK (
    ("occurrence_weight_bp" IS NULL OR "occurrence_weight_bp" BETWEEN 0 AND 1000000)
    AND ("terraform_find_weight_bp" IS NULL OR "terraform_find_weight_bp" BETWEEN 0 AND 1000000)
    AND ("extraction_yield_bp" IS NULL OR "extraction_yield_bp" BETWEEN 0 AND 1000000)),
  ADD CONSTRAINT "region_resource_amount_check" CHECK (
    ("reserve_units_min" IS NULL OR "reserve_units_min" >= 0) AND ("reserve_units_max" IS NULL OR "reserve_units_max" >= 0)
    AND ("starter_guarantee" IS NULL OR "starter_guarantee" >= 0) AND ("renewable_units_per_sim_hour" IS NULL OR "renewable_units_per_sim_hour" >= 0)),
  ADD CONSTRAINT "region_resource_reserve_order_check" CHECK ("reserve_units_min" IS NULL OR "reserve_units_max" IS NULL OR "reserve_units_min" <= "reserve_units_max");

ALTER TABLE "economy"."scope_binding"
  ADD CONSTRAINT "scope_binding_kind_check" CHECK ("scope_kind" IN ('planetType', 'planetId', 'sectorArchetype', 'sectorId')),
  ADD CONSTRAINT "scope_binding_priority_check" CHECK ("priority" BETWEEN 0 AND 1000),
  -- the column the kind is named after must be set
  ADD CONSTRAINT "scope_binding_required_scope_check" CHECK (
    ("scope_kind" = 'planetType' AND "planet_type" <> '') OR ("scope_kind" = 'planetId' AND "planet_id" <> '')
    OR ("scope_kind" = 'sectorArchetype' AND "archetype" <> '') OR ("scope_kind" = 'sectorId' AND "sector_id" <> ''));

ALTER TABLE "economy"."logistics_policy"
  ADD CONSTRAINT "logistics_policy_kind_check" CHECK ("kind" IN ('building', 'unit', 'node')),
  ADD CONSTRAINT "logistics_policy_amount_check" CHECK ("tier" BETWEEN 0 AND 10 AND "load_weight_milli" >= 0 AND ("throughput_milli" IS NULL OR "throughput_milli" >= 0) AND ("reach_tiles" IS NULL OR "reach_tiles" >= 0)),
  -- only supply nodes carry capacity and reach, and every node must
  ADD CONSTRAINT "logistics_policy_node_check" CHECK (("kind" = 'node') = ("throughput_milli" IS NOT NULL AND "reach_tiles" IS NOT NULL) AND ("kind" = 'node' OR ("throughput_milli" IS NULL AND "reach_tiles" IS NULL)));

-- The regions/logistics JSONB placeholders are gone: the guard no longer compares them.
CREATE OR REPLACE FUNCTION "economy"."guard_profile_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'economy: version % is % and immutable; it cannot be deleted', OLD."id", OLD."status" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."profile_id" IS DISTINCT FROM OLD."profile_id" OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id" OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
       OR NEW."engine_compatibility" IS DISTINCT FROM OLD."engine_compatibility" OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
       OR NEW."author" IS DISTINCT FROM OLD."author" OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
       OR NEW."revision" IS DISTINCT FROM OLD."revision" THEN
      RAISE EXCEPTION 'economy: version % is % and immutable; clone it to edit', OLD."id", OLD."status" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT
     ((OLD."status" = 'DRAFT' AND NEW."status" = 'VALIDATED') OR (OLD."status" = 'VALIDATED' AND NEW."status" = 'APPROVED')) THEN
    RAISE EXCEPTION 'economy: illegal status transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "region_profile_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."region_profile" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "region_resource_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."region_resource" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "scope_binding_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."scope_binding" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "logistics_policy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."logistics_policy" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
