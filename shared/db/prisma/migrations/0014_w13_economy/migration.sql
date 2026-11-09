-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "economy";

-- CreateTable
CREATE TABLE "economy"."profile" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "current_version" INTEGER,
    "draft_version" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."profile_version" (
    "id" VARCHAR(64) NOT NULL,
    "profile_id" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "parent_id" VARCHAR(64),
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "schema_version" INTEGER NOT NULL,
    "engine_compatibility" VARCHAR(80) NOT NULL,
    "content_hash" VARCHAR(80) NOT NULL,
    "author" VARCHAR(120) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "regions" JSONB NOT NULL DEFAULT '{}',
    "logistics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),

    CONSTRAINT "profile_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."parameter" (
    "version_id" VARCHAR(64) NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "value" JSONB NOT NULL,
    "unit" VARCHAR(24) NOT NULL,

    CONSTRAINT "parameter_pkey" PRIMARY KEY ("version_id","path")
);

-- CreateTable
CREATE TABLE "economy"."recipe" (
    "version_id" VARCHAR(64) NOT NULL,
    "recipe_id" VARCHAR(80) NOT NULL,
    "activity_kind" VARCHAR(80) NOT NULL,
    "duration_ticks" INTEGER NOT NULL,
    "eligibility" JSONB NOT NULL DEFAULT '[]',
    "output" JSONB NOT NULL,
    "enabled_wave" VARCHAR(3) NOT NULL,

    CONSTRAINT "recipe_pkey" PRIMARY KEY ("version_id","recipe_id")
);

-- CreateTable
CREATE TABLE "economy"."recipe_input" (
    "version_id" VARCHAR(64) NOT NULL,
    "recipe_id" VARCHAR(80) NOT NULL,
    "resource_key" VARCHAR(16) NOT NULL,
    "amount_atomic" DECIMAL(78,0) NOT NULL,

    CONSTRAINT "recipe_input_pkey" PRIMARY KEY ("version_id","recipe_id","resource_key")
);

-- CreateTable
CREATE TABLE "economy"."resource_policy" (
    "version_id" VARCHAR(64) NOT NULL,
    "resource_key" VARCHAR(16) NOT NULL,
    "sources" TEXT[],
    "consumers" TEXT[],
    "producer_cohorts" TEXT[],
    "buyer_cohorts" TEXT[],
    "reserve_horizon_ticks" INTEGER NOT NULL,
    "target_lo_bp" INTEGER NOT NULL,
    "target_hi_bp" INTEGER NOT NULL,

    CONSTRAINT "resource_policy_pkey" PRIMARY KEY ("version_id","resource_key")
);

-- CreateTable
CREATE TABLE "economy"."market_policy" (
    "version_id" VARCHAR(64) NOT NULL,
    "pair_id" VARCHAR(48) NOT NULL,
    "token_metadata_ref" VARCHAR(16) NOT NULL,
    "platform_fee_bp" INTEGER NOT NULL,
    "stall_fee_bp" INTEGER NOT NULL,
    "lot_units" DECIMAL(78,0) NOT NULL,
    "tick_atomic" DECIMAL(78,0) NOT NULL,
    "min_notional_atomic" DECIMAL(78,0) NOT NULL,
    "treasury_share_bp" INTEGER NOT NULL,

    CONSTRAINT "market_policy_pkey" PRIMARY KEY ("version_id","pair_id")
);

-- CreateTable
CREATE TABLE "economy"."agent_policy" (
    "version_id" VARCHAR(64) NOT NULL,
    "actor_id" VARCHAR(80) NOT NULL,
    "targets" JSONB NOT NULL DEFAULT '{}',
    "cash_limit_atomic" DECIMAL(78,0) NOT NULL,
    "spend_limit_atomic" DECIMAL(78,0) NOT NULL,
    "loss_limit_atomic" DECIMAL(78,0) NOT NULL,
    "inventory_limits" JSONB NOT NULL DEFAULT '{}',
    "reference_window_ticks" INTEGER NOT NULL,

    CONSTRAINT "agent_policy_pkey" PRIMARY KEY ("version_id","actor_id")
);

