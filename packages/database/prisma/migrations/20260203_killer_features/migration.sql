-- Migration: Add 7 killer documentation features
-- Features: Drift Prediction, Onboarding Paths, Review Workflows, Playgrounds, Multi-Agent, Citations

-- ============================================================================
-- Drift Predictions
-- ============================================================================

CREATE TABLE IF NOT EXISTS "drift_predictions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "drift_probability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signals" JSONB NOT NULL DEFAULT '{}',
    "code_changes_detected" INTEGER NOT NULL DEFAULT 0,
    "api_changes_detected" INTEGER NOT NULL DEFAULT 0,
    "dependency_changes_detected" INTEGER NOT NULL DEFAULT 0,
    "time_since_update_days" INTEGER NOT NULL DEFAULT 0,
    "predicted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "drift_predictions_repository_id_status_idx" ON "drift_predictions"("repository_id", "status");
CREATE INDEX IF NOT EXISTS "drift_predictions_repository_id_drift_probability_idx" ON "drift_predictions"("repository_id", "drift_probability");
CREATE INDEX IF NOT EXISTS "drift_predictions_document_id_idx" ON "drift_predictions"("document_id");

-- ============================================================================
-- Onboarding Paths (Personalized Developer Onboarding)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "onboarding_paths" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_role" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'beginner',
    "estimated_hours" DOUBLE PRECISION NOT NULL,
    "prerequisites" JSONB NOT NULL DEFAULT '[]',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "onboarding_paths_repository_id_target_role_idx" ON "onboarding_paths"("repository_id", "target_role");

CREATE TABLE IF NOT EXISTS "onboarding_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "step_type" TEXT NOT NULL,
    "content_id" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "estimated_mins" INTEGER NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_steps_path_id_fkey" FOREIGN KEY ("path_id") REFERENCES "onboarding_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "onboarding_steps_path_id_order_index_idx" ON "onboarding_steps"("path_id", "order_index");

CREATE TABLE IF NOT EXISTS "onboarding_path_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "current_step_idx" INTEGER NOT NULL DEFAULT 0,
    "completed_steps" JSONB NOT NULL DEFAULT '[]',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "onboarding_path_progress_path_id_fkey" FOREIGN KEY ("path_id") REFERENCES "onboarding_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_path_progress_path_id_user_id_key" ON "onboarding_path_progress"("path_id", "user_id");
CREATE INDEX IF NOT EXISTS "onboarding_path_progress_user_id_idx" ON "onboarding_path_progress"("user_id");

-- ============================================================================
-- Collaborative Review Workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS "doc_review_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "review_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "doc_review_requests_repository_id_status_idx" ON "doc_review_requests"("repository_id", "status");
CREATE INDEX IF NOT EXISTS "doc_review_requests_document_id_idx" ON "doc_review_requests"("document_id");

CREATE TABLE IF NOT EXISTS "review_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "review_request_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decision" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "review_assignments_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "doc_review_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_assignments_review_request_id_reviewer_id_key" ON "review_assignments"("review_request_id", "reviewer_id");

CREATE TABLE IF NOT EXISTS "review_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "review_request_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "line_start" INTEGER,
    "line_end" INTEGER,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "review_comments_review_request_id_fkey" FOREIGN KEY ("review_request_id") REFERENCES "doc_review_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "review_comments_review_request_id_idx" ON "review_comments"("review_request_id");

-- ============================================================================
-- Interactive Playgrounds
-- ============================================================================

CREATE TABLE IF NOT EXISTS "playgrounds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "document_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "runtime" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'blank',
    "files" JSONB NOT NULL DEFAULT '{}',
    "dependencies" JSONB NOT NULL DEFAULT '{}',
    "environment" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "playgrounds_repository_id_idx" ON "playgrounds"("repository_id");
CREATE INDEX IF NOT EXISTS "playgrounds_document_id_idx" ON "playgrounds"("document_id");

CREATE TABLE IF NOT EXISTS "playground_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playground_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "last_run_at" TIMESTAMP(3),
    "last_output" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "playground_sessions_playground_id_fkey" FOREIGN KEY ("playground_id") REFERENCES "playgrounds"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "playground_sessions_user_id_idx" ON "playground_sessions"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "playground_sessions_playground_id_user_id_key" ON "playground_sessions"("playground_id", "user_id");

-- ============================================================================
-- Multi-Agent Documentation System
-- ============================================================================

CREATE TABLE IF NOT EXISTS "agent_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "document_id" TEXT,
    "run_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_runs_repository_id_status_idx" ON "agent_runs"("repository_id", "status");

CREATE TABLE IF NOT EXISTS "agent_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "agent_tasks_run_id_agent_type_idx" ON "agent_tasks"("run_id", "agent_type");

-- ============================================================================
-- Citation Index (Smart Search with Citations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "citation_indices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "source_type" TEXT NOT NULL DEFAULT 'documentation',
    "source_path" TEXT,
    "source_line_start" INTEGER,
    "source_line_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "citation_indices_repository_id_idx" ON "citation_indices"("repository_id");
CREATE UNIQUE INDEX IF NOT EXISTS "citation_indices_document_id_chunk_index_key" ON "citation_indices"("document_id", "chunk_index");
