import { z } from '@hono/zod-openapi';

// ============================================================================
// Common Schemas
// ============================================================================

export const ErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
}).openapi('Error');

export const SuccessSchema = z.object({
  success: z.literal(true),
}).openapi('Success');

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  total: z.number().int(),
  hasMore: z.boolean(),
}).openapi('Pagination');

// ============================================================================
// Repository Schemas
// ============================================================================

export const RepositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Repository');

// ============================================================================
// Document Schemas
// ============================================================================

export const DocumentTypeSchema = z.enum([
  'readme', 'api', 'guide', 'tutorial', 'reference', 
  'changelog', 'contributing', 'architecture', 'adr', 'other'
]).openapi('DocumentType');

export const DocumentSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  path: z.string(),
  type: DocumentTypeSchema,
  title: z.string(),
  content: z.string(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Document');

// ============================================================================
// Health Dashboard Schemas
// ============================================================================

export const HealthStatusSchema = z.enum(['healthy', 'needs-attention', 'critical']).openapi('HealthStatus');

export const HealthScoreSchema = z.object({
  status: HealthStatusSchema,
  scores: z.object({
    freshness: z.number().min(0).max(100),
    completeness: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
  }),
  recommendations: z.array(z.string()),
}).openapi('HealthScore');

export const BadgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  earnedAt: z.string().datetime().optional(),
}).openapi('Badge');

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int(),
  repositoryId: z.string(),
  repositoryName: z.string(),
  score: z.number(),
  scoreChange: z.number(),
  docsCreated: z.number().int(),
  docsImproved: z.number().int(),
  streak: z.number().int(),
  badges: z.array(BadgeSchema),
}).openapi('LeaderboardEntry');

// ============================================================================
// Translation Schemas
// ============================================================================

export const TranslationSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  locale: z.string(),
  title: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in-progress', 'completed', 'needs-review']),
  translatedAt: z.string().datetime().nullable(),
}).openapi('Translation');

export const GlossaryEntrySchema = z.object({
  id: z.string(),
  term: z.string(),
  definition: z.string(),
  locale: z.string(),
  context: z.string().nullable(),
  doNotTranslate: z.boolean(),
}).openapi('GlossaryEntry');

// ============================================================================
// Knowledge Graph Schemas
// ============================================================================

export const EntityTypeSchema = z.enum([
  'document', 'concept', 'function', 'class', 'interface',
  'type', 'module', 'component', 'endpoint', 'event'
]).openapi('EntityType');

export const KnowledgeEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: EntityTypeSchema,
  description: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
}).openapi('KnowledgeEntity');

export const KnowledgeRelationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  type: z.string(),
  weight: z.number(),
}).openapi('KnowledgeRelation');

export const GraphClusterSchema = z.object({
  id: z.string(),
  label: z.string(),
  nodeIds: z.array(z.string()),
  color: z.string(),
}).openapi('GraphCluster');

// ============================================================================
// Collaborative Editing Schemas
// ============================================================================

export const EditSessionSchema = z.object({
  documentId: z.string(),
  version: z.number().int(),
  participants: z.array(z.object({
    userId: z.string(),
    color: z.string(),
    cursor: z.object({
      line: z.number().int(),
      column: z.number().int(),
    }).optional(),
  })),
  createdAt: z.string().datetime(),
}).openapi('EditSession');

export const CommentSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  userId: z.string(),
  text: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  resolved: z.boolean(),
  createdAt: z.string().datetime(),
  replies: z.array(z.object({
    id: z.string(),
    userId: z.string(),
    text: z.string(),
    createdAt: z.string().datetime(),
  })),
}).openapi('Comment');

// ============================================================================
// Compliance Schemas
// ============================================================================

export const ComplianceFrameworkSchema = z.enum(['soc2', 'gdpr', 'hipaa', 'iso27001']).openapi('ComplianceFramework');

