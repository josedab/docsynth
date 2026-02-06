// Core domain types for DocSynth

// ============================================================================
// Organization & User Types
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  githubOrgId: number;
  subscriptionTier: SubscriptionTier;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionTier = 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

export interface User {
  id: string;
  githubUserId: number;
  githubUsername: string;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: UserRole;
  createdAt: Date;
}

// ============================================================================
// Repository Types
// ============================================================================

export interface Repository {
  id: string;
  organizationId: string;
  githubRepoId: number;
  githubFullName: string;
  name: string;
  defaultBranch: string;
  enabled: boolean;
  config: RepositoryConfig;
  installationId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryConfig {
  triggers: TriggerConfig;
  filters: FilterConfig;
  docTypes: DocTypeConfig;
  style: StyleConfig;
}

export interface TriggerConfig {
  onPRMerge: boolean;
  onPush: boolean;
  branches: string[];
}

export interface FilterConfig {
  includePaths: string[];
  excludePaths: string[];
  excludePatterns: string[];
}

export interface DocTypeConfig {
  readme: boolean;
  apiDocs: boolean;
  changelog: boolean;
  guides: boolean;
  diagrams: boolean;
}

export interface StyleConfig {
  tone: 'formal' | 'casual' | 'technical';
  includeExamples: boolean;
  includeApiReference: boolean;
  customInstructions: string | null;
}

// ============================================================================
// Document Types
// ============================================================================

export interface Document {
  id: string;
  repositoryId: string;
  path: string;
  type: DocumentType;
  title: string;
  content: string;
  version: number;
  generatedFromPR: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentType =
  | 'README'
  | 'API_REFERENCE'
  | 'CHANGELOG'
  | 'GUIDE'
  | 'TUTORIAL'
  | 'ARCHITECTURE'
  | 'ADR'
  | 'INLINE_COMMENT';

export interface DocVersion {
  id: string;
  documentId: string;
  content: string;
  version: number;
  generatedAt: Date;
  prSha: string | null;
  generationJobId: string | null;
}

// ============================================================================
// PR & Webhook Types
// ============================================================================

export interface PREvent {
  id: string;
  repositoryId: string;
  prNumber: number;
  action: PRAction;
  title: string;
  body: string | null;
  baseBranch: string;
  headBranch: string;
  authorUsername: string;
  mergedAt: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export type PRAction = 'opened' | 'closed' | 'merged' | 'synchronize' | 'edited';

export interface WebhookLog {
  id: string;
  repositoryId: string | null;
  eventType: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  processedAt: Date | null;
  error: string | null;
  createdAt: Date;
}

// ============================================================================
// Change Analysis Types
// ============================================================================

export interface ChangeAnalysis {
  id: string;
  prEventId: string;
  changes: FileChange[];
  documentationImpact: DocumentationImpact;
  priority: ChangePriority;
  requiresDocumentation: boolean;
  createdAt: Date;
}

export interface FileChange {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  additions: number;
  deletions: number;
  semanticChanges: SemanticChange[];
}

export interface SemanticChange {
  type: SemanticChangeType;
  name: string;
  location: CodeLocation;
  description: string;
  breaking: boolean;
}

export type SemanticChangeType =
  | 'new-export'
  | 'new-function'
  | 'new-class'
  | 'new-interface'
  | 'new-type'
  | 'api-change'
  | 'signature-change'
  | 'deprecation'
  | 'removal'
  | 'logic-change';

export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
}

export interface DocumentationImpact {
  affectedDocs: string[];
  newDocsNeeded: DocumentType[];
  updatePriority: 'high' | 'medium' | 'low';
}

export type ChangePriority = 'critical' | 'high' | 'medium' | 'low' | 'none';

// ============================================================================
// Intent Inference Types
// ============================================================================

export interface IntentContext {
  id: string;
  changeAnalysisId: string;
  businessPurpose: string;
  technicalApproach: string;
  alternativesConsidered: string[];
  targetAudience: string;
  keyConcepts: string[];
  sources: ContextSource[];
  createdAt: Date;
}

export interface ContextSource {
  type: ContextSourceType;
  identifier: string;
  title: string;
  content: string;
  url: string | null;
  relevanceScore: number;
}

export type ContextSourceType = 'pr' | 'commit' | 'jira' | 'linear' | 'slack' | 'confluence';

// ============================================================================
// Generation Job Types
// ============================================================================

export interface GenerationJob {
  id: string;
  changeAnalysisId: string;
  intentContextId: string | null;
  status: JobStatus;
  progress: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  result: GenerationResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobStatus = 'PENDING' | 'ANALYZING' | 'INFERRING' | 'GENERATING' | 'REVIEWING' | 'COMPLETED' | 'FAILED';

export interface GenerationResult {
  documents: GeneratedDocument[];
  prNumber: number | null;
  prUrl: string | null;
  metrics: GenerationMetrics;
}

export interface GeneratedDocument {
  path: string;
  type: DocumentType;
  title: string;
  content: string;
  action: 'create' | 'update';
}

export interface GenerationMetrics {
  totalTokensUsed: number;
  generationTimeMs: number;
  documentsGenerated: number;
  qualityScore: number | null;
}

// ============================================================================
// Style Profile Types
// ============================================================================

export interface StyleProfile {
  id: string;
  repositoryId: string;
  patterns: StylePatterns;
  terminology: Record<string, string>;
  tone: ToneProfile;
  createdAt: Date;
  updatedAt: Date;
}

export interface StylePatterns {
  headingStyle: 'atx' | 'setext';
  listStyle: 'dash' | 'asterisk' | 'plus';
  codeBlockStyle: 'fenced' | 'indented';
  emphasisStyle: 'asterisk' | 'underscore';
  linkStyle: 'inline' | 'reference';
  sectionOrder: string[];
}

export interface ToneProfile {
  formality: number;
  technicality: number;
  verbosity: number;
  exampleFrequency: number;
}

// ============================================================================
// Subscription & Billing Types
// ============================================================================

export interface Subscription {
  id: string;
  organizationId: string;
  tier: SubscriptionTier;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionStatus = 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'TRIALING' | 'UNPAID';

export interface UsageRecord {
  id: string;
  organizationId: string;
  repositoryId: string;
  period: string;
  generationsCount: number;
  tokensUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Audit Log Types
// ============================================================================

export interface AuditLog {
  id: string;
  organizationId: string;
  userId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'enable'
  | 'disable'
  | 'generate'
  | 'approve'
  | 'reject'
  | 'login'
  | 'logout';

// ============================================================================
// API Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResponseMeta {
  page?: number;
  perPage?: number;
  total?: number;
  hasMore?: boolean;
}

export interface PaginationParams {
  page?: number;
  perPage?: number;
  cursor?: string;
}

// ============================================================================
// GitHub Types
// ============================================================================

export interface GitHubInstallation {
  id: number;
  account: {
    id: number;
    login: string;
    type: 'User' | 'Organization';
    avatarUrl: string;
  };
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  user: {
    login: string;
    id: number;
  };
  createdAt: Date;
  updatedAt: Date;
  mergedAt: Date | null;
  htmlUrl: string;
}

export interface GitHubFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

// ============================================================================
// Analytics & Metrics Types
// ============================================================================

export interface DocHealthScore {
  documentId: string;
  repositoryId: string;
  path: string;
  type: DocumentType;
  scores: {
    freshness: number;      // 0-100: How recently updated vs code changes
    completeness: number;   // 0-100: Coverage of required sections
    accuracy: number;       // 0-100: Alignment with current code
    readability: number;    // 0-100: Flesch score adaptation
    overall: number;        // Weighted average
  };
  factors: {
    daysSinceUpdate: number;
    daysSinceCodeChange: number;
    hasExamples: boolean;
    hasApiReference: boolean;
    wordCount: number;
    codeBlockCount: number;
  };
  status: 'healthy' | 'needs-attention' | 'critical';
  recommendations: string[];
  assessedAt: Date;
}

export interface RepositoryHealthSummary {
  repositoryId: string;
  repositoryName: string;
  overallScore: number;
  documentCount: number;
  healthDistribution: {
    healthy: number;
    needsAttention: number;
    critical: number;
  };
  coverageGaps: DocumentType[];
  topIssues: string[];
  trend: 'improving' | 'stable' | 'declining';
}

export interface DriftDetectionResult {
  documentId: string;
  documentPath: string;
  repositoryId: string;
  driftScore: number;          // 0-100: How much doc has drifted from code
  driftType: DriftType;
  affectedSections: string[];
  relatedCodeChanges: {
    file: string;
    changeType: string;
    date: Date;
  }[];
  suggestedActions: string[];
  detectedAt: Date;
}

export type DriftType = 
  | 'content-outdated'      // Doc content no longer matches code
  | 'missing-api'           // New APIs not documented
  | 'deprecated-reference'  // Doc references deprecated code
  | 'structural-mismatch'   // Doc structure doesn't match code structure
  | 'terminology-drift';    // Terms used inconsistently

export type DriftRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DriftPrediction {
  id: string;
  repositoryId: string;
  documentId: string | null;
  documentPath: string;
  driftProbability: number;     // 0-100: Probability of drift occurring
  riskLevel: DriftRiskLevel;
  predictedDriftDate: Date | null;
  
  // Signals contributing to prediction
  prActivityScore: number;
  changeVelocityScore: number;
  staleDaysScore: number;
  relatedIssuesScore: number;
  
  // Related changes
  relatedPRs: Array<{ number: number; title: string; mergedAt: Date }>;
  affectedFiles: string[];
  
  // Recommendations
  suggestedActions: string[];
  estimatedEffort: 'quick' | 'moderate' | 'substantial';
  
  // Status
  status: 'active' | 'acknowledged' | 'resolved' | 'false_positive';
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Diagram Generation Types
// ============================================================================

export type DiagramType = 
  | 'architecture'
  | 'sequence'
  | 'class'
  | 'flowchart'
  | 'entity-relationship'
  | 'component'
  | 'dependency';

export interface DiagramRequest {
  repositoryId: string;
  diagramType: DiagramType;
  scope?: string;       // Path or module to focus on
  includeTests?: boolean;
  maxDepth?: number;
}

export interface DiagramResult {
  type: DiagramType;
  title: string;
  mermaidCode: string;
  description: string;
  generatedAt: Date;
  metadata?: {
    moduleCount?: number;
    relationshipCount?: number;
    layerCount?: number;
  };
}

// ============================================================================
// Custom Doc Templates Types
// ============================================================================

export interface DocTemplate {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  documentType: DocumentType;
  sections: TemplateSection[];
  variables: TemplateVariable[];
  style: TemplateStyle;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateSection {
  id: string;
  name: string;
  heading: string;
  required: boolean;
  order: number;
  promptHint: string;       // Hint for AI generation
  defaultContent?: string;  // Default content if AI can't generate
}

export interface TemplateVariable {
  name: string;
  description: string;
  defaultValue?: string;
  required: boolean;
}

export interface TemplateStyle {
  tone: 'formal' | 'casual' | 'technical';
  includeTableOfContents: boolean;
  includeBadges: boolean;
  includeGeneratedNote: boolean;
  headerFormat: 'atx' | 'setext';
  maxDepth: number;
}

// ============================================================================
// Translation Types
// ============================================================================

export type SupportedLanguage = 
  | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'zh' | 'ja' | 'ko' | 'ru';

export interface TranslationRequest {
  documentId: string;
  targetLanguages: SupportedLanguage[];
  preserveCodeBlocks: boolean;
}

export interface TranslatedDocument {
  originalDocumentId: string;
  language: SupportedLanguage;
  content: string;
  translatedAt: Date;
  wordCount: number;
}

// ============================================================================
// Chat & RAG Types
// ============================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: ChatSource[];
}

export interface ChatSource {
  documentId: string;
  documentPath: string;
  excerpt: string;
  relevanceScore: number;
}

export interface ChatSession {
  id: string;
  repositoryId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastMessageAt: Date;
}

// ============================================================================
// Knowledge Graph Types
// ============================================================================

export interface KnowledgeNode {
  id: string;
  name: string;
  type: 'concept' | 'function' | 'class' | 'module' | 'document';
  description?: string;
  documentIds: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relationship: 'defines' | 'uses' | 'extends' | 'implements' | 'documents' | 'related';
  weight: number;
}

export interface KnowledgeGraph {
  repositoryId: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  generatedAt: Date;
}

// ============================================================================
// Onboarding Types
// ============================================================================

export interface OnboardingPath {
  id: string;
  repositoryId: string;
  name: string;
  description: string;
  role: 'frontend' | 'backend' | 'fullstack' | 'devops' | 'general';
  estimatedDuration: number; // minutes
  steps: OnboardingStep[];
  createdAt: Date;
}

export interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  documentIds: string[];
  conceptIds: string[];
  checklistItems: string[];
  estimatedDuration: number;
}

export interface OnboardingProgress {
  userId: string;
  pathId: string;
  completedSteps: string[];
  currentStepId: string;
  startedAt: Date;
  lastActivityAt: Date;
}

export interface AnalyticsDashboard {
  period: { start: Date; end: Date };
  summary: {
    totalDocuments: number;
    averageHealthScore: number;
    documentsNeedingAttention: number;
    generationsThisPeriod: number;
    successRate: number;
  };
  repositoryHealth: RepositoryHealthSummary[];
  recentDrifts: DriftDetectionResult[];
  trends: {
    date: string;
    healthScore: number;
    documentCount: number;
    generations: number;
  }[];
}

// ============================================================================
// Vector Embedding Types (Feature 1: AI Documentation Chat)
// ============================================================================

export interface DocumentChunk {
  id: string;
  documentId: string;
  repositoryId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: ChunkMetadata;
  createdAt: Date;
}

export interface ChunkMetadata {
  documentPath: string;
  documentType: DocumentType;
  documentTitle: string;
  sectionHeading?: string;
  startLine?: number;
  endLine?: number;
  tokenCount: number;
}

export interface EmbeddingRequest {
  texts: string[];
  model?: 'text-embedding-3-small' | 'text-embedding-3-large';
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  tokensUsed: number;
}

export interface SemanticSearchQuery {
  query: string;
  repositoryId: string;
  topK?: number;
  minScore?: number;
  documentTypes?: DocumentType[];
}

export interface SemanticSearchResult {
  chunks: ScoredChunk[];
  query: string;
  totalMatches: number;
  searchTimeMs: number;
}

export interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
  highlights?: string[];
}

export interface VectorIndexStats {
  repositoryId: string;
  totalChunks: number;
  totalDocuments: number;
  lastIndexedAt: Date;
  embeddingModel: string;
  dimensionality: number;
}

// ============================================================================
// Chat Feedback Types (Feature 1: AI Documentation Chat)
// ============================================================================

export interface ChatFeedback {
  id: string;
  messageId: string;
  sessionId: string;
  userId: string;
  rating: 'helpful' | 'not-helpful';
  feedbackText?: string;
  suggestedAnswer?: string;
  createdAt: Date;
}

export interface ChatAnalytics {
  repositoryId: string;
  period: { start: Date; end: Date };
  totalSessions: number;
  totalMessages: number;
  averageSessionLength: number;
  helpfulRatio: number;
  topQueries: { query: string; count: number }[];
  unansweredQueries: { query: string; count: number }[];
}

// ============================================================================
// Doc-to-Test Generation Types (Feature 2)
// ============================================================================

export interface CodeExample {
  id: string;
  documentId: string;
  language: string;
  code: string;
  description?: string;
  expectedOutput?: string;
  lineNumber: number;
  context: string;
}

export interface ExtractedAssertion {
  id: string;
  codeExampleId: string;
  assertionType: 'return-value' | 'throws' | 'side-effect' | 'type-check';
  inputDescription: string;
  expectedBehavior: string;
  confidence: number;
}

export interface GeneratedTest {
  id: string;
  documentId: string;
  repositoryId: string;
  codeExampleId: string;
  testFramework: TestFramework;
  testCode: string;
  testFilePath: string;
  status: 'pending' | 'generated' | 'validated' | 'failed';
  validationResult?: TestValidationResult;
  createdAt: Date;
}

export type TestFramework = 
  | 'jest'
  | 'vitest'
  | 'mocha'
  | 'pytest'
  | 'go-testing'
  | 'rust-test';

export interface TestValidationResult {
  passed: boolean;
  output: string;
  executionTimeMs: number;
  errors?: string[];
}

export interface DocTestSuite {
  repositoryId: string;
  documentId: string;
  tests: GeneratedTest[];
  coverage: {
    totalExamples: number;
    testedExamples: number;
    passingTests: number;
    failingTests: number;
  };
  lastRunAt?: Date;
}

export interface DocTestJobData {
  repositoryId: string;
  documentId?: string;
  regenerate?: boolean;
}

// ============================================================================
// IDE Preview Types (Feature 3)
// ============================================================================

export interface IDEPreviewRequest {
  repositoryId: string;
  filePath: string;
  fileContent: string;
  cursorPosition?: { line: number; character: number };
  selectedRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface IDEPreviewResponse {
  wouldGenerateDocs: boolean;
  documentTypes: DocumentType[];
  preview: DocumentPreview[];
  suggestions: IDESuggestion[];
  styleWarnings: StyleWarning[];
  confidence: number;
}

export interface DocumentPreview {
  type: DocumentType;
  title: string;
  contentPreview: string;
  affectedSections: string[];
  estimatedLength: number;
}

export interface IDESuggestion {
  type: 'missing-doc' | 'incomplete-doc' | 'style-issue' | 'complexity';
  message: string;
  location: { line: number; character: number };
  severity: 'info' | 'warning' | 'error';
  quickFix?: {
    title: string;
    replacement: string;
  };
}

export interface StyleWarning {
  rule: string;
  message: string;
  location: { line: number; character: number };
  expected: string;
  actual: string;
}

export interface IDEDiffAnalysis {
  originalContent: string;
  modifiedContent: string;
  changes: DiffChange[];
  documentationImpact: {
    requiresUpdate: boolean;
    affectedDocTypes: DocumentType[];
    suggestedActions: string[];
  };
}

export interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  startLine: number;
  endLine: number;
  content: string;
  semanticType?: SemanticChangeType;
}

export interface IDEExtensionConfig {
  autoPreview: boolean;
  previewDebounceMs: number;
  showInlineHints: boolean;
  styleEnforcement: 'off' | 'warn' | 'error';
  excludePatterns: string[];
}

// ============================================================================
// Health Score History Types (Feature 1: Doc Health Dashboard)
// ============================================================================

export interface HealthScoreSnapshot {
  id: string;
  repositoryId: string;
  organizationId: string;
  overallScore: number;
  freshnessScore: number;
  completenessScore: number;
  accuracyScore: number;
  documentCount: number;
  healthyCount: number;
  needsAttentionCount: number;
  criticalCount: number;
  coverageGaps: string[];
  snapshotDate: Date;
}

export interface HealthAlert {
  id: string;
  organizationId: string;
  repositoryId?: string;
  documentId?: string;
  alertType: HealthAlertType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  notifiedVia: ('slack' | 'email')[];
  createdAt: Date;
}

export type HealthAlertType = 
  | 'score-drop'
  | 'critical-doc'
  | 'drift-detected'
  | 'coverage-gap'
  | 'stale-docs';

export interface TeamLeaderboardEntry {
  id: string;
  organizationId: string;
  repositoryId: string;
  repositoryName: string;
  period: 'weekly' | 'monthly' | 'all-time';
  periodStart: Date;
  periodEnd: Date;
  rank: number;
  score: number;
  scoreChange: number;
  docsImproved: number;
  docsCreated: number;
  streak: number;
  badges: Badge[];
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: Date;
}

export interface HealthTrend {
  date: string;
  overallScore: number;
  freshnessScore: number;
  completenessScore: number;
  documentCount: number;
}

export interface OrganizationHealthSummary {
  organizationId: string;
  overallScore: number;
  totalRepositories: number;
  totalDocuments: number;
  healthDistribution: {
    healthy: number;
    needsAttention: number;
    critical: number;
  };
  topPerformers: { repositoryId: string; repositoryName: string; score: number }[];
  needsWork: { repositoryId: string; repositoryName: string; score: number; issues: string[] }[];
  recentAlerts: HealthAlert[];
  weeklyTrend: HealthTrend[];
}

// ============================================================================
// Interactive Examples Types (Feature 2)
// ============================================================================

export interface InteractiveExample {
  id: string;
  documentId: string;
  repositoryId: string;
  title: string;
  description?: string;
  language: string;
  code: string;
  expectedOutput?: string;
  setupCode?: string;
  dependencies: string[];
  sandboxConfig: SandboxConfig;
  isRunnable: boolean;
  lastValidated?: Date;
  validationStatus: 'pending' | 'valid' | 'invalid' | 'error';
  executionCount: number;
  sourceLineStart: number;
  sourceLineEnd: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SandboxConfig {
  runtime: 'node' | 'python' | 'go' | 'rust' | 'browser';
  nodeVersion?: string;
  pythonVersion?: string;
  timeout?: number;
  memoryLimit?: number;
  networkAccess?: boolean;
  fileSystemAccess?: boolean;
  envVars?: Record<string, string>;
}

export interface ExampleExecution {
  id: string;
  exampleId: string;
  userId?: string;
  code: string;
  output?: string;
  error?: string;
  exitCode?: number;
  executionMs?: number;
  sandboxId?: string;
  createdAt: Date;
}

export interface ExecuteExampleRequest {
  exampleId: string;
  code?: string;
  timeout?: number;
}

export interface ExecuteExampleResponse {
  success: boolean;
  output?: string;
  error?: string;
  exitCode: number;
  executionMs: number;
  sandboxId: string;
}

export interface ExampleValidationResult {
  exampleId: string;
  isValid: boolean;
  actualOutput?: string;
  expectedOutput?: string;
  error?: string;
  validatedAt: Date;
}

// ============================================================================
// Knowledge Graph Types (Feature 3)
// ============================================================================

export interface KnowledgeGraphMeta {
  repositoryId: string;
  entityCount: number;
  relationCount: number;
  lastBuiltAt: Date;
  buildDurationMs?: number;
  status: 'pending' | 'building' | 'ready' | 'error';
  errorMessage?: string;
}

export interface KnowledgeEntity {
  id: string;
  repositoryId: string;
  name: string;
  type: EntityType;
  description?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  documentIds: string[];
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export type EntityType = 
  | 'concept'
  | 'function'
  | 'class'
  | 'module'
  | 'document'
  | 'file'
  | 'interface'
  | 'type'
  | 'variable'
  | 'api-endpoint';

export interface KnowledgeRelation {
  id: string;
  repositoryId: string;
  fromEntityId: string;
  toEntityId: string;
  relationship: RelationType;
  weight: number;
  metadata: Record<string, unknown>;
}

export type RelationType =
  | 'defines'
  | 'uses'
  | 'extends'
  | 'implements'
  | 'documents'
  | 'related'
  | 'calls'
  | 'imports'
  | 'exports'
  | 'depends-on';

export interface KnowledgeGraphData {
  repositoryId: string;
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  meta: KnowledgeGraphMeta;
}

export interface GraphSearchQuery {
  repositoryId: string;
  query: string;
  entityTypes?: EntityType[];
  maxDepth?: number;
  limit?: number;
}

export interface GraphSearchResult {
  entity: KnowledgeEntity;
  score: number;
  path?: KnowledgeEntity[];
  relatedEntities: { entity: KnowledgeEntity; relationship: RelationType }[];
}

export interface GraphTraversalQuery {
  repositoryId: string;
  startEntityId: string;
  relationTypes?: RelationType[];
  direction: 'outgoing' | 'incoming' | 'both';
  maxDepth: number;
}

export interface GraphVisualization {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: GraphCluster[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
  size: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: RelationType;
  weight: number;
}

export interface GraphCluster {
  id: string;
  label: string;
  nodeIds: string[];
}

// ============================================================================
// Feature 4: Doc Review Copilot
// ============================================================================

export interface DocReview {
  id: string;
  repositoryId: string;
  documentId?: string;
  pullRequestId?: string;
  reviewType: 'pr_review' | 'scheduled' | 'manual';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  overallScore?: number;
  accuracyScore?: number;
  clarityScore?: number;
  styleScore?: number;
  issuesFound: number;
  suggestions: DocSuggestion[];
  codeReferences: CodeReference[];
  reviewedContent?: string;
  aiModel?: string;
  processingMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocSuggestion {
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  lineStart?: number;
  lineEnd?: number;
  originalText?: string;
  suggestion: string;
  explanation?: string;
  codeRef?: string;
}

export type ReviewCategory = 'accuracy' | 'clarity' | 'style' | 'grammar' | 'completeness' | 'outdated';
export type ReviewSeverity = 'error' | 'warning' | 'suggestion' | 'info';

export interface CodeReference {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  relevance: string;
}

export interface StyleGuide {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  rules: StyleRule[];
  examples: StyleExample[];
  isDefault: boolean;
}

export interface StyleRule {
  id: string;
  name: string;
  description: string;
  pattern?: string;
  replacement?: string;
  severity: ReviewSeverity;
  enabled: boolean;
}

export interface StyleExample {
  bad: string;
  good: string;
  explanation: string;
}

export interface ReviewRequest {
  repositoryId: string;
  documentId?: string;
  pullRequestId?: string;
  content?: string;
  styleGuideId?: string;
  checkAccuracy: boolean;
  checkStyle: boolean;
  checkGrammar: boolean;
}

export interface ReviewResponse {
  reviewId: string;
  status: string;
  overallScore: number;
  scores: {
    accuracy: number;
    clarity: number;
    style: number;
  };
  comments: DocSuggestion[];
  summary: string;
}

// ============================================================================
// Feature 5: Multi-Language Docs
// ============================================================================

export interface Translation {
  id: string;
  documentId: string;
  sourceLocale: string;
  targetLocale: string;
  status: TranslationStatus;
  content?: string;
  glossaryUsed: string[];
  translator?: 'ai' | 'human' | 'hybrid';
  confidence?: number;
  reviewedBy?: string;
  reviewedAt?: Date;
  publishedAt?: Date;
}

export type TranslationStatus = 'pending' | 'translating' | 'review' | 'published';

export interface GlossaryTerm {
  id: string;
  organizationId: string;
  locale: string;
  term: string;
  definition: string;
  translations: Record<string, string>;
  context?: string;
  doNotTranslate: boolean;
}

export interface TranslationRequest {
  documentId: string;
  targetLocales: string[];
  useGlossary: boolean;
  preserveFormatting: boolean;
}

export interface TranslationResult {
  translationId: string;
  sourceLocale: string;
  targetLocale: string;
  status: TranslationStatus;
  wordCount: number;
  confidence: number;
}

export const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh-CN', 'zh-TW',
  'ru', 'ar', 'hi', 'nl', 'pl', 'sv', 'tr', 'vi', 'th', 'id'
] as const;

export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// ============================================================================
// Feature 6: Architecture Diagram Generator
// ============================================================================

export interface ArchitectureDiagram {
  id: string;
  repositoryId: string;
  name: string;
  diagramType: DiagramType;
  format: DiagramFormat;
  source: string;
  svg?: string;
  description?: string;
  autoGenerated: boolean;
  lastSyncedAt?: Date;
  metadata: Record<string, unknown>;
}

export type DiagramFormat = 'mermaid' | 'plantuml' | 'd2';

export interface DiagramGenerationRequest {
  repositoryId: string;
  diagramType: DiagramType;
  format?: DiagramFormat;
  scope?: string[];
  includeExternal?: boolean;
}

export interface DiagramUpdateEvent {
  diagramId: string;
  changedFiles: string[];
  requiresRebuild: boolean;
}

// ============================================================================
// Feature 7: Onboarding Journey Builder
// ============================================================================

export interface OnboardingJourney {
  id: string;
  repositoryId: string;
  role: string;
  title: string;
  description?: string;
  estimatedMin: number;
  steps: OnboardingStep[];
  prerequisites: string[];
  isPublished: boolean;
}

export interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: StepType;
  content: string;
  resources: StepResource[];
  quiz?: StepQuiz;
  estimatedMin: number;
}

export type StepType = 'read' | 'watch' | 'practice' | 'quiz' | 'explore';

export interface StepResource {
  type: 'document' | 'code' | 'video' | 'link';
  title: string;
  url: string;
  description?: string;
}

export interface StepQuiz {
  questions: QuizQuestion[];
  passingScore: number;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface OnboardingProgress {
  id: string;
  journeyId: string;
  userId: string;
  currentStep: number;
  completed: boolean;
  startedAt: Date;
  completedAt?: Date;
  feedback?: string;
  rating?: number;
}

// ============================================================================
// Feature 8: Doc Chatbot RAG
// ============================================================================

// Extended chat types for the RAG chatbot (extends base ChatSession/ChatMessage/ChatSource)
export interface RagChatSession extends Omit<ChatSession, 'messages'> {
  title?: string;
  context: ChatContext;
  messages: RagChatMessage[];
  updatedAt: Date;
}

export interface ChatContext {
  documentIds?: string[];
  filePaths?: string[];
  topics?: string[];
}

export interface RagChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: RagChatSource[];
  feedback?: 'thumbs_up' | 'thumbs_down';
  createdAt: Date;
}

export interface RagChatSource {
  type: 'document' | 'code' | 'knowledge_graph';
  id: string;
  title: string;
  snippet: string;
  relevance: number;
}

export interface ChatRequest {
  sessionId?: string;
  repositoryId: string;
  message: string;
  context?: ChatContext;
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  content: string;
  sources: RagChatSource[];
}

// ============================================================================
// Feature 9: ADR Generator
// ============================================================================

export interface ArchitectureDecision {
  id: string;
  repositoryId: string;
  adrNumber: number;
  title: string;
  status: ADRStatus;
  context: string;
  decision: string;
  consequences?: string;
  alternatives: ADRAlternative[];
  relatedPRs: string[];
  supersededBy?: string;
  deciders: string[];
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface ADRAlternative {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface ADRGenerationRequest {
  repositoryId: string;
  pullRequestId?: string;
  title?: string;
  context?: string;
}

export interface ADRTemplate {
  title: string;
  sections: {
    context: string;
    decision: string;
    consequences: string;
    alternatives: ADRAlternative[];
  };
}

// ============================================================================
// Feature 10: Slack/Teams Doc Bot
// ============================================================================

export interface BotConversation {
  id: string;
  platform: BotPlatform;
  channelId: string;
  threadId?: string;
  userId: string;
  query: string;
  response?: string;
  sources: ChatSource[];
  helpful?: boolean;
  createdAt: Date;
}

export type BotPlatform = 'slack' | 'teams';

export interface DocBotAlert {
  id: string;
  organizationId: string;
  channelId: string;
  platform: BotPlatform;
  alertType: 'drift' | 'health' | 'review';
  repositoryId?: string;
  documentId?: string;
  message: string;
  sentAt?: Date;
  acknowledged: boolean;
}

export interface BotCommand {
  command: string;
  description: string;
  usage: string;
  handler: string;
}

export const BOT_COMMANDS: BotCommand[] = [
  { command: '/docs search', description: 'Search documentation', usage: '/docs search <query>', handler: 'handleSearch' },
  { command: '/docs ask', description: 'Ask a question', usage: '/docs ask <question>', handler: 'handleAsk' },
  { command: '/docs health', description: 'Get doc health summary', usage: '/docs health [repo]', handler: 'handleHealth' },
  { command: '/docs subscribe', description: 'Subscribe to alerts', usage: '/docs subscribe <repo> <type>', handler: 'handleSubscribe' },
  { command: '/docs help', description: 'Show help', usage: '/docs help', handler: 'handleHelp' },
];

// ============================================================================
// Next-Gen V2: GitOps Configuration
// ============================================================================

export interface GitOpsConfig {
  version: '1';
  project?: { name?: string; description?: string; defaultLanguage?: string; languages?: string[] };
  triggers?: { onPRMerge?: boolean; onPush?: boolean; branches?: string[]; paths?: { include?: string[]; exclude?: string[] }; schedule?: string };
  documents?: Array<{ type: DocumentType; path: string; enabled?: boolean; template?: string; autoUpdate?: boolean }>;
  quality?: { minCoveragePercent?: number; minHealthScore?: number; failOnDecrease?: boolean; maxDecreasePercent?: number; blockMerge?: boolean };
  style?: { tone?: 'formal' | 'casual' | 'technical'; includeExamples?: boolean; maxSectionLength?: number; customInstructions?: string };
  integrations?: { slack?: { channel?: string; notifyOnGeneration?: boolean }; jira?: { project?: string; linkIssues?: boolean }; github?: { createPRComments?: boolean; createCheckRuns?: boolean } };
}

// ============================================================================
// Next-Gen V2: Federated Documentation Hub
// ============================================================================

export interface FederatedHub {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  slug: string;
  repositoryIds: string[];
  settings: FederatedHubSettings;
  navigationTree: NavigationNode[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FederatedHubSettings {
  customDomain?: string;
  theme?: 'light' | 'dark' | 'auto';
  branding?: { logo?: string; primaryColor?: string; title?: string };
  access?: 'public' | 'org-only' | 'private';
  search?: { enabled?: boolean; includeCode?: boolean };
}

export interface NavigationNode {
  id: string;
  label: string;
  type: 'repository' | 'document' | 'section' | 'link';
  path?: string;
  repositoryId?: string;
  documentId?: string;
  children?: NavigationNode[];
}

// ============================================================================
// Next-Gen V2: PR Documentation Review
// ============================================================================

export interface PRDocReview {
  id: string;
  repositoryId: string;
  prNumber: number;
  status: 'pending' | 'analyzing' | 'completed' | 'failed';
  analysis: PRDocReviewAnalysis;
  comments: PRDocReviewComment[];
  postedToSCM: boolean;
  createdAt: Date;
}

export interface PRDocReviewAnalysis {
  undocumentedExports: Array<{ name: string; filePath: string; line: number; type: string }>;
  brokenExamples: Array<{ filePath: string; line: number; issue: string }>;
  inconsistentTerms: Array<{ term: string; variants: string[]; suggestedTerm: string }>;
  staleSections: Array<{ documentPath: string; section: string; reason: string }>;
  suggestedFixes: Array<{ filePath: string; line: number; suggestion: string; confidence: number }>;
}

export interface PRDocReviewComment {
  id: string;
  filePath: string;
  line: number;
  body: string;
  severity: 'info' | 'warning' | 'error';
  confidence: number;
  suggestion?: string;
}

// ============================================================================
// Next-Gen V2: Collaborative Document Editor
// ============================================================================

export interface EditingSession {
  id: string;
  documentId: string;
  status: 'active' | 'closed' | 'merged';
  documentContent: string;
  participants: SessionParticipant[];
  operations: CRDTOperation[];
  approvals: SessionApproval[];
  createdAt: Date;
}

export interface SessionParticipant {
  userId: string;
  cursor: { line: number; column: number };
  lastActive: Date;
  color: string;
}

export interface CRDTOperation {
  type: 'insert' | 'delete' | 'format';
  position: number;
  content?: string;
  length?: number;
  format?: Record<string, unknown>;
  userId: string;
  timestamp: Date;
}

export interface SessionApproval {
  userId: string;
  status: 'approved' | 'request_changes';
  comment?: string;
  timestamp: Date;
}

// ============================================================================
// Next-Gen V2: API Changelog & Breaking Changes
// ============================================================================

export interface APIChangelog {
  id: string;
  repositoryId: string;
  version: string;
  baseRef: string;
  headRef: string;
  content: string;
  analysis: APIChangeAnalysis;
  publishedTo: string[];
  createdAt: Date;
}

export interface APIChangeAnalysis {
  addedEndpoints: EndpointChange[];
  modifiedEndpoints: EndpointChange[];
  deprecatedEndpoints: EndpointChange[];
  removedEndpoints: EndpointChange[];
  schemaChanges: SchemaChange[];
  breakingChanges: BreakingChange[];
  summary: string;
}

export interface EndpointChange {
  method: string;
  path: string;
  description: string;
  breaking: boolean;
}

export interface SchemaChange {
  schemaName: string;
  changeType: 'added' | 'modified' | 'removed';
  details: string;
  breaking: boolean;
}

export interface BreakingChange {
  type: 'endpoint_removed' | 'field_removed' | 'type_changed' | 'auth_changed' | 'response_changed';
  path: string;
  description: string;
  migrationHint: string;
}

// ============================================================================
// Next-Gen V2: Executive Reports
// ============================================================================

export interface ExecutiveReport {
  id: string;
  organizationId: string;
  format: 'json' | 'csv' | 'pdf';
  period: 'weekly' | 'monthly' | 'quarterly';
  startDate: Date;
  endDate: Date;
  metrics: ExecutiveMetrics;
  generatedAt: Date;
}

export interface ExecutiveMetrics {
  hoursSaved: number;
  costPerDoc: number;
  documentsFreshPercent: number;
  coveragePercent: number;
  teamAdoption: number;
  aiEfficiency: number;
  docsGenerated: number;
  docsUpdated: number;
  driftsCaught: number;
  breakingChangesDetected: number;
}

export interface KPIScorecard {
  documentationFreshness: { score: number; trend: 'up' | 'down' | 'stable' };
  coverage: { score: number; trend: 'up' | 'down' | 'stable' };
  teamAdoption: { score: number; trend: 'up' | 'down' | 'stable' };
  aiEfficiency: { score: number; trend: 'up' | 'down' | 'stable' };
}

// ============================================================================
// Next-Gen V2: SDK Documentation
// ============================================================================

export type SDKLanguage = 'python' | 'javascript' | 'typescript' | 'go' | 'java' | 'ruby' | 'csharp' | 'php' | 'rust' | 'swift';

export interface SDKDoc {
  id: string;
  repositoryId: string;
  language: SDKLanguage;
  version: string;
  content: string;
  sections: SDKSection[];
  examples: SDKCodeExample[];
  examplesValid: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SDKSection {
  title: string;
  content: string;
  codeBlocks: Array<{ language: string; code: string; description: string }>;
}

export interface SDKCodeExample {
  language: SDKLanguage;
  title: string;
  code: string;
  description: string;
  endpoint?: string;
}

// ============================================================================
// Next-Gen V2: Self-Hosted Deployment
// ============================================================================

export interface DeploymentConfig {
  llmProvider: 'anthropic' | 'openai' | 'ollama' | 'azure-openai' | 'aws-bedrock' | 'vllm';
  scmProvider: 'github' | 'gitlab' | 'bitbucket';
  selfHosted: boolean;
  airGapped: boolean;
  features: {
    vectorSearch: boolean;
    videoGeneration: boolean;
    compliance: boolean;
  };
}

export interface LLMProviderStatus {
  name: string;
  available: boolean;
  selfHosted: boolean;
  model?: string;
  latencyMs?: number;
}
