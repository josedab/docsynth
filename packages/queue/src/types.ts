// ============================================================================
// Queue Names
// ============================================================================

export const QUEUE_NAMES = {
  CHANGE_ANALYSIS: 'change-analysis',
  INTENT_INFERENCE: 'intent-inference',
  DOC_GENERATION: 'doc-generation',
  DOC_REVIEW: 'doc-review',
  NOTIFICATIONS: 'notifications',
  PR_PREVIEW: 'pr-preview',
  DRIFT_SCAN: 'drift-scan',
  VECTOR_INDEX: 'vector-index',
  DOC_TEST_GENERATION: 'doc-test-generation',
  HEALTH_SCAN: 'health-scan',
  KNOWLEDGE_GRAPH: 'knowledge-graph',
  EXAMPLE_VALIDATION: 'example-validation',
  // New queues for features 4-10
  DOC_REVIEW_COPILOT: 'doc-review-copilot',
  TRANSLATION: 'translation',
  DIAGRAM_GENERATION: 'diagram-generation',
  ONBOARDING: 'onboarding',
  CHAT_RAG: 'chat-rag',
  ADR_GENERATION: 'adr-generation',
  BOT_MESSAGE: 'bot-message',
  // Next-gen feature queues
  QA_REVIEW: 'qa-review',
  QA_REFINEMENT: 'qa-refinement',
  COVERAGE_SCAN: 'coverage-scan',
  VERSION_BUMP: 'version-bump',
  VIDEO_GENERATION: 'video-generation',
  COMPLIANCE_SCAN: 'compliance-scan',
  // New killer features
  DRIFT_PREDICTION: 'drift-prediction',
  MULTI_AGENT_DOC: 'multi-agent-doc',
  ONBOARDING_PATH: 'onboarding-path',
  PLAYGROUND_SESSION: 'playground-session',
  CITATION_INDEX: 'citation-index',
  // Next-gen features (from planning)
  REVIEW_DOCUMENTATION: 'review-documentation',
  COVERAGE_GATE: 'coverage-gate',
  COMPLIANCE_ASSESSMENT: 'compliance-assessment',
  // Follow-up feature queues
  SELF_HEALING: 'self-healing',
  ANALYTICS_COMPUTATION: 'analytics-computation',
  LLM_USAGE_AGGREGATION: 'llm-usage-aggregation',
  COMMUNITY_BADGE_CHECK: 'community-badge-check',
  ROI_COMPUTATION: 'roi-computation',
  DOC_IMPACT: 'doc-impact',
  MIGRATION: 'migration',
  NL_EDITOR: 'nl-editor',
  POLLING: 'polling',
  ORG_GRAPH_BUILDER: 'org-graph-builder',
  // Next-gen v2 feature queues
  PR_DOC_REVIEW: 'pr-doc-review',
  FEDERATED_HUB: 'federated-hub',
  GITOPS_SYNC: 'gitops-sync',
  ONBOARDING_COPILOT: 'onboarding-copilot',
  COLLABORATIVE_EDITOR: 'collaborative-editor',
  API_CHANGELOG: 'api-changelog',
  EXECUTIVE_REPORT: 'executive-report',
  SDK_DOCS_GENERATION: 'sdk-docs-generation',
  // Next-gen v3 feature queues
  SMART_DIFF: 'smart-diff',
  DOC_QUALITY_SCORE: 'doc-quality-score',
  AUTO_HEALING: 'auto-healing',
  MULTI_REPO_GRAPH: 'multi-repo-graph',
  ROI_DASHBOARD: 'roi-dashboard',
  INTERACTIVE_EXAMPLE_V2: 'interactive-example-next',
  COMPLIANCE_SCAN_V2: 'compliance-scan-next',
  MULTI_LANG_DOC: 'multi-lang-doc',
  DOC_DRIVEN_DEV: 'doc-driven-dev',
  DOC_CHATBOT: 'doc-chatbot',
  // Feature #9: Enhanced Documentation Impact Scoring
  IMPACT_SCORING: 'impact-scoring',
  // Feature #7: LLM Cost Optimizer & Budget Controls
  LLM_COST_CHECK: 'llm-cost-check',
  // Feature #2: AI Documentation Linter
  DOC_LINT: 'doc-lint',
  // Feature #4: Documentation-as-Tests
  DOC_AS_TESTS: 'doc-as-tests',
  // Feature #10: OpenAPI/GraphQL Spec-Aware Generation
  SPEC_AWARE_DOCS: 'spec-aware-docs',
  // Feature #5: Smart Monorepo Documentation Hub
  MONOREPO_HUB: 'monorepo-hub',
  // Feature #6: Real-Time Collaborative Documentation Editor
  REALTIME_EDITOR: 'realtime-editor',
  // Feature #8: Embeddable Documentation Widget
  WIDGET_ANALYTICS: 'widget-analytics',
  // Next-gen v4 features
  DOC_AUTOPILOT: 'doc-autopilot',
  PR_REVIEW_BOT: 'pr-review-bot',
  COVERAGE_CI_GATE: 'coverage-ci-gate',
  ONBOARDING_GENERATOR: 'onboarding-generator',
  TRANSLATION_SYNC: 'translation-sync',
  DOC_TESTS_RUNTIME: 'doc-tests-runtime',
  SELF_HEALING_AUTO: 'self-healing-auto',
  WIDGET_CONTEXTUAL: 'widget-contextual',
  ROI_EXECUTIVE: 'roi-executive',
  FEDERATED_SEARCH: 'federated-search',
  // Next-gen v5 features
  DOC_AGENT: 'doc-agent',
  COPILOT_EXTENSION: 'copilot-extension',
  DOC_DIFF_STAGING: 'doc-diff-staging',
  KNOWLEDGE_BASE_RAG: 'knowledge-base-rag',
  TEAM_COLLABORATION: 'team-collaboration',
  DOC_ANALYTICS_INSIGHTS: 'doc-analytics-insights',
  FRAMEWORK_TEMPLATES: 'framework-templates',
  DOC_GOVERNANCE: 'doc-governance',
  DOC_MIGRATION_ENGINE: 'doc-migration-engine',
  ONBOARDING_INTELLIGENCE: 'onboarding-intelligence',
  // Next-gen v6 features
  DOCS_GITOPS: 'docs-gitops',
  PAIR_WRITING: 'pair-writing',
  DOC_SUPPLY_CHAIN: 'doc-supply-chain',
  DOC_PORTAL: 'doc-portal',
  IMPACT_ATTRIBUTION: 'impact-attribution',
  DOC_QUALITY_BENCHMARK: 'doc-quality-benchmark',
  DOC_WEBHOOKS: 'doc-webhooks',
  DOC_AB_TESTING: 'doc-ab-testing',
  OFFLINE_SYNC: 'offline-sync',
  DOC_GAMIFICATION: 'doc-gamification',
  // Next-gen v7 features
  DOC_LSP: 'doc-lsp',
  DOC_DEP_GRAPH: 'doc-dep-graph',
  DOC_SEMVER: 'doc-semver',
  DOC_QL: 'doc-ql',
  DOC_FEDERATION: 'doc-federation',
  DOC_REGRESSION: 'doc-regression',
  DOC_CONTEXT_TRANSLATION: 'doc-context-translation',
  DOC_HEALTH_BADGE: 'doc-health-badge',
  DOC_PLAYGROUND: 'doc-playground',
  DOC_FORECAST: 'doc-forecast',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ============================================================================
// Job Data Types
// ============================================================================

export interface ChangeAnalysisJobData {
  prEventId: string;
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}

export interface IntentInferenceJobData {
  changeAnalysisId: string;
  repositoryId: string;
  installationId: number;
}

export interface DocGenerationJobData {
  changeAnalysisId: string;
  intentContextId: string | null;
  repositoryId: string;
  installationId: number;
}

export interface DocReviewJobData {
  generationJobId: string;
  repositoryId: string;
}

export interface NotificationJobData {
  type: 'email' | 'slack' | 'webhook';
  recipient: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface PRPreviewJobData {
  prEventId: string;
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string | null;
  authorUsername: string;
}

export interface DriftScanJobData {
  organizationId?: string;
  repositoryId?: string;
  installationId: number;
  owner: string;
  repo: string;
  scheduled?: boolean;
}

export interface VectorIndexJobData {
  repositoryId: string;
  documentId?: string;
  reindex?: boolean;
}

export interface DocTestGenerationJobData {
  repositoryId: string;
  documentId?: string;
  regenerate?: boolean;
}

export interface HealthScanJobData {
  organizationId?: string;
  repositoryId?: string;
  scheduled?: boolean;
  createAlerts?: boolean;
}

export interface KnowledgeGraphJobData {
  repositoryId: string;
  fullRebuild?: boolean;
  includeCode?: boolean;
}

export interface ExampleValidationJobData {
  repositoryId: string;
  exampleId?: string;
  documentId?: string;
  validateAll?: boolean;
}

// Feature 4: Doc Review Copilot
export interface DocReviewCopilotJobData {
  repositoryId: string;
  documentId?: string;
  pullRequestId?: string;
  content?: string;
  styleGuideId?: string;
  checkAccuracy?: boolean;
  checkStyle?: boolean;
}

// Feature 5: Translation
export interface TranslationJobData {
  documentId: string;
  targetLocales: string[];
  useGlossary?: boolean;
  preserveFormatting?: boolean;
}

// Feature 6: Diagram Generation
export interface DiagramGenerationJobData {
  repositoryId: string;
  diagramType: string;
  format?: string;
  scope?: string[];
  diagramId?: string;
}

// Feature 7: Onboarding
export interface OnboardingJobData {
  repositoryId: string;
  action: 'generate' | 'update' | 'personalize';
  role?: string;
  userId?: string;
}

// Feature 8: Chat RAG
export interface ChatRAGJobData {
  sessionId: string;
  repositoryId: string;
  message: string;
  userId: string;
}

// Feature 9: ADR Generation
export interface ADRGenerationJobData {
  repositoryId: string;
  pullRequestId?: string;
  title?: string;
  context?: string;
}

// Feature 10: Bot Message
export interface BotMessageJobData {
  platform: 'slack' | 'teams';
  channelId: string;
  threadId?: string;
  userId: string;
  query: string;
  organizationId: string;
}

// Next-gen feature job data types

// QA Review - AI Documentation QA Agent
export interface QAReviewJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  docIds?: string[];
}

// QA Refinement - Refine docs based on QA answers
export interface QARefinementJobData {
  sessionId: string;
  answers: Array<{ questionId: string; answer: string }>;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}

// Coverage Scan - Documentation Coverage Reports
export interface CoverageScanJobData {
  repositoryId: string;
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  installationId: number;
  threshold?: number;
  createCheckRun?: boolean;
}

// Version Bump - Semantic Versioning Automation
export interface VersionBumpJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  currentVersion: string;
  suggestedVersion: string;
  bumpType: 'major' | 'minor' | 'patch';
}

