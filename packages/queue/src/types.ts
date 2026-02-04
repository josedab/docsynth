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
};