export const ComplianceAssessmentSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  framework: ComplianceFrameworkSchema,
  score: z.number().min(0).max(100),
  status: z.enum(['compliant', 'partial', 'non-compliant']),
  gaps: z.array(z.object({
    requirementId: z.string(),
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    remediation: z.string(),
  })),
  assessedAt: z.string().datetime(),
}).openapi('ComplianceAssessment');

// ============================================================================
// Video Documentation Schemas
// ============================================================================

export const VideoScriptSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  scenes: z.array(z.object({
    title: z.string(),
    duration: z.number(),
    narration: z.string(),
    visuals: z.array(z.string()),
  })),
  totalDuration: z.number(),
  style: z.enum(['screencast', 'animated-slides', 'code-walkthrough']),
  createdAt: z.string().datetime(),
}).openapi('VideoScript');

export const RenderJobSchema = z.object({
  id: z.string(),
  scriptId: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  progress: z.number().min(0).max(100),
  outputUrl: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
}).openapi('RenderJob');

// ============================================================================
// Self-Healing Schemas
// ============================================================================

export const IssueTypeSchema = z.enum([
  'broken-link', 'outdated-reference', 'terminology-drift',
  'missing-section', 'deprecated-api', 'code-mismatch'
]).openapi('IssueType');

export const DocumentIssueSchema = z.object({
  id: z.string(),
  type: IssueTypeSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  documentId: z.string(),
  documentPath: z.string(),
  description: z.string(),
  suggestedFix: z.string().nullable(),
  autoFixable: z.boolean(),
  detectedAt: z.string().datetime(),
}).openapi('DocumentIssue');

export const HealingResultSchema = z.object({
  issueId: z.string(),
  status: z.enum(['fixed', 'failed', 'skipped']),
  originalContent: z.string().optional(),
  newContent: z.string().optional(),
  error: z.string().optional(),
}).openapi('HealingResult');

// ============================================================================
// Test Runner Schemas
// ============================================================================

export const TestFrameworkSchema = z.enum([
  'jest', 'vitest', 'mocha', 'pytest', 'go-test', 'cargo-test'
]).openapi('TestFramework');

export const TestResultSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  framework: TestFrameworkSchema,
  passed: z.boolean(),
  totalTests: z.number().int(),
  passedTests: z.number().int(),
  failedTests: z.number().int(),
  skippedTests: z.number().int(),
  duration: z.number(),
  errors: z.array(z.object({
    testName: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  })),
  runAt: z.string().datetime(),
}).openapi('TestResult');

export const CIProviderSchema = z.enum([
  'github-actions', 'gitlab-ci', 'circleci', 'jenkins'
]).openapi('CIProvider');

// ============================================================================
// Export all schemas
// ============================================================================

export const schemas = {
  Error: ErrorSchema,
  Success: SuccessSchema,
  Pagination: PaginationSchema,
  Repository: RepositorySchema,
  Document: DocumentSchema,
  DocumentType: DocumentTypeSchema,
  HealthStatus: HealthStatusSchema,
  HealthScore: HealthScoreSchema,
  Badge: BadgeSchema,
  LeaderboardEntry: LeaderboardEntrySchema,
  Translation: TranslationSchema,
  GlossaryEntry: GlossaryEntrySchema,
  EntityType: EntityTypeSchema,
  KnowledgeEntity: KnowledgeEntitySchema,
  KnowledgeRelation: KnowledgeRelationSchema,
  GraphCluster: GraphClusterSchema,
  EditSession: EditSessionSchema,
  Comment: CommentSchema,
  ComplianceFramework: ComplianceFrameworkSchema,
  ComplianceAssessment: ComplianceAssessmentSchema,
  VideoScript: VideoScriptSchema,
  RenderJob: RenderJobSchema,
  IssueType: IssueTypeSchema,
  DocumentIssue: DocumentIssueSchema,
  HealingResult: HealingResultSchema,
  TestFramework: TestFrameworkSchema,
  TestResult: TestResultSchema,
  CIProvider: CIProviderSchema,
};
