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
};
