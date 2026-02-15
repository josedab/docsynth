export {
  analyzeChanges,
  detectPublicAPIChanges,
  suggestDocumentTypes,
  type ChangeAnalysisResult,
  type FileChange,
  type GenerationResult,
} from './analyzer.js';

export {
  generateDocumentation,
  generateReadmeSection,
  generateChangelogEntry,
  type GenerationOptions,
} from './generator.js';

export { formatAsMarkdown, formatAsPRBody, formatAsJSON } from './formatter.js';

export {
  extractCodeBlocks,
  normalizeLanguage,
  isSupportedLanguage,
  validateCodeBlock,
  validateDocument,
  type SupportedLanguage,
  type CodeBlock,
  type ValidationResult,
  type ValidationError,
  type DocumentValidationResult,
} from './doc-testing.js';

export {
  extractLinks,
  classifyLink,
  extractHeadingSlugs,
  validateDocumentLinks,
  validateLink,
  type LinkValidationResult,
  type DocumentLinkReport,
  type LinkValidationOptions,
} from './link-validator.js';

export {
  calculateHealthScore,
  generateBadgeUrl,
  generateBadgeSvg,
  generateBadgeMarkdown,
  type DocHealthInput,
  type DocHealthScore,
} from './doc-health-badge.js';

export {
  createCodeDocMapping,
  findAffectedSections,
  calculateImpactScore,
  scoreSeverity,
  classifyChange,
  generateBatchImpactReport,
  prioritiseSections,
  type ChangeClassification,
  type SeverityLevel,
  type CodeEntity,
  type DocSection,
  type CodeDocMapping,
  type ChangeEntry,
  type ImpactResult,
  type BatchImpactReport,
} from './impact-analysis.js';

export {
  formatNotification,
  formatSlackMessage,
  formatGitHubComment,
  formatEmailBody,
  digestResults,
  severityTemplate,
  type NotificationChannel,
  type NotificationOptions,
  type SlackBlock,
  type SlackMessage,
} from './impact-notifications.js';

export {
  getTierConfig,
  calculateBilling,
  validatePartnerApiKey,
  checkRateLimit,
  generateOnboardingChecklist,
  TIER_CONFIGS,
  type PartnerTier,
  type TierConfig,
  type PartnerConfig,
  type UsageBillingInput,
  type BillingBreakdown,
  type OnboardingStep,
  type ApiKeyValidation,
} from './partner-management.js';

export {
  computeMetrics,
  aggregateUsage,
  estimateCost,
  detectAnomalies,
  detectErrorSurge,
  generateUsageReport,
  type AggregationPeriod,
  type ApiCallRecord,
  type UsageMetrics,
  type UsageSummary,
  type EndpointBreakdown,
  type CostEstimate,
  type AnomalyResult,
  type UsageReport,
} from './usage-metering.js';

export {
  createBucket,
  refillBucket,
  consumeToken,
  createRateLimiter,
  formatRateLimitHeaders,
  type RateLimiterConfig,
  type TokenBucket,
  type RateLimitResult,
  type RateLimitHeaders,
} from './rate-limiter.js';

export {
  detectFramework,
  encodeCodeSandboxPayload,
  generateCodeSandboxUrl,
  generateStackBlitzUrl,
  generateEmbed,
  generateAllEmbeds,
  type SandboxFramework,
  type SandboxProvider,
  type SandboxEmbedOptions,
  type SandboxEmbedResult,
} from './sandbox-embedding.js';

export {
  createRng,
  generateUuid,
  generateDate,
  generateEmail,
  generatePhone,
  generateUrl,
  generateUser,
  generateProduct,
  generateOrder,
  generateRelatedDataSet,
  formatDataSet,
  type DataFormat,
  type DataEntityType,
  type TestDataOptions,
  type GeneratedUser,
  type GeneratedProduct,
  type GeneratedOrder,
  type GeneratedAddress,
  type RelatedDataSet,
} from './test-data-generator.js';

export {
  generateShareUrl,
  generatePlatformShareUrls,
  generateOpenGraphMeta,
  generateTwitterCardMeta,
  generateMetaTagsHtml,
  generateEmbedSnippet,
  recordShareEvent,
  summarizeShareAnalytics,
  type SharePlatform,
  type EmbedFormat,
  type ShareableExample,
  type ShareUrlResult,
  type OpenGraphMeta,
  type TwitterCardMeta,
  type EmbedSnippet,
  type ShareAnalyticsEntry,
  type ShareAnalyticsSummary,
} from './example-sharing.js';

export {
  recordFeedback,
  getFeedbackStore,
  clearFeedbackStore,
  calculateAcceptanceRates,
  identifyCommonModifications,
  buildProfile,
  scoreSuggestion,
  type SuggestionType,
  type FeedbackAction,
  type SuggestionFeedback,
  type TypeAcceptanceRate,
  type CommonModification,
  type SuggestionProfile,
} from './suggestion-learning.js';

export {
  scanForUndocumented,
  prioritizeSuggestions,
  generateBatchReport,
  type EntityKind,
  type UndocumentedEntity,
  type SuggestionPriority,
  type BatchReportSummary,
  type BatchReport,
  type ScanOptions,
} from './batch-suggestions.js';

export {
  analyzeStyle,
  scoreConsistency,
  suggestStyleAdjustments,
  type ToneLevel,
  type VerbosityLevel,
  type TechnicalDepth,
  type StyleDimensions,
  type StyleProfile,
  type StyleAdjustment,
  type ConsistencyResult,
} from './style-personalization.js';