// Video Generation - Voice/Video Documentation
export interface VideoGenerationJobData {
  repositoryId: string;
  documentId: string;
  format?: 'mp4' | 'webm';
  voiceId?: string;
  includeCodeHighlights?: boolean;
}

// Compliance Scan - Compliance Doc Templates
export interface ComplianceScanJobData {
  repositoryId: string;
  frameworks: string[];
  installationId: number;
  owner: string;
  repo: string;
  generateTemplates?: boolean;
}

// ============================================================================
// New Killer Feature Job Data Types
// ============================================================================

// Drift Prediction - Proactive Documentation Drift Detection
export interface DriftPredictionJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  scheduled?: boolean;
}

// Multi-Agent Documentation - Agent-based Doc Generation
export interface MultiAgentDocJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber?: number;
  runType: 'generation' | 'review' | 'update';
  targetPaths?: string[];
}

// Onboarding Path - Personalized Developer Onboarding
export interface OnboardingPathJobData {
  repositoryId: string;
  action: 'generate' | 'update' | 'personalize';
  targetRole?: string;
  userId?: string;
  pathId?: string;
}

// Playground Session - Interactive Code Sandboxes
export interface PlaygroundSessionJobData {
  playgroundId: string;
  userId?: string;
  code: string;
  action: 'run' | 'test' | 'validate';
}

