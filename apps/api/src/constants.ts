/**
 * API Constants
 * Centralized configuration values for pagination, limits, and AI model settings
 */

// ============================================================================
// Pagination Defaults
// ============================================================================

/** Default number of items per page for list endpoints */
export const DEFAULT_PAGE_SIZE = 20;

/** Default page size for dashboard/analytics views */
export const DEFAULT_DASHBOARD_PAGE_SIZE = 10;

/** Maximum allowed page size */
export const MAX_PAGE_SIZE = 100;

/** Default page size for search results */
export const DEFAULT_SEARCH_LIMIT = 50;

/** Default limit for leaderboard entries */
export const DEFAULT_LEADERBOARD_LIMIT = 10;

/** Default limit for analytics summaries */
export const DEFAULT_ANALYTICS_SUMMARY_LIMIT = 12;

// ============================================================================
// Content Limits
// ============================================================================

/** Maximum content length for AI processing (characters) */
export const MAX_AI_CONTENT_LENGTH = 8000;

/** Maximum content length for context snippets */
export const MAX_CONTEXT_LENGTH = 3000;

/** Maximum content length for document snippets in summaries */
export const MAX_SNIPPET_LENGTH = 1000;

/** Maximum number of recent items to show */
export const MAX_RECENT_ITEMS = 5;

// ============================================================================
// Time Periods
// ============================================================================

/** Default analytics period in days */
export const DEFAULT_ANALYTICS_DAYS = 30;

/** Default trend period in days */
export const DEFAULT_TREND_DAYS = 7;

// ============================================================================
// AI Model Configuration
// ============================================================================

/** Default Claude model for AI operations */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/** Token limits by use case */
export const AI_TOKEN_LIMITS = {
  /** Short responses (completions, suggestions) */
  SHORT: 200,
  /** Medium responses (summaries, reviews) */
  MEDIUM: 500,
  /** Standard responses (documentation, analysis) */
  STANDARD: 1000,
  /** Long responses (generation, translation) */
  LONG: 2000,
  /** Extended responses (full documents) */
  EXTENDED: 3000,
  /** Maximum responses (translations, large docs) */
  MAXIMUM: 4000,
  /** Translation limit (preserves formatting) */
  TRANSLATION: 8000,
} as const;

// ============================================================================
// Query Limits
// ============================================================================

/** Maximum items for bulk operations */
export const MAX_BULK_ITEMS = 100;

/** Maximum nodes for knowledge graph queries */
export const MAX_KNOWLEDGE_GRAPH_NODES = 100;

/** Maximum documents for hub views */
export const MAX_HUB_DOCUMENTS = 500;

/** Maximum repositories for organization views */
export const MAX_ORG_REPOSITORIES = 200;

/** Maximum alerts for self-healing queries */
export const MAX_ALERTS = 100;

// ============================================================================
// Rate Limiting
// ============================================================================

/** Default rate limit window in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/** Default max requests per window */
export const RATE_LIMIT_MAX_REQUESTS = 100;

// ============================================================================
// Timeouts
// ============================================================================

/** Default timeout for external API calls (ms) */
export const DEFAULT_API_TIMEOUT_MS = 30000;

/** Timeout for AI operations (ms) */
export const AI_OPERATION_TIMEOUT_MS = 60000;