export {
  detectGaps,
  detectSearchGaps,
  detectBounceGaps,
  detectUndocumentedCode,
  rankGaps,
  generateGapReport,
  type GapSeverity,
  type SearchQuery,
  type PageBounce,
  type CodePath,
  type ContentGap,
  type GapReport,
} from './content-gap-detector.js';

export {
  createExperiment,
  assignVariant,
  chiSquareTest,
  calculateResults,
  type Variant,
  type Experiment,
  type ConversionEvent,
  type VariantResult,
  type ExperimentResults,
} from './ab-testing.js';

export {
  predictStaleness,
  calculateDecayCurve,
  detectSeasonalPatterns,
  generateMaintenanceSchedule,
  type UrgencyLevel,
  type CodeChangeRecord,
  type DocRecord,
  type PredictionResult,
  type MaintenanceTask,
  type MaintenanceSchedule,
  type DecayPoint,
  type SeasonalPattern,
} from './predictive-analytics.js';

export {
  generateAudioScript,
  estimateAudioDuration,
  generateChapterMarkers,
  generateAudioMetadata,
  generatePodcastSummary,
  type AudioScript,
  type AudioSection,
  type AudioFormat,
  type AudioMetadata,
  type ChapterMarker,
  type TTSProvider,
} from './audio-summary.js';

export {
  generateAltText,
  generateCaptions,
  checkWCAGCompliance,
  checkColorContrast,
  generateScreenReaderSummary,
  scoreAccessibility,
  type AccessibilityResult,
  type AccessibilityIssue,
  type CaptionEntry,
  type CaptionFormat,
  type AltTextResult,
  type ContrastResult,
} from './accessibility.js';

export {
  getVoiceConfig,
  generateVoiceoverScript,
  estimateVoiceoverDuration,
  SUPPORTED_VOICES,
  type VoiceConfig,
  type VoiceoverScript,
  type VoiceoverSegment,
  type PronunciationHint,
} from './multi-lang-voiceover.js';

export {
  getFramework,
  mapCodePatterns,
  generateChecklist,
  scoreCompliance,
  type FrameworkId,
  type ComplianceFramework,
  type ComplianceControl,
  type ComplianceChecklist,
  type ComplianceScore,
  type ChecklistItem,
  type EvidenceType as ComplianceEvidenceType,
} from './compliance-templates.js';

export {
  collectEvidence,
  generateManifest,
  buildTimeline,
  exportPackage,
  formatAsCSV,
  formatAsPDFMetadata,
  type EvidencePackage,
  type EvidenceItem,
  type EvidenceManifest,
  type ChainOfCustody,
  type TimelineEvent,
  type ExportFormat,
  type EvidenceType as ExportEvidenceType,
} from './evidence-export.js';

export {
  createIntegration,
  formatForProvider,
  generateWebhookPayload,
  buildSyncStatus,
  getProviderConfig,
  validateIntegration,
  type GRCProvider,
  type GRCIntegration,
  type SyncMode,
  type SyncStatus,
  type SyncError,
  type WebhookPayload,
  type GRCComplianceItem,
  type ProviderMapping,
} from './grc-integration.js';

export {
  parseMentions,
  resolveMentions,
  formatMentionNotification,
  formatMentionHtml,
  formatMentionMarkdown,
  trackMentionStats,
  getMentionSuggestions,
  type Mention,
  type ResolvedMention,
  type MentionNotification,
  type MentionSuggestion,
  type MentionStats,
  type UserDirectory,
} from './mentions.js';

export {
  createWorkflow,
  submitForApproval,
  recordDecision,
  evaluateAutoApprove,
  checkPolicy,
  calculateTimeToApprove,
  getApprovalSummary,
  type ApprovalState,
  type ReviewStrategy,
  type ApprovalWorkflow,
  type AutoApproveRule,
  type ReviewDecision,
  type ApprovalSummary,
} from './approval-workflow.js';

export {
  createPresenceRoom,
  updatePresence,
  removePresence,
  applyHeartbeatTimeouts,
  getDocumentPresence,
  getSectionPresence,
  calculateOverlap,
  generatePresenceIndicators,
  type PresenceState,
  type UserPresence,
  type CursorPosition,
  type SelectionRange,
  type PresenceRoom,
  type OverlapResult,
} from './presence.js';

export {
  detectChanges,
  calculateStaleness,
  prioritizeUpdates,
  generateStalenessReport,
  type TranslationChange,
  type ChangeMagnitude,
  type StalenessInfo,
  type StalenessReport,
  type TranslationPriority,
} from './translation-change-detector.js';

export {
  triggerCascade,
  getCascadeStatus,
  updateCascadeItem,
  generateCascadeReport,
  clearCascades,
  type CascadeConfig,
  type CascadeStrategy,
  type CascadeItemStatus,
  type CascadeItem,
  type CascadeStatus,
  type CascadeReport,
  type CascadeLanguageReport,
} from './translation-cascade.js';

export {
  createGlossary,
  addEntry,
  detectTerms,
  validateConsistency,
  exportGlossary,
  importGlossary,
  getGlossaryCoverage,
  type GlossaryEntry,
  type Glossary,
  type GlossaryFormat,
  type TermMatch,
  type ConsistencyIssue,
  type ConsistencyReport,
  type GlossaryCoverage,
} from './glossary-management.js';