// Citation Index - Smart Search with Citations
export interface CitationIndexJobData {
  repositoryId: string;
  documentId?: string;
  fullReindex?: boolean;
}

// ============================================================================
// Next-Gen Feature Job Data Types (from Planning)
// ============================================================================

// Review Documentation - Extract knowledge from PR review threads
export interface ReviewDocumentationJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  action: 'process_thread' | 'analyze_pr' | 'build_knowledge';
  threadId?: string;
}

// Coverage Gate - CI/CD documentation coverage enforcement
export interface CoverageGateJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber?: number;
  commitSha: string;
  branch: string;
  checkRunId?: number;
}

// Compliance Assessment - Deep compliance control assessment
export interface ComplianceAssessmentJobData {
  repositoryId: string;
  reportId: string;
  installationId: number;
  owner: string;
  repo: string;
  framework: string;
  controlIds?: string[];
}

// ============================================================================
// Follow-up Feature Job Data Types
// ============================================================================

// Self-Healing - Proactive documentation regeneration
export interface SelfHealingJobData {
  repositoryId: string;
  triggeredBy: 'scheduled' | 'manual' | 'drift_detected';
  confidenceThreshold?: number;
  requireReview?: boolean;
  maxSections?: number;
  excludePatterns?: string[];
}

// Analytics Computation - Aggregate analytics data
export interface AnalyticsComputationJobData {
  repositoryId: string;
  organizationId: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
}

// LLM Usage Aggregation - Aggregate LLM usage metrics
export interface LLMUsageAggregationJobData {
  organizationId: string;
  repositoryId?: string;
  period: 'hourly' | 'daily' | 'weekly' | 'monthly';
  periodStart: string;
  periodEnd: string;
}

// Community Badge Check - Check and award badges
export interface CommunityBadgeCheckJobData {
  userId: string;
  repositoryId?: string;
  triggerEvent: 'contribution_merged' | 'milestone_reached' | 'manual';
  contributionId?: string;
}

// ROI Computation - Calculate documentation analytics and ROI
export interface ROIComputationJobData {
  organizationId: string;
  period: 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
  sendEmail?: boolean;
}

// Natural Language Editor - Process NL doc edits
export interface NLEditorJobData {
  type: 'batch' | 'single';
  repositoryId: string;
  instruction: string;
  targetDocuments?: string[];
  scope?: 'all' | 'api-docs' | 'guides' | 'readme';
  documentId?: string;
  sectionHeading?: string;
  context?: {
    relatedCode?: string;
    style?: string;
  };
}

// Migration - Import docs from external sources
export interface MigrationJobData {
  migrationId: string;
  config: {
    source: 'confluence' | 'notion' | 'gitbook' | 'markdown' | 'readme';
    connectionConfig: {
      baseUrl?: string;
      apiToken?: string;
      spaceKey?: string;
      databaseId?: string;
      repoUrl?: string;
    };
    mappings: {
      targetRepositoryId: string;
      pathPrefix?: string;
      docTypeMapping?: Record<string, string>;
    };
    options: {
      preserveMetadata: boolean;
      convertImages: boolean;
      bidirectionalSync: boolean;
      dryRun: boolean;
    };
  };
  organizationId: string;
}

// Polling - Webhook-less change detection

// Doc Impact Analysis - Analyze documentation impact for PRs
export interface DocImpactJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
}
export interface PollingJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  manual?: boolean;
}

// Org Graph Builder - Build multi-repo documentation graph
export interface OrgGraphBuilderJobData {
  organizationId: string;
}

// ============================================================================
// Next-Gen V2 Feature Job Data Types
// ============================================================================

// PR Documentation Review - AI review comments on PRs
export interface PRDocReviewJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  autoComment?: boolean;
}

// Federated Hub - Multi-repo documentation aggregation
export interface FederatedHubJobData {
  hubId: string;
  organizationId: string;
  action: 'index' | 'reindex' | 'update_navigation';
  repositoryIds?: string[];
}

// GitOps Sync - Config-driven documentation regeneration
export interface GitOpsSyncJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  configPath: string;
  changedPaths?: string[];
}

// Onboarding Copilot - Personalized onboarding path generation
export interface OnboardingCopilotJobData {
  repositoryId: string;
  userId: string;
  role: string;
  teamContext?: string;
  pathId?: string;
}

// Collaborative Editor - Document session operations
export interface CollaborativeEditorJobData {
  sessionId: string;
  action: 'persist' | 'cleanup' | 'merge';
  documentId?: string;
}

// API Changelog - API diff and changelog generation
export interface APIChangelogJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  specPath?: string;
}

// Executive Report - ROI report generation
export interface ExecutiveReportJobData {
  organizationId: string;
  format: 'json' | 'csv' | 'pdf';
  period: 'weekly' | 'monthly' | 'quarterly';
  startDate?: string;
  endDate?: string;
  recipients?: string[];
}

// SDK Documentation Generation - Multi-language SDK docs
export interface SDKDocsGenerationJobData {
  repositoryId: string;
  apiSpecPath?: string;
  apiSpecContent?: string;
  languages: string[];
  options: {
    includeExamples: boolean;
    includeErrorHandling: boolean;
    includeAuth: boolean;
    packageName?: string;
  };
}

// Next-gen v3: Smart Diff
export interface SmartDiffJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
}

// Next-gen v3: Doc Quality Score
export interface DocQualityScoreJobData {
  repositoryId: string;
  documentId?: string;
  fullScan: boolean;
}

