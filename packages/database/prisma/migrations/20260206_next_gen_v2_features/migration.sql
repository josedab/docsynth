-- Next-Gen V2 Features Migration
-- Features: Federated Hub, PR Doc Review, Collaborative Editor, API Changelog,
--           Executive Reports, SDK Documentation

-- ============================================================================
-- Federated Documentation Hub
-- ============================================================================

CREATE TABLE "federated_hubs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "navigation_tree" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_hubs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "federated_hub_repositories" (
    "id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federated_hub_repositories_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- PR Documentation Reviews
-- ============================================================================

CREATE TABLE "pr_doc_reviews" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "pr_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "comments" JSONB NOT NULL DEFAULT '[]',
    "posted_to_scm" BOOLEAN NOT NULL DEFAULT false,
    "feedback_stats" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_doc_reviews_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Collaborative Editing Sessions
-- ============================================================================

CREATE TABLE "editing_sessions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "document_content" TEXT NOT NULL,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "operations" JSONB NOT NULL DEFAULT '[]',
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "editing_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "editing_session_comments" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" JSONB NOT NULL DEFAULT '{}',
    "parent_id" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editing_session_comments_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- API Changelogs & Breaking Change Alerts
-- ============================================================================

CREATE TABLE "api_changelogs" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "base_ref" TEXT NOT NULL,
    "head_ref" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "analysis" JSONB NOT NULL DEFAULT '{}',
    "published_to" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_changelogs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "breaking_change_subscribers" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "webhook" TEXT,
    "email" TEXT,
    "slack_channel" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breaking_change_subscribers_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Executive Reports
-- ============================================================================

CREATE TABLE "executive_reports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executive_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- SDK Documentation
-- ============================================================================

CREATE TABLE "sdk_docs" (
    "id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "content" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "examples" JSONB NOT NULL DEFAULT '[]',
    "api_spec_hash" TEXT,
    "examples_valid" BOOLEAN NOT NULL DEFAULT true,
    "published_to" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_docs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Federated Hubs
CREATE UNIQUE INDEX "federated_hubs_organization_id_slug_key" ON "federated_hubs"("organization_id", "slug");
CREATE INDEX "federated_hubs_organization_id_idx" ON "federated_hubs"("organization_id");

-- Federated Hub Repositories
CREATE UNIQUE INDEX "federated_hub_repositories_hub_id_repository_id_key" ON "federated_hub_repositories"("hub_id", "repository_id");

-- PR Doc Reviews
CREATE INDEX "pr_doc_reviews_repository_id_pr_number_idx" ON "pr_doc_reviews"("repository_id", "pr_number");

-- Editing Sessions
CREATE INDEX "editing_sessions_document_id_idx" ON "editing_sessions"("document_id");
CREATE INDEX "editing_sessions_status_idx" ON "editing_sessions"("status");

-- Editing Session Comments
CREATE INDEX "editing_session_comments_session_id_idx" ON "editing_session_comments"("session_id");

-- API Changelogs
CREATE INDEX "api_changelogs_repository_id_idx" ON "api_changelogs"("repository_id");

-- Breaking Change Subscribers
CREATE INDEX "breaking_change_subscribers_repository_id_idx" ON "breaking_change_subscribers"("repository_id");

-- Executive Reports
CREATE INDEX "executive_reports_organization_id_idx" ON "executive_reports"("organization_id");

-- Report Schedules
CREATE INDEX "report_schedules_organization_id_idx" ON "report_schedules"("organization_id");
CREATE INDEX "report_schedules_next_run_at_idx" ON "report_schedules"("next_run_at");

-- SDK Docs
CREATE UNIQUE INDEX "sdk_docs_repository_id_language_key" ON "sdk_docs"("repository_id", "language");
CREATE INDEX "sdk_docs_repository_id_idx" ON "sdk_docs"("repository_id");

-- ============================================================================
-- Foreign Keys
-- ============================================================================

-- Federated Hub Repositories
ALTER TABLE "federated_hub_repositories" ADD CONSTRAINT "federated_hub_repositories_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "federated_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Editing Session Comments
ALTER TABLE "editing_session_comments" ADD CONSTRAINT "editing_session_comments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "editing_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
