-- Next-Gen Features Migration
-- Features: AI Code Review Documentation, Documentation Coverage CI/CD Gate, Regulatory Compliance Templates

-- ============================================================================
-- AI Code Review Documentation Tables
-- ============================================================================

-- PR Review Threads
CREATE TABLE "pr_review_threads" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "pr_title" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "file_path" TEXT,
    "line_start" INTEGER,
    "line_end" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_review_threads_pkey" PRIMARY KEY ("id")
);

-- PR Review Comments
CREATE TABLE "pr_review_comments" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "github_comment_id" INTEGER NOT NULL,
    "author_username" TEXT NOT NULL,
    "author_type" TEXT NOT NULL DEFAULT 'reviewer',
    "body" TEXT NOT NULL,
    "comment_type" TEXT NOT NULL DEFAULT 'comment',
    "in_reply_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_review_comments_pkey" PRIMARY KEY ("id")
);

-- Review Rationales (AI-extracted insights)
CREATE TABLE "review_rationales" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "decision_type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "problem_description" TEXT NOT NULL,
    "solution_chosen" TEXT NOT NULL,
    "alternatives_considered" JSONB NOT NULL DEFAULT '[]',
    "reasoning_chain" JSONB NOT NULL DEFAULT '[]',
    "impact_level" TEXT NOT NULL DEFAULT 'medium',
    "affected_files" JSONB NOT NULL DEFAULT '[]',
    "affected_components" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "is_significant" BOOLEAN NOT NULL DEFAULT false,
    "auto_generated_adr" BOOLEAN NOT NULL DEFAULT false,
    "adr_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_rationales_pkey" PRIMARY KEY ("id")
);

-- Review Knowledge Base
CREATE TABLE "review_knowledge_base" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_rationales" JSONB NOT NULL DEFAULT '[]',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "embedding" DOUBLE PRECISION[],
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_knowledge_base_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Documentation Coverage CI/CD Gate Tables
-- ============================================================================

-- Coverage Gate Configuration
CREATE TABLE "coverage_gate_configs" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "min_coverage_percent" DOUBLE PRECISION NOT NULL DEFAULT 70.0,
    "fail_on_decrease" BOOLEAN NOT NULL DEFAULT true,
    "max_decrease_percent" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "block_merge" BOOLEAN NOT NULL DEFAULT false,
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
    "include_paths" JSONB NOT NULL DEFAULT '[]',
    "exclude_paths" JSONB NOT NULL DEFAULT '[]',
    "notify_on_fail" BOOLEAN NOT NULL DEFAULT true,
    "notify_channels" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coverage_gate_configs_pkey" PRIMARY KEY ("id")
);

-- Coverage Check Runs
CREATE TABLE "coverage_check_runs" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "pr_number" INTEGER,
    "commit_sha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "github_check_run_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "conclusion" TEXT,
    "coverage_percent" DOUBLE PRECISION,
    "previous_percent" DOUBLE PRECISION,
    "coverage_change" DOUBLE PRECISION,
    "total_exports" INTEGER,
    "documented_exports" INTEGER,
    "new_undocumented" JSONB NOT NULL DEFAULT '[]',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coverage_check_runs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Regulatory Compliance Templates Tables
-- ============================================================================

-- Compliance Controls
CREATE TABLE "compliance_controls" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "control_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "implementation_guide" TEXT,
    "code_patterns" JSONB NOT NULL DEFAULT '[]',
    "doc_requirements" JSONB NOT NULL DEFAULT '[]',
    "evidence_types" JSONB NOT NULL DEFAULT '[]',
    "automated_checks" JSONB NOT NULL DEFAULT '[]',
    "priority" TEXT NOT NULL DEFAULT 'required',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_controls_pkey" PRIMARY KEY ("id")
);

-- Compliance Control Assessments
CREATE TABLE "compliance_control_assessments" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "control_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_assessed',
    "score" DOUBLE PRECISION,
    "evidence_found" JSONB NOT NULL DEFAULT '[]',
    "code_references" JSONB NOT NULL DEFAULT '[]',
    "doc_references" JSONB NOT NULL DEFAULT '[]',
    "gaps" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "remediation_steps" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_control_assessments_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- PR Review Threads indexes
CREATE UNIQUE INDEX "pr_review_threads_repository_id_pr_number_thread_id_key" ON "pr_review_threads"("repository_id", "pr_number", "thread_id");
CREATE INDEX "pr_review_threads_repository_id_pr_number_idx" ON "pr_review_threads"("repository_id", "pr_number");

-- PR Review Comments indexes
CREATE UNIQUE INDEX "pr_review_comments_github_comment_id_key" ON "pr_review_comments"("github_comment_id");
CREATE INDEX "pr_review_comments_thread_id_idx" ON "pr_review_comments"("thread_id");

-- Review Rationales indexes
CREATE UNIQUE INDEX "review_rationales_thread_id_key" ON "review_rationales"("thread_id");
CREATE INDEX "review_rationales_repository_id_pr_number_idx" ON "review_rationales"("repository_id", "pr_number");
CREATE INDEX "review_rationales_decision_type_idx" ON "review_rationales"("decision_type");
CREATE INDEX "review_rationales_is_significant_idx" ON "review_rationales"("is_significant");

-- Review Knowledge Base indexes
CREATE INDEX "review_knowledge_base_repository_id_category_idx" ON "review_knowledge_base"("repository_id", "category");
CREATE INDEX "review_knowledge_base_repository_id_is_active_idx" ON "review_knowledge_base"("repository_id", "is_active");

-- Coverage Gate Config indexes
CREATE UNIQUE INDEX "coverage_gate_configs_repository_id_key" ON "coverage_gate_configs"("repository_id");

-- Coverage Check Runs indexes
CREATE INDEX "coverage_check_runs_repository_id_commit_sha_idx" ON "coverage_check_runs"("repository_id", "commit_sha");
CREATE INDEX "coverage_check_runs_repository_id_pr_number_idx" ON "coverage_check_runs"("repository_id", "pr_number");

-- Compliance Controls indexes
CREATE UNIQUE INDEX "compliance_controls_template_id_control_id_key" ON "compliance_controls"("template_id", "control_id");
CREATE INDEX "compliance_controls_template_id_category_idx" ON "compliance_controls"("template_id", "category");

-- Compliance Control Assessments indexes
CREATE UNIQUE INDEX "compliance_control_assessments_report_id_control_id_key" ON "compliance_control_assessments"("report_id", "control_id");
CREATE INDEX "compliance_control_assessments_report_id_idx" ON "compliance_control_assessments"("report_id");

-- ============================================================================
-- Foreign Keys
-- ============================================================================

-- PR Review Threads
ALTER TABLE "pr_review_threads" ADD CONSTRAINT "pr_review_threads_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PR Review Comments
ALTER TABLE "pr_review_comments" ADD CONSTRAINT "pr_review_comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "pr_review_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Review Rationales
ALTER TABLE "review_rationales" ADD CONSTRAINT "review_rationales_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "pr_review_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Coverage Gate Config
ALTER TABLE "coverage_gate_configs" ADD CONSTRAINT "coverage_gate_configs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Compliance Controls
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "compliance_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Compliance Control Assessments
ALTER TABLE "compliance_control_assessments" ADD CONSTRAINT "compliance_control_assessments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "compliance_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_control_assessments" ADD CONSTRAINT "compliance_control_assessments_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "compliance_controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
