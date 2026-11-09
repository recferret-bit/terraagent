-- W16 director persistence (AI §10). The `ai` schema already exists from 0001_init.

CREATE TABLE "ai"."director_policy" (
    "colony_id" VARCHAR(64) NOT NULL,
    "planet_id" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "director_policy_pkey" PRIMARY KEY ("colony_id")
);

CREATE TABLE "ai"."director_context" (
    "id" VARCHAR(80) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "epoch" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_context_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai"."director_proposal" (
    "request_id" VARCHAR(80) NOT NULL,
    "job_id" VARCHAR(80) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "fence" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "intent_revision" INTEGER NOT NULL,
    "permission_revision" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "document" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_proposal_pkey" PRIMARY KEY ("request_id")
);

CREATE TABLE "ai"."director_action_result" (
    "id" VARCHAR(80) NOT NULL,
    "request_id" VARCHAR(80) NOT NULL,
    "action_id" VARCHAR(64) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "state" VARCHAR(32) NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_action_result_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai"."director_attempt" (
    "id" VARCHAR(80) NOT NULL,
    "job_id" VARCHAR(80) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(32) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "reserved_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai"."director_decision" (
    "id" VARCHAR(80) NOT NULL,
    "colony_id" VARCHAR(64) NOT NULL,
    "request_id" VARCHAR(80),
    "outcome" VARCHAR(32) NOT NULL,
    "summary" VARCHAR(400) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "director_decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai"."director_kill_switch" (
    "scope" VARCHAR(96) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "director_kill_switch_pkey" PRIMARY KEY ("scope")
);

CREATE TABLE "ai"."director_budget_day" (
    "id" VARCHAR(96) NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "reserved_tokens" INTEGER NOT NULL DEFAULT 0,
    "spent_tokens" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "director_budget_day_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "director_policy_planet_id_idx" ON "ai"."director_policy"("planet_id");
CREATE INDEX "director_context_colony_id_expires_at_idx" ON "ai"."director_context"("colony_id", "expires_at");
CREATE UNIQUE INDEX "director_proposal_job_id_fence_key" ON "ai"."director_proposal"("job_id", "fence");
CREATE INDEX "director_proposal_colony_id_status_idx" ON "ai"."director_proposal"("colony_id", "status");
CREATE UNIQUE INDEX "director_action_result_request_id_action_id_key" ON "ai"."director_action_result"("request_id", "action_id");
CREATE INDEX "director_action_result_colony_id_created_at_idx" ON "ai"."director_action_result"("colony_id", "created_at");
CREATE INDEX "director_attempt_colony_id_created_at_idx" ON "ai"."director_attempt"("colony_id", "created_at");
CREATE INDEX "director_decision_expires_at_idx" ON "ai"."director_decision"("expires_at");
CREATE INDEX "director_decision_colony_id_created_at_idx" ON "ai"."director_decision"("colony_id", "created_at");
CREATE INDEX "director_budget_day_day_idx" ON "ai"."director_budget_day"("day");