-- CreateTable
CREATE TABLE "economy"."activation" (
    "id" VARCHAR(64) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "version_id" VARCHAR(64) NOT NULL,
    "previous_id" VARCHAR(64),
    "requested_tick" BIGINT,
    "applied_tick" BIGINT,
    "state" VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    "operator" VARCHAR(120) NOT NULL,
    "evidence_run_id" VARCHAR(64),
    "payload_hash" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."audit_event" (
    "id" BIGSERIAL NOT NULL,
    "actor" VARCHAR(120) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "version_id" VARCHAR(64),
    "request_id" VARCHAR(120) NOT NULL,
    "diff" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."scenario" (
    "id" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "hash" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_pkey" PRIMARY KEY ("id","version")
);

-- CreateTable
CREATE TABLE "economy"."experiment" (
    "id" VARCHAR(64) NOT NULL,
    "request_id" VARCHAR(120) NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifest_hash" VARCHAR(80) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'queued',
    "lease_owner" VARCHAR(120),
    "lease_expires_at" TIMESTAMPTZ(3),
    "progress" JSONB NOT NULL DEFAULT '{}',
    "failure" VARCHAR(2000),
    "parent_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."experiment_run" (
    "id" VARCHAR(64) NOT NULL,
    "experiment_id" VARCHAR(64) NOT NULL,
    "candidate_id" VARCHAR(64) NOT NULL,
    "scenario_id" VARCHAR(80) NOT NULL,
    "scenario_version" INTEGER NOT NULL,
    "seed" BIGINT NOT NULL,
    "hashes" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(12) NOT NULL DEFAULT 'queued',
    "artifact_refs" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."metric" (
    "id" BIGSERIAL NOT NULL,
    "run_id" VARCHAR(64) NOT NULL,
    "window_start_tick" BIGINT NOT NULL,
    "window_end_tick" BIGINT NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "resource_key" VARCHAR(16),
    "pair" VARCHAR(48),
    "cohort" VARCHAR(80),
    "metric_key" VARCHAR(80) NOT NULL,
    "value" DECIMAL,
    "reason" VARCHAR(120),
    "unit" VARCHAR(24) NOT NULL,

    CONSTRAINT "metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."gate_result" (
    "id" BIGSERIAL NOT NULL,
    "run_id" VARCHAR(64) NOT NULL,
    "gate_id" VARCHAR(80) NOT NULL,
    "gate_version" INTEGER NOT NULL,
    "outcome" VARCHAR(20) NOT NULL,
    "observed" DECIMAL,
    "threshold" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profile_name_key" ON "economy"."profile"("name");

-- CreateIndex
CREATE INDEX "profile_version_content_hash_idx" ON "economy"."profile_version"("content_hash");

-- CreateIndex
CREATE INDEX "profile_version_parent_id_idx" ON "economy"."profile_version"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_version_profile_id_version_key" ON "economy"."profile_version"("profile_id", "version");

-- CreateIndex
CREATE INDEX "activation_scope_state_idx" ON "economy"."activation"("scope", "state");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_request_id_key" ON "economy"."audit_event"("request_id");

-- CreateIndex
CREATE INDEX "audit_event_version_id_created_at_idx" ON "economy"."audit_event"("version_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_request_id_key" ON "economy"."experiment"("request_id");

-- CreateIndex
CREATE INDEX "experiment_status_lease_expires_at_idx" ON "economy"."experiment"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_run_experiment_id_candidate_id_scenario_id_scena_key" ON "economy"."experiment_run"("experiment_id", "candidate_id", "scenario_id", "scenario_version", "seed");

-- CreateIndex
CREATE INDEX "metric_run_id_window_start_tick_metric_key_idx" ON "economy"."metric"("run_id", "window_start_tick", "metric_key");

-- CreateIndex
CREATE UNIQUE INDEX "gate_result_run_id_gate_id_gate_version_key" ON "economy"."gate_result"("run_id", "gate_id", "gate_version");

-- AddForeignKey
ALTER TABLE "economy"."profile_version" ADD CONSTRAINT "profile_version_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "economy"."profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."profile_version" ADD CONSTRAINT "profile_version_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "economy"."profile_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."parameter" ADD CONSTRAINT "parameter_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."recipe" ADD CONSTRAINT "recipe_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."recipe_input" ADD CONSTRAINT "recipe_input_version_id_recipe_id_fkey" FOREIGN KEY ("version_id", "recipe_id") REFERENCES "economy"."recipe"("version_id", "recipe_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."resource_policy" ADD CONSTRAINT "resource_policy_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."market_policy" ADD CONSTRAINT "market_policy_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."agent_policy" ADD CONSTRAINT "agent_policy_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."activation" ADD CONSTRAINT "activation_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."activation" ADD CONSTRAINT "activation_previous_id_fkey" FOREIGN KEY ("previous_id") REFERENCES "economy"."activation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."activation" ADD CONSTRAINT "activation_evidence_run_id_fkey" FOREIGN KEY ("evidence_run_id") REFERENCES "economy"."experiment_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."audit_event" ADD CONSTRAINT "audit_event_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "economy"."profile_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."experiment" ADD CONSTRAINT "experiment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "economy"."experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."experiment_run" ADD CONSTRAINT "experiment_run_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "economy"."experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."experiment_run" ADD CONSTRAINT "experiment_run_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "economy"."profile_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."experiment_run" ADD CONSTRAINT "experiment_run_scenario_id_scenario_version_fkey" FOREIGN KEY ("scenario_id", "scenario_version") REFERENCES "economy"."scenario"("id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."metric" ADD CONSTRAINT "metric_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "economy"."experiment_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."gate_result" ADD CONSTRAINT "gate_result_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "economy"."experiment_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================================================
-- Hand-written (Prisma cannot express these): CHECK constraints, partial unique index, immutability triggers.
-- ============================================================================================================

-- Closed value sets and ranges.
ALTER TABLE "economy"."profile_version"
  ADD CONSTRAINT "profile_version_status_check" CHECK ("status" IN ('DRAFT', 'VALIDATED', 'APPROVED')),
  ADD CONSTRAINT "profile_version_version_check" CHECK ("version" > 0 AND "revision" > 0 AND "schema_version" > 0);

ALTER TABLE "economy"."recipe"
  ADD CONSTRAINT "recipe_duration_check" CHECK ("duration_ticks" >= 0);

ALTER TABLE "economy"."recipe_input"
  ADD CONSTRAINT "recipe_input_amount_check" CHECK ("amount_atomic" >= 0),
  ADD CONSTRAINT "recipe_input_resource_check" CHECK ("resource_key" IN ('metals.t1','metals.t2','metals.t3','minerals.t1','minerals.t2','minerals.t3','bio.water','bio.biomass','bio.t2','bio.t3'));

ALTER TABLE "economy"."resource_policy"
  ADD CONSTRAINT "resource_policy_resource_check" CHECK ("resource_key" IN ('metals.t1','metals.t2','metals.t3','minerals.t1','minerals.t2','minerals.t3','bio.water','bio.biomass','bio.t2','bio.t3')),
  ADD CONSTRAINT "resource_policy_band_check" CHECK ("target_lo_bp" BETWEEN 0 AND 10000 AND "target_hi_bp" BETWEEN 0 AND 10000 AND "target_lo_bp" <= "target_hi_bp"),
  ADD CONSTRAINT "resource_policy_horizon_check" CHECK ("reserve_horizon_ticks" >= 0);

ALTER TABLE "economy"."market_policy"
  ADD CONSTRAINT "market_policy_bp_check" CHECK ("platform_fee_bp" BETWEEN 0 AND 10000 AND "stall_fee_bp" BETWEEN 0 AND 10000 AND "treasury_share_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "market_policy_amount_check" CHECK ("lot_units" > 0 AND "tick_atomic" > 0 AND "min_notional_atomic" >= 0);

ALTER TABLE "economy"."agent_policy"
  ADD CONSTRAINT "agent_policy_amount_check" CHECK ("cash_limit_atomic" >= 0 AND "spend_limit_atomic" >= 0 AND "loss_limit_atomic" >= 0),
  ADD CONSTRAINT "agent_policy_window_check" CHECK ("reference_window_ticks" > 0);

ALTER TABLE "economy"."activation"
  ADD CONSTRAINT "activation_state_check" CHECK ("state" IN ('PENDING', 'ACTIVE', 'SUPERSEDED', 'FAILED'));

-- One ACTIVE version per scope (ECONOMY §5).
CREATE UNIQUE INDEX "activation_one_active_per_scope" ON "economy"."activation" ("scope") WHERE "state" = 'ACTIVE';

ALTER TABLE "economy"."experiment"
  ADD CONSTRAINT "experiment_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'incomplete'));

ALTER TABLE "economy"."experiment_run"
  ADD CONSTRAINT "experiment_run_status_check" CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'incomplete'));

ALTER TABLE "economy"."metric"
  ADD CONSTRAINT "metric_value_reason_check" CHECK ("value" IS NOT NULL OR ("reason" IS NOT NULL AND "reason" <> '')),
  ADD CONSTRAINT "metric_window_check" CHECK ("window_start_tick" >= 0 AND "window_end_tick" >= "window_start_tick"),
  ADD CONSTRAINT "metric_resource_check" CHECK ("resource_key" IS NULL OR "resource_key" IN ('metals.t1','metals.t2','metals.t3','minerals.t1','minerals.t2','minerals.t3','bio.water','bio.biomass','bio.t2','bio.t3'));

ALTER TABLE "economy"."gate_result"
  ADD CONSTRAINT "gate_result_outcome_check" CHECK ("outcome" IN ('pass', 'fail', 'insufficient_data'));

-- Immutable versions: the content columns of a non-DRAFT version never change; its status only moves forward
-- (DRAFT -> VALIDATED -> APPROVED); only a DRAFT can be deleted. Clone to edit.
CREATE FUNCTION "economy"."guard_profile_version"() RETURNS trigger LANGUAGE plpgsql AS $$
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
       OR NEW."regions"::text IS DISTINCT FROM OLD."regions"::text OR NEW."logistics"::text IS DISTINCT FROM OLD."logistics"::text
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

CREATE TRIGGER "profile_version_guard" BEFORE UPDATE OR DELETE ON "economy"."profile_version"
  FOR EACH ROW EXECUTE FUNCTION "economy"."guard_profile_version"();

-- Child rows of a non-DRAFT version cannot be inserted, updated or deleted. A missing parent (cascade delete of a
-- DRAFT) is allowed; the FK guards inserts.
CREATE FUNCTION "economy"."guard_version_children"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  vid text;
  st text;
BEGIN
  vid := CASE WHEN TG_OP = 'DELETE' THEN OLD."version_id" ELSE NEW."version_id" END;
  SELECT "status" INTO st FROM "economy"."profile_version" WHERE "id" = vid;
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'economy: version % is % and immutable; % on %.% rejected', vid, st, TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."version_id" IS DISTINCT FROM OLD."version_id" THEN
    RAISE EXCEPTION 'economy: a child row cannot move to another version' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "parameter_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."parameter" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "recipe_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."recipe" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "recipe_input_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."recipe_input" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "resource_policy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."resource_policy" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "market_policy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."market_policy" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();
CREATE TRIGGER "agent_policy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "economy"."agent_policy" FOR EACH ROW EXECUTE FUNCTION "economy"."guard_version_children"();

-- Append-only audit log.
CREATE FUNCTION "economy"."reject_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'economy: % is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "economy"."audit_event" FOR EACH ROW EXECUTE FUNCTION "economy"."reject_mutation"();
-- Scenarios are immutable once stored.
CREATE TRIGGER "scenario_immutable" BEFORE UPDATE ON "economy"."scenario" FOR EACH ROW EXECUTE FUNCTION "economy"."reject_mutation"();