// Next-gen v3: Auto-Healing
export interface AutoHealingJobData {
  repositoryId: string;
  triggeredBy: 'scheduled' | 'manual' | 'webhook';
  scanTypes?: string[];
}

// Next-gen v3: Multi-Repo Knowledge Graph V2
export interface MultiRepoGraphV2JobData {
  organizationId: string;
  repositoryIds?: string[];
  includeDepAnalysis: boolean;
}

// Next-gen v3: ROI Dashboard
export interface ROIDashboardJobData {
  organizationId: string;
  periodDays: number;
}

// Next-gen v3: Interactive Examples V2
export interface InteractiveExampleV2JobData {
  repositoryId: string;
  documentId?: string;
  action: 'validate' | 'generate' | 'update';
}

// Next-gen v3: Compliance Scanner V2
export interface ComplianceScanV2JobData {
  repositoryId: string;
  frameworks: string[];
  blockOnCritical: boolean;
}

// Next-gen v3: Multi-Language Docs
export interface MultiLangDocJobData {
  repositoryId: string;
  documentId?: string;
  targetLanguages: string[];
  glossaryId?: string;
}

// Next-gen v3: Doc-Driven Development
export interface DocDrivenDevJobData {
  repositoryId: string;
  documentId: string;
  targetLanguage: string;
  generateTests: boolean;
}

// Next-gen v3: Documentation Chatbot
export interface DocChatbotJobData {
  chatbotConfigId: string;
  conversationId: string;
  message: string;
  visitorId: string;
}

// Feature #9: Enhanced Documentation Impact Scoring
export interface ImpactScoringJobData {
  repositoryId: string;
  prNumber: number;
  action: 'auto-generate' | 'manual' | 'worker-analysis';
  score?: number;
}

// Feature #7: LLM Cost Optimizer & Budget Controls
export interface LLMCostCheckJobData {
  organizationId?: string;
  scheduled?: boolean;
}

// Feature #2: AI Documentation Linter
export interface DocLintJobData {
  repositoryId: string;
  prNumber?: number;
  installationId?: string;
  fullScan?: boolean;
}

// Feature #4: Documentation-as-Tests
export interface DocAsTestsJobData {
  repositoryId: string;
  documentId?: string;
}

// Feature #10: OpenAPI/GraphQL Spec-Aware Generation
export interface SpecAwareDocsJobData {
  repositoryId: string;
  specContent: string;
  specType: 'openapi' | 'graphql';
  language?: string;
  action: 'generate' | 'diff' | 'changelog';
  oldSpecContent?: string;
  version?: string;
}

// Feature #5: Smart Monorepo Documentation Hub
export interface MonorepoHubJobData {
  repositoryId: string;
  type: 'discover' | 'generate' | 'refresh';
}

// Feature #8: Embeddable Documentation Widget
export interface WidgetAnalyticsJobData {
  widgetId: string;
  period: { start: string; end: string };
}

// Feature #6: Real-Time Collaborative Documentation Editor
export interface RealtimeEditorJobData {
  action: 'cleanup' | 'ai-suggestions' | 'version-compaction';
  sessionId?: string;
  documentId?: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Next-Gen V4 Feature Job Data Types
// ============================================================================

// Documentation Autopilot Mode - Zero-config doc baseline generation
export interface DocAutopilotJobData {
  repositoryId: string;
  action: 'analyze' | 'generate-baseline' | 'learn-style';
  installationId?: number;
  owner?: string;
  repo?: string;
  options?: {
    depth: 'shallow' | 'deep';
    includePatterns?: string[];
    excludePatterns?: string[];
    generateReadme?: boolean;
    generateApiDocs?: boolean;
    generateArchOverview?: boolean;
    generateSetupGuide?: boolean;
  };
}

// PR Review Bot - Inline doc suggestions on PRs
export interface PRReviewBotJobData {
  repositoryId: string;
  prNumber: number;
  installationId: number;
  owner: string;
  repo: string;
  action: 'analyze-and-suggest' | 'apply-suggestion' | 'dismiss-suggestion';
  suggestionId?: string;
  confidenceThreshold?: number;
}

// Coverage CI Gate - AST-based coverage with CI blocking
export interface CoverageCIGateJobData {
  repositoryId: string;
  prNumber?: number;
  installationId?: number;
  owner?: string;
  repo?: string;
  action: 'scan' | 'enforce' | 'report';
  thresholds?: {
    minPublicApiCoverage: number;
    minOverallCoverage: number;
    blockOnFailure: boolean;
  };
}

// Onboarding Generator - Codebase topology and guided walkthroughs
export interface OnboardingGeneratorJobData {
  repositoryId: string;
  userId?: string;
  role: 'frontend' | 'backend' | 'fullstack' | 'devops' | 'general';
  action: 'analyze-topology' | 'generate-path' | 'update-path';
  pathId?: string;
  options?: {
    includeSetupSteps: boolean;
    includeArchOverview: boolean;
    includeFirstTasks: boolean;
    maxSteps?: number;
  };
}

// Translation Sync - Delta translation with glossary
export interface TranslationSyncJobData {
  repositoryId: string;
  documentId?: string;
  action: 'sync' | 'translate-delta' | 'update-glossary' | 'validate';
  targetLanguages: string[];
  sourceLanguage?: string;
  glossaryId?: string;
  options?: {
    deltaOnly: boolean;
    preserveFormatting: boolean;
    technicalTermHandling: 'keep-original' | 'translate' | 'glossary-lookup';
  };
}

// Doc Tests Runtime - Extract and execute code examples from docs
export interface DocTestsRuntimeJobData {
  repositoryId: string;
  documentId?: string;
  action: 'extract' | 'execute' | 'validate' | 'auto-fix';
  options?: {
    languages: string[];
    timeout: number;
    sandboxed: boolean;
    autoFixOnFailure: boolean;
    generateReport: boolean;
  };
}

// Self-Healing Auto - Autonomous drift detection and regeneration
export interface SelfHealingAutoJobData {
  repositoryId: string;
  action: 'assess-drift' | 'regenerate' | 'create-pr';
  driftThreshold?: number;
  confidenceMinimum?: number;
  maxSectionsPerRun?: number;
  driftSignals?: {
    codeDocRatio: number;
    linkValidity: number;
    apiSignatureChanges: number;
    timeSinceUpdate: number;
  };
}

// Widget Contextual - Contextual doc lookup for embedded widgets
export interface WidgetContextualJobData {
  widgetId: string;
  action: 'resolve-context' | 'index-content' | 'track-analytics';
  context?: {
    urlPath?: string;
    apiEndpoint?: string;
    userRole?: string;
    searchQuery?: string;
  };
  repositoryId?: string;
}

// ROI Executive - Executive reports and PDF generation
export interface ROIExecutiveJobData {
  organizationId: string;
  action: 'compute-metrics' | 'generate-report' | 'schedule-digest';
  format?: 'json' | 'pdf' | 'csv' | 'slack-digest';
  period: 'weekly' | 'monthly' | 'quarterly';
  startDate?: string;
  endDate?: string;
  recipients?: string[];
  metrics?: string[];
}

// Federated Search - Cross-repo unified documentation search
export interface FederatedSearchJobData {
  organizationId: string;
  action: 'index-repo' | 'reindex-all' | 'search' | 'build-navigation';
  repositoryIds?: string[];
  searchQuery?: string;
  options?: {
    includeDepMaps: boolean;
    buildCrossRefs: boolean;
    enforceOrgStyle: boolean;
  };
}

// ============================================================================
// Next-Gen V5 Feature Job Data Types
// ============================================================================

// AI Documentation Agent - Agentic reasoning loop
export interface DocAgentJobData {
  repositoryId: string;
  action: 'plan' | 'generate' | 'validate' | 'self-correct' | 'full-cycle';
  prNumber?: number;
  installationId?: number;
  owner?: string;
  repo?: string;
  context?: {
    changeAnalysisId?: string;
    intentContextId?: string;
    maxIterations?: number;
    confidenceThreshold?: number;
    budgetCents?: number;
  };
}

// GitHub Copilot Extension - Native @docsynth commands
export interface CopilotExtensionJobData {
  command: 'update' | 'explain' | 'status' | 'coverage' | 'chat';
  repositoryId: string;
  userId: string;
  conversationId: string;
  message: string;
  context?: {
    filePath?: string;
    selection?: string;
    prNumber?: number;
    branch?: string;
  };
}

// Smart Doc Diff & Staging - Section-level diff with accept/reject
export interface DocDiffStagingJobData {
  repositoryId: string;
  action: 'compute-diff' | 'apply-staged' | 'preview';
  generationJobId?: string;
  documentPath?: string;
  stagedSections?: Array<{
    sectionId: string;
    action: 'accept' | 'reject' | 'edit';
    editedContent?: string;
  }>;
}

// Knowledge Base RAG 2.0 - Unified indexer with citations
export interface KnowledgeBaseRAGJobData {
  organizationId: string;
  repositoryId?: string;
  action: 'index-full' | 'index-incremental' | 'query' | 'surface-proactive';
  sources?: Array<'code' | 'docs' | 'prs' | 'issues' | 'slack' | 'adr'>;
  query?: string;
  options?: {
    requireCitations: boolean;
    confidenceMinimum: number;
    maxChunks: number;
  };
}

// Team Collaboration Workflows - Multi-reviewer approval
export interface TeamCollaborationJobData {
  action: 'create-review' | 'assign-reviewer' | 'notify' | 'escalate' | 'resolve-thread';
  documentId: string;
  repositoryId: string;
  reviewId?: string;
  assignees?: string[];
  threadId?: string;
  comment?: string;
  dueDate?: string;
}

// Documentation Analytics & Insights - Reader behavior tracking
export interface DocAnalyticsInsightsJobData {
  organizationId: string;
  repositoryId?: string;
  action: 'collect-events' | 'compute-insights' | 'generate-recommendations';
  period?: 'daily' | 'weekly' | 'monthly';
  eventBatch?: Array<{
    eventType: 'view' | 'search' | 'feedback' | 'time-on-page';
    documentPath: string;
    metadata: Record<string, unknown>;
  }>;
}

// Multi-Framework Doc Templates - Framework-specific generation
export interface FrameworkTemplatesJobData {
  repositoryId: string;
  action: 'detect-framework' | 'apply-template' | 'generate-from-template';
  framework?: string;
  templateId?: string;
  targetPath?: string;
  variables?: Record<string, unknown>;
}

// Documentation Governance & Compliance - Policy enforcement
export interface DocGovernanceJobData {
  repositoryId: string;
  action: 'evaluate-policies' | 'enforce-gate' | 'generate-report' | 'scan-compliance';
  prNumber?: number;
  installationId?: number;
  owner?: string;
  repo?: string;
  policyOverrides?: Record<string, unknown>;
}

// Incremental Doc Migration Engine - Import from external sources
export interface DocMigrationEngineJobData {
  organizationId: string;
  action: 'connect' | 'import' | 'convert' | 'sync-bidirectional' | 'validate';
  source: 'confluence' | 'notion' | 'gitbook' | 'google-docs' | 'markdown';
  connectionConfig: {
    baseUrl?: string;
    apiToken?: string;
    spaceKey?: string;
    databaseId?: string;
  };
  targetRepositoryId: string;
  options?: {
    preserveMetadata: boolean;
    convertImages: boolean;
    rewriteLinks: boolean;
    dryRun: boolean;
  };
}

// Developer Onboarding Intelligence - Journey tracking & optimization
export interface OnboardingIntelligenceJobData {
  repositoryId: string;
  action: 'track-journey' | 'optimize-path' | 'compute-metrics' | 'generate-report';
  userId?: string;
  role?: string;
  journeyEvent?: {
    eventType: 'doc-read' | 'doc-search' | 'question-asked' | 'first-commit' | 'stuck';
    documentPath?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  };
}

// ============================================================================
// Next-Gen V6 Feature Job Data Types
// ============================================================================

// Docs-as-Infrastructure (GitOps) - Declarative doc config
export interface DocsGitOpsJobData {
  repositoryId: string;
  action: 'plan' | 'apply' | 'drift-detect' | 'validate-config';
  configPath?: string;
  installationId?: number;
  owner?: string;
  repo?: string;
  dryRun?: boolean;
}

// Real-Time Co-Pilot Pair Writing - Live AI co-writing
export interface PairWritingJobData {
  sessionId: string;
  repositoryId: string;
  action: 'suggest-completion' | 'validate-facts' | 'insert-example' | 'persist-session';
  documentPath: string;
  cursorPosition?: number;
  currentContent?: string;
  context?: { filePath?: string; selection?: string };
}

// Documentation Supply Chain Security - Attestation
export interface DocSupplyChainJobData {
  repositoryId: string;
  action: 'sign' | 'verify' | 'audit' | 'generate-sbom';
  documentId?: string;
  generationJobId?: string;
  commitSha?: string;
}

// Multi-Tenant Documentation Portal
export interface DocPortalJobData {
  portalId: string;
  organizationId: string;
  action: 'build' | 'deploy' | 'update-config' | 'invalidate-cache' | 'generate-sitemap';
  repositoryIds?: string[];
  customDomain?: string;
  version?: string;
}

// Documentation Impact Attribution
export interface ImpactAttributionJobData {
  organizationId: string;
  action: 'correlate' | 'compute-impact' | 'predict' | 'generate-report';
  repositoryId?: string;
  period?: 'weekly' | 'monthly' | 'quarterly';
  integrations?: Array<'jira' | 'zendesk' | 'intercom'>;
}

// AI Doc Quality Benchmark
export interface DocQualityBenchmarkJobData {
  action: 'evaluate' | 'compare' | 'update-leaderboard' | 'generate-report';
  repositoryId?: string;
  documentId?: string;
  benchmarkSuiteId?: string;
  dimensions?: string[];
}

// Event-Driven Doc Webhooks
export interface DocWebhooksJobData {
  action: 'deliver' | 'retry' | 'test' | 'cleanup-dead-letters';
  webhookId?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  subscriptionId?: string;
}

// Documentation A/B Testing
export interface DocABTestingJobData {
  repositoryId: string;
  action: 'create-experiment' | 'assign-variant' | 'record-outcome' | 'compute-results' | 'archive';
  experimentId?: string;
  variantId?: string;
  userId?: string;
  outcomeType?: string;
}

// Offline-First Documentation Sync
export interface OfflineSyncJobData {
  userId: string;
  action: 'prepare-bundle' | 'resolve-conflicts' | 'sync-changes' | 'evict-stale';
  repositoryIds?: string[];
  deviceId?: string;
  lastSyncTimestamp?: string;
}

// Documentation Skill Tree (Gamification)
export interface DocGamificationJobData {
  userId: string;
  action: 'check-achievements' | 'update-leaderboard' | 'award-badge' | 'compute-streaks';
  repositoryId?: string;
  eventType?: string;
  eventMetadata?: Record<string, unknown>;
}

// ============================================================================
// Next-Gen V7 Feature Job Data Types
// ============================================================================

// Documentation Language Server Protocol
export interface DocLSPJobData {
  repositoryId: string;
  action: 'diagnose' | 'complete' | 'resolve-reference' | 'index-workspace';
  filePath?: string;
  position?: { line: number; character: number };
  content?: string;
}

// Documentation Dependency Graph
export interface DocDepGraphJobData {
  repositoryId: string;
  action: 'build-graph' | 'compute-blast-radius' | 'detect-broken-refs' | 'export-graph';
  prNumber?: number;
  changedFiles?: string[];
  format?: 'json' | 'dot' | 'cytoscape';
}

// Semantic Documentation Versioning
export interface DocSemverJobData {
  repositoryId: string;
  action: 'classify-change' | 'bump-version' | 'tag-release' | 'query-version';
  documentPath?: string;
  codeVersion?: string;
  diffContent?: string;
}

// DocQL Query Language
export interface DocQLJobData {
  organizationId: string;
  action: 'execute-query' | 'validate-query' | 'schedule-alert';
  query: string;
  repositoryId?: string;
  alertConfig?: { channel: 'slack' | 'email'; threshold?: string };
}

// Cross-Organization Documentation Federation
export interface DocFederationJobData {
  organizationId: string;
  action: 'establish-trust' | 'resolve-reference' | 'sync-index' | 'revoke-trust';
  targetOrgId?: string;
  reference?: string;
  accessLevel?: 'public' | 'federated' | 'private';
}

// Documentation Regression Testing
export interface DocRegressionJobData {
  repositoryId: string;
  action: 'run-assertions' | 'validate-suite' | 'generate-report';
  prNumber?: number;
  installationId?: number;
  owner?: string;
  repo?: string;
  suitePath?: string;
}

// AI Context-Aware Translation
export interface DocContextTranslationJobData {
  repositoryId: string;
  action: 'translate' | 'sync-delta' | 'build-glossary' | 'validate-translation';
  documentId?: string;
  targetLanguage: string;
  sourceLanguage?: string;
  glossaryId?: string;
}

// Documentation Health Badge & Status Check
export interface DocHealthBadgeJobData {
  repositoryId: string;
  action: 'compute-score' | 'render-badge' | 'post-status-check' | 'update-leaderboard';
  prNumber?: number;
  installationId?: number;
  owner?: string;
  repo?: string;
  format?: 'svg' | 'json';
}

// Interactive Documentation Playground
export interface DocPlaygroundJobData {
  repositoryId: string;
  action: 'extract-examples' | 'execute-snippet' | 'create-playground' | 'cleanup-containers';
  documentPath?: string;
  language?: string;
  code?: string;
  playgroundId?: string;
  timeout?: number;
}

// Documentation Change Forecasting
export interface DocForecastJobData {
  repositoryId: string;
  action: 'collect-signals' | 'train-model' | 'predict' | 'generate-digest';
  period?: 'sprint' | 'week' | 'month';
  topN?: number;
}

// ============================================================================
// Job Data Map (maps queue names to their data types)
// ============================================================================

export type JobDataMap = {
  [QUEUE_NAMES.CHANGE_ANALYSIS]: ChangeAnalysisJobData;
  [QUEUE_NAMES.INTENT_INFERENCE]: IntentInferenceJobData;
  [QUEUE_NAMES.DOC_GENERATION]: DocGenerationJobData;
  [QUEUE_NAMES.DOC_REVIEW]: DocReviewJobData;
  [QUEUE_NAMES.NOTIFICATIONS]: NotificationJobData;
  [QUEUE_NAMES.PR_PREVIEW]: PRPreviewJobData;
  [QUEUE_NAMES.DRIFT_SCAN]: DriftScanJobData;
  [QUEUE_NAMES.VECTOR_INDEX]: VectorIndexJobData;
  [QUEUE_NAMES.DOC_TEST_GENERATION]: DocTestGenerationJobData;
  [QUEUE_NAMES.HEALTH_SCAN]: HealthScanJobData;
  [QUEUE_NAMES.KNOWLEDGE_GRAPH]: KnowledgeGraphJobData;
  [QUEUE_NAMES.EXAMPLE_VALIDATION]: ExampleValidationJobData;
  [QUEUE_NAMES.DOC_REVIEW_COPILOT]: DocReviewCopilotJobData;
  [QUEUE_NAMES.TRANSLATION]: TranslationJobData;
  [QUEUE_NAMES.DIAGRAM_GENERATION]: DiagramGenerationJobData;
  [QUEUE_NAMES.ONBOARDING]: OnboardingJobData;
  [QUEUE_NAMES.CHAT_RAG]: ChatRAGJobData;
  [QUEUE_NAMES.ADR_GENERATION]: ADRGenerationJobData;
  [QUEUE_NAMES.BOT_MESSAGE]: BotMessageJobData;
  // Next-gen feature job data mappings
  [QUEUE_NAMES.QA_REVIEW]: QAReviewJobData;
  [QUEUE_NAMES.QA_REFINEMENT]: QARefinementJobData;
  [QUEUE_NAMES.COVERAGE_SCAN]: CoverageScanJobData;
  [QUEUE_NAMES.VERSION_BUMP]: VersionBumpJobData;
  [QUEUE_NAMES.VIDEO_GENERATION]: VideoGenerationJobData;
  [QUEUE_NAMES.COMPLIANCE_SCAN]: ComplianceScanJobData;
  // New killer feature job data mappings
  [QUEUE_NAMES.DRIFT_PREDICTION]: DriftPredictionJobData;
  [QUEUE_NAMES.MULTI_AGENT_DOC]: MultiAgentDocJobData;
  [QUEUE_NAMES.ONBOARDING_PATH]: OnboardingPathJobData;
  [QUEUE_NAMES.PLAYGROUND_SESSION]: PlaygroundSessionJobData;
  [QUEUE_NAMES.CITATION_INDEX]: CitationIndexJobData;
  // Next-gen features (from planning)
  [QUEUE_NAMES.REVIEW_DOCUMENTATION]: ReviewDocumentationJobData;
  [QUEUE_NAMES.COVERAGE_GATE]: CoverageGateJobData;
  [QUEUE_NAMES.COMPLIANCE_ASSESSMENT]: ComplianceAssessmentJobData;
  // Follow-up feature job data mappings
  [QUEUE_NAMES.SELF_HEALING]: SelfHealingJobData;
  [QUEUE_NAMES.ANALYTICS_COMPUTATION]: AnalyticsComputationJobData;
  [QUEUE_NAMES.LLM_USAGE_AGGREGATION]: LLMUsageAggregationJobData;
  [QUEUE_NAMES.COMMUNITY_BADGE_CHECK]: CommunityBadgeCheckJobData;
  [QUEUE_NAMES.ROI_COMPUTATION]: ROIComputationJobData;
  [QUEUE_NAMES.DOC_IMPACT]: DocImpactJobData;
  [QUEUE_NAMES.MIGRATION]: MigrationJobData;
  [QUEUE_NAMES.POLLING]: PollingJobData;
  [QUEUE_NAMES.ORG_GRAPH_BUILDER]: OrgGraphBuilderJobData;
  [QUEUE_NAMES.NL_EDITOR]: NLEditorJobData;
  // Next-gen v2 feature job data mappings
  [QUEUE_NAMES.PR_DOC_REVIEW]: PRDocReviewJobData;
  [QUEUE_NAMES.FEDERATED_HUB]: FederatedHubJobData;
  [QUEUE_NAMES.GITOPS_SYNC]: GitOpsSyncJobData;
  [QUEUE_NAMES.ONBOARDING_COPILOT]: OnboardingCopilotJobData;
  [QUEUE_NAMES.COLLABORATIVE_EDITOR]: CollaborativeEditorJobData;
  [QUEUE_NAMES.API_CHANGELOG]: APIChangelogJobData;
  [QUEUE_NAMES.EXECUTIVE_REPORT]: ExecutiveReportJobData;
  [QUEUE_NAMES.SDK_DOCS_GENERATION]: SDKDocsGenerationJobData;
  // Next-gen v3 feature job data mappings
  [QUEUE_NAMES.SMART_DIFF]: SmartDiffJobData;
  [QUEUE_NAMES.DOC_QUALITY_SCORE]: DocQualityScoreJobData;
  [QUEUE_NAMES.AUTO_HEALING]: AutoHealingJobData;
  [QUEUE_NAMES.MULTI_REPO_GRAPH]: MultiRepoGraphV2JobData;
  [QUEUE_NAMES.ROI_DASHBOARD]: ROIDashboardJobData;
  [QUEUE_NAMES.INTERACTIVE_EXAMPLE_V2]: InteractiveExampleV2JobData;
  [QUEUE_NAMES.COMPLIANCE_SCAN_V2]: ComplianceScanV2JobData;
  [QUEUE_NAMES.MULTI_LANG_DOC]: MultiLangDocJobData;
  [QUEUE_NAMES.DOC_DRIVEN_DEV]: DocDrivenDevJobData;
  [QUEUE_NAMES.DOC_CHATBOT]: DocChatbotJobData;
  [QUEUE_NAMES.IMPACT_SCORING]: ImpactScoringJobData;
  [QUEUE_NAMES.LLM_COST_CHECK]: LLMCostCheckJobData;
  [QUEUE_NAMES.DOC_LINT]: DocLintJobData;
  [QUEUE_NAMES.DOC_AS_TESTS]: DocAsTestsJobData;
  // Feature #10: OpenAPI/GraphQL Spec-Aware Generation
  [QUEUE_NAMES.SPEC_AWARE_DOCS]: SpecAwareDocsJobData;
  // Feature #5: Smart Monorepo Documentation Hub
  [QUEUE_NAMES.MONOREPO_HUB]: MonorepoHubJobData;
  // Feature #6: Real-Time Collaborative Documentation Editor
  [QUEUE_NAMES.REALTIME_EDITOR]: RealtimeEditorJobData;
  // Feature #8: Embeddable Documentation Widget
  [QUEUE_NAMES.WIDGET_ANALYTICS]: WidgetAnalyticsJobData;
  // Next-gen v4 feature job data mappings
  [QUEUE_NAMES.DOC_AUTOPILOT]: DocAutopilotJobData;
  [QUEUE_NAMES.PR_REVIEW_BOT]: PRReviewBotJobData;
  [QUEUE_NAMES.COVERAGE_CI_GATE]: CoverageCIGateJobData;
  [QUEUE_NAMES.ONBOARDING_GENERATOR]: OnboardingGeneratorJobData;
  [QUEUE_NAMES.TRANSLATION_SYNC]: TranslationSyncJobData;
  [QUEUE_NAMES.DOC_TESTS_RUNTIME]: DocTestsRuntimeJobData;
  [QUEUE_NAMES.SELF_HEALING_AUTO]: SelfHealingAutoJobData;
  [QUEUE_NAMES.WIDGET_CONTEXTUAL]: WidgetContextualJobData;
  [QUEUE_NAMES.ROI_EXECUTIVE]: ROIExecutiveJobData;
  [QUEUE_NAMES.FEDERATED_SEARCH]: FederatedSearchJobData;
  // Next-gen v5 feature job data mappings
  [QUEUE_NAMES.DOC_AGENT]: DocAgentJobData;
  [QUEUE_NAMES.COPILOT_EXTENSION]: CopilotExtensionJobData;
  [QUEUE_NAMES.DOC_DIFF_STAGING]: DocDiffStagingJobData;
  [QUEUE_NAMES.KNOWLEDGE_BASE_RAG]: KnowledgeBaseRAGJobData;
  [QUEUE_NAMES.TEAM_COLLABORATION]: TeamCollaborationJobData;
  [QUEUE_NAMES.DOC_ANALYTICS_INSIGHTS]: DocAnalyticsInsightsJobData;
  [QUEUE_NAMES.FRAMEWORK_TEMPLATES]: FrameworkTemplatesJobData;
  [QUEUE_NAMES.DOC_GOVERNANCE]: DocGovernanceJobData;
  [QUEUE_NAMES.DOC_MIGRATION_ENGINE]: DocMigrationEngineJobData;
  [QUEUE_NAMES.ONBOARDING_INTELLIGENCE]: OnboardingIntelligenceJobData;
  // Next-gen v6 feature job data mappings
  [QUEUE_NAMES.DOCS_GITOPS]: DocsGitOpsJobData;
  [QUEUE_NAMES.PAIR_WRITING]: PairWritingJobData;
  [QUEUE_NAMES.DOC_SUPPLY_CHAIN]: DocSupplyChainJobData;
  [QUEUE_NAMES.DOC_PORTAL]: DocPortalJobData;
  [QUEUE_NAMES.IMPACT_ATTRIBUTION]: ImpactAttributionJobData;
  [QUEUE_NAMES.DOC_QUALITY_BENCHMARK]: DocQualityBenchmarkJobData;
  [QUEUE_NAMES.DOC_WEBHOOKS]: DocWebhooksJobData;
  [QUEUE_NAMES.DOC_AB_TESTING]: DocABTestingJobData;
  [QUEUE_NAMES.OFFLINE_SYNC]: OfflineSyncJobData;
  [QUEUE_NAMES.DOC_GAMIFICATION]: DocGamificationJobData;
  // Next-gen v7 feature job data mappings
  [QUEUE_NAMES.DOC_LSP]: DocLSPJobData;
  [QUEUE_NAMES.DOC_DEP_GRAPH]: DocDepGraphJobData;
  [QUEUE_NAMES.DOC_SEMVER]: DocSemverJobData;
  [QUEUE_NAMES.DOC_QL]: DocQLJobData;
  [QUEUE_NAMES.DOC_FEDERATION]: DocFederationJobData;
  [QUEUE_NAMES.DOC_REGRESSION]: DocRegressionJobData;
  [QUEUE_NAMES.DOC_CONTEXT_TRANSLATION]: DocContextTranslationJobData;
  [QUEUE_NAMES.DOC_HEALTH_BADGE]: DocHealthBadgeJobData;
  [QUEUE_NAMES.DOC_PLAYGROUND]: DocPlaygroundJobData;
  [QUEUE_NAMES.DOC_FORECAST]: DocForecastJobData;
};
