/**
 * Route Registry
 *
 * Organizes and registers all API routes in a maintainable way.
 * Routes are grouped by feature domain for better organization.
 */

import type { Hono } from 'hono';

// Core routes
import { healthRoutes } from './health.js';
import { webhookRoutes } from './webhooks.js';
import { authRoutes } from './auth.js';

// Repository & Document routes
import { repoRoutes } from './repositories.js';
import { documentRoutes } from './documents.js';
import { jobRoutes } from './jobs.js';

// Organization routes
import { billingRoutes } from './billing.js';
import { teamRoutes } from './team.js';
import { enterpriseRoutes } from './enterprise.js';

// Analytics routes
import { analyticsRoutes } from './analytics.js';
import { analyticsRoutes as docAnalyticsRoutes } from './doc-analytics.js';
import { healthDashboardRoutes } from './health-dashboard.js';
import { coverageRoutes } from './coverage.js';

// Documentation features
import { diagramRoutes } from './diagrams.js';
import { templateRoutes } from './templates.js';
import { translationRoutes } from './translations.js';
import { chatRoutes } from './chat.js';
import { knowledgeGraphRoutes } from './knowledge-graph.js';
import { docTestRoutes } from './doc-tests.js';
import { interactiveExamplesRoutes } from './interactive-examples.js';
import docValidationRoutes from './doc-testing.js';
import { docTestingV2Routes } from './doc-testing-v2.js';

// Advanced documentation features
import { docReviewCopilotRoutes } from './doc-review-copilot.js';
import { translationRoutes as multiLangRoutes } from './translation.js';
import { diagramRoutes as archDiagramRoutes } from './diagram.js';
import { adrRoutes } from './adr.js';
import { videoDocRoutes } from './video-docs.js';

// Integration routes
import integrationsRoutes from './integrations.js';
import { botRoutes } from './bot.js';
import { ideRoutes } from './ide.js';
import { onboardingRoutes } from './onboarding.js';

// Next-gen features
import { collaborativeRoutes } from './collaborative.js';
import { complianceRoutes } from './compliance.js';
import { selfHealingRoutes } from './self-healing.js';
import { qaAgentRoutes } from './qa-agent.js';
import { semverRoutes } from './semver.js';

// New killer features
import { driftPredictionRoutes } from './drift-prediction.js';
import citationRoutes from './citation.js';
import executableDocsRoutes from './executable-docs.js';
import reviewWorkflowRoutes from './review-workflow.js';
import multiAgentDocRoutes from './multi-agent-doc.js';
import onboardingPathsRoutes from './onboarding-paths.js';
import { onboardingPathsV2Routes } from './onboarding-paths-v2.js';
import interactivePlaygroundRoutes from './interactive-playground.js';

// Next-gen features (from planning)
import { reviewDocumentationRoutes } from './review-documentation.js';
import { coverageGateRoutes } from './coverage-gate.js';
import { aiDocEditorRoutes } from './ai-doc-editor.js';
import { llmUsageRoutes } from './llm-usage.js';
import { docImpactRoutes } from './doc-impact.js';
import { migrationRoutes } from './migration.js';
import { multiRepoGraphRoutes } from './multi-repo-graph.js';
import { roiAnalyticsRoutes } from './roi-analytics.js';
import { nlEditorRoutes } from './nl-editor.js';

// Community features
import { hubRoutes } from './hub.js';
import { communityRoutes } from './community.js';
import { playgroundRoutes } from './playground.js';

// Polling feature
import { pollingRoutes } from './polling.js';

// SCM Provider Support
import { scmProviderRoutes } from './scm-providers.js';

// Next-gen features (v2)
import { gitopsRoutes } from './gitops.js';
import { prDocReviewRoutes } from './pr-doc-review.js';
import { federatedHubRoutes } from './federated-hub.js';
import { onboardingCopilotRoutes } from './onboarding-copilot.js';
import { collaborativeEditorRoutes } from './collaborative-editor.js';
import { apiChangelogRoutes } from './api-changelog.js';
import { executiveReportsRoutes } from './executive-reports.js';
import { sdkDocsRoutes } from './sdk-docs.js';

// Next-gen features (v3)
import { smartDiffRoutes } from './smart-diff.js';
import { docQualityScoreRoutes } from './doc-quality-score.js';
import { autoHealingRoutes } from './auto-healing.js';
import { multiRepoGraphV2Routes } from './multi-repo-graph-v2.js';
import { roiDashboardV2Routes } from './roi-dashboard-v2.js';
import { interactiveExamplesV2Routes } from './interactive-examples-v2.js';
import { complianceScanV2Routes } from './compliance-scan-v2.js';
import { multiLangDocRoutes } from './multi-lang-doc.js';
import { docDrivenDevRoutes } from './doc-driven-dev.js';
import { docChatbotRoutes } from './doc-chatbot.js';

// Feature #9: Enhanced Documentation Impact Scoring
import { impactScoringRoutes } from './impact-scoring.js';

// Feature #7: LLM Cost Optimizer & Budget Controls
import { llmCostOptimizerRoutes } from './llm-cost-optimizer.js';

// Feature #2: AI Documentation Linter
import { docLinterRoutes } from './doc-linter.js';

// Feature #10: OpenAPI/GraphQL Spec-Aware Generation
import { specAwareDocsRoutes } from './spec-aware-docs.js';

// Feature #4: Documentation-as-Tests
import { docAsTestsRoutes } from './doc-as-tests.js';

// Feature #5: Smart Monorepo Documentation Hub
import { monorepoHubRoutes } from './monorepo-hub.js';

// Feature #6: Real-Time Collaborative Documentation Editor
import { realtimeEditorRoutes } from './realtime-editor.js';

// Feature #8: Embeddable Documentation Widget
import { widgetRoutes } from './widget.js';

// Next-gen v4 features
import { autopilotRoutes } from './autopilot.js';
import { prReviewBotRoutes } from './pr-review-bot.js';
import { coverageCIGateRoutes } from './coverage-ci-gate.js';
import { onboardingGeneratorRoutes } from './onboarding-generator.js';
import { translationSyncRoutes } from './translation-sync.js';
import { docTestsRuntimeRoutes } from './doc-tests-runtime.js';
import { selfHealingAutoRoutes } from './self-healing-auto.js';
import { widgetContextualRoutes } from './widget-contextual.js';
import { roiExecutiveRoutes } from './roi-executive.js';
import { federatedSearchRoutes } from './federated-search.js';

// Next-gen v5 features
import { docAgentRoutes } from './doc-agent.js';
import { copilotExtensionRoutes } from './copilot-extension.js';
import { docDiffStagingRoutes } from './doc-diff-staging.js';
import { knowledgeBaseRAGRoutes } from './knowledge-base-rag.js';
import { teamCollaborationRoutes } from './team-collaboration.js';
import { docAnalyticsInsightsRoutes } from './doc-analytics-insights.js';
import { frameworkTemplatesRoutes } from './framework-templates.js';
import { docGovernanceRoutes } from './doc-governance.js';
import { docMigrationEngineRoutes } from './doc-migration-engine.js';
import { onboardingIntelligenceRoutes } from './onboarding-intelligence.js';

// Next-gen v6 features
import { docsGitOpsRoutes } from './docs-gitops.js';
import { pairWritingRoutes } from './pair-writing.js';
import { docSupplyChainRoutes } from './doc-supply-chain.js';
import { docPortalRoutes } from './doc-portal.js';
import { impactAttributionRoutes } from './impact-attribution.js';
import { docQualityBenchmarkRoutes } from './doc-quality-benchmark.js';
import { docWebhooksRoutes } from './doc-webhooks.js';
import { docABTestingRoutes } from './doc-ab-testing.js';
import { offlineSyncRoutes } from './offline-sync.js';
import { docGamificationRoutes } from './doc-gamification.js';

// Next-gen v7 features
import { docLSPRoutes } from './doc-lsp.js';
import { docDepGraphRoutes } from './doc-dep-graph.js';
import { docSemverRoutes } from './doc-semver.js';
import { docQLRoutes } from './doc-ql.js';
import { docFederationRoutes } from './doc-federation.js';
import { docRegressionRoutes } from './doc-regression.js';
import { docContextTranslationRoutes } from './doc-context-translation.js';
import { docHealthBadgeRoutes } from './doc-health-badge.js';
import { docPlaygroundRoutes } from './doc-playground.js';
import { docForecastRoutes } from './doc-forecast.js';

// ============================================================================
// Route Configuration
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface RouteConfig {
  path: string;
  router: AnyHono;
  description?: string;
}

/**
 * Core system routes (health, webhooks, auth)
 */
const coreRoutes: RouteConfig[] = [
  { path: '/health', router: healthRoutes, description: 'Health checks' },
  { path: '/webhooks', router: webhookRoutes, description: 'GitHub webhooks' },
  { path: '/auth', router: authRoutes, description: 'Authentication' },
];

/**
 * Repository and document management routes
 */
const repositoryRoutes: RouteConfig[] = [
  { path: '/api/repositories', router: repoRoutes, description: 'Repository management' },
  { path: '/api/documents', router: documentRoutes, description: 'Document management' },
  { path: '/api/jobs', router: jobRoutes, description: 'Background jobs' },
  {
    path: '/api/scm-providers',
    router: scmProviderRoutes,
    description: 'SCM provider management (GitHub, GitLab, Bitbucket)',
  },
];

/**
 * Organization and billing routes
 */
const organizationRoutes: RouteConfig[] = [
  { path: '/api/billing', router: billingRoutes, description: 'Billing and subscriptions' },
  { path: '/api/team', router: teamRoutes, description: 'Team management' },
  { path: '/api/enterprise', router: enterpriseRoutes, description: 'Enterprise features' },
];

/**
 * Analytics and monitoring routes
 */
const analyticsFeatureRoutes: RouteConfig[] = [
  { path: '/api/analytics', router: analyticsRoutes, description: 'General analytics' },
  {
    path: '/api/doc-analytics',
    router: docAnalyticsRoutes,
    description: 'Documentation analytics',
  },
  { path: '/api/health-dashboard', router: healthDashboardRoutes, description: 'Health dashboard' },
  { path: '/api/coverage', router: coverageRoutes, description: 'Documentation coverage' },
  { path: '/api/llm-usage', router: llmUsageRoutes, description: 'LLM usage and cost monitoring' },
  {
    path: '/api/llm-cost-optimizer',
    router: llmCostOptimizerRoutes,
    description: 'LLM cost optimization and budget controls',
  },
  {
    path: '/api/roi-analytics',
    router: roiAnalyticsRoutes,
    description: 'ROI analytics and dashboard',
  },
];

/**
 * Documentation generation and management routes
 */
const documentationRoutes: RouteConfig[] = [
  { path: '/api/diagrams', router: diagramRoutes, description: 'Diagram generation' },
  { path: '/api/templates', router: templateRoutes, description: 'Document templates' },
  { path: '/api/translations', router: translationRoutes, description: 'Translations' },
  { path: '/api/chat', router: chatRoutes, description: 'Documentation chat' },
  { path: '/api/knowledge-graph', router: knowledgeGraphRoutes, description: 'Knowledge graph' },
  { path: '/api/doc-tests', router: docTestRoutes, description: 'Documentation tests' },
  { path: '/api/examples', router: interactiveExamplesRoutes, description: 'Interactive examples' },
  {
    path: '/api/doc-validation',
    router: docValidationRoutes,
    description: 'Documentation validation',
  },
  {
    path: '/api/doc-testing-v2',
    router: docTestingV2Routes,
    description: 'AI Documentation Testing (code execution)',
  },
  {
    path: '/api/doc-linter',
    router: docLinterRoutes,
    description: 'Documentation linting and style checking',
  },
  {
    path: '/api/doc-as-tests',
    router: docAsTestsRoutes,
    description: 'Documentation-as-Tests: run doc examples as tests',
  },
];

/**
 * Advanced documentation feature routes
 */
const advancedDocRoutes: RouteConfig[] = [
  { path: '/api/doc-review', router: docReviewCopilotRoutes, description: 'AI doc review' },
  { path: '/api/multi-lang', router: multiLangRoutes, description: 'Multi-language support' },
  { path: '/api/arch-diagrams', router: archDiagramRoutes, description: 'Architecture diagrams' },
  { path: '/api/adr', router: adrRoutes, description: 'Architecture Decision Records' },
  { path: '/api/video-docs', router: videoDocRoutes, description: 'Video documentation' },
];

/**
 * Integration and tooling routes
 */
const integrationRoutes: RouteConfig[] = [
  {
    path: '/api/integrations',
    router: integrationsRoutes,
    description: 'Third-party integrations',
  },
  { path: '/api/bot', router: botRoutes, description: 'Bot commands' },
  { path: '/api/ide', router: ideRoutes, description: 'IDE integration' },
  { path: '/api/onboarding', router: onboardingRoutes, description: 'User onboarding' },
  { path: '/api/widget', router: widgetRoutes, description: 'Embeddable documentation widget' },
];

/**
 * Next-generation feature routes
 */
const nextGenRoutes: RouteConfig[] = [
  { path: '/api/collaborative', router: collaborativeRoutes, description: 'Collaborative editing' },
  { path: '/api/compliance', router: complianceRoutes, description: 'Compliance checking' },
  { path: '/api/self-healing', router: selfHealingRoutes, description: 'Self-healing docs' },
  { path: '/api/qa-agent', router: qaAgentRoutes, description: 'QA agent' },
  { path: '/api/semver', router: semverRoutes, description: 'Semantic versioning' },
  { path: '/api/drift-prediction', router: driftPredictionRoutes, description: 'Drift prediction' },
  { path: '/api/citations', router: citationRoutes, description: 'Smart search with citations' },
  {
    path: '/api/executable-docs',
    router: executableDocsRoutes,
    description: 'Executable documentation testing',
  },
  {
    path: '/api/review-workflow',
    router: reviewWorkflowRoutes,
    description: 'Collaborative review workflows',
  },
  {
    path: '/api/multi-agent',
    router: multiAgentDocRoutes,
    description: 'Multi-agent documentation generation',
  },
  {
    path: '/api/onboarding-paths',
    router: onboardingPathsRoutes,
    description: 'Personalized onboarding paths',
  },
  {
    path: '/api/onboarding-paths-v2',
    router: onboardingPathsV2Routes,
    description: 'Personalized onboarding paths V2 (role-specific)',
  },
  {
    path: '/api/interactive-playground',
    router: interactivePlaygroundRoutes,
    description: 'Interactive code playgrounds',
  },
  {
    path: '/api/review-documentation',
    router: reviewDocumentationRoutes,
    description: 'AI code review documentation',
  },
  {
    path: '/api/coverage-gate',
    router: coverageGateRoutes,
    description: 'Documentation coverage CI/CD gate',
  },
  {
    path: '/api/ai-editor',
    router: aiDocEditorRoutes,
    description: 'AI-powered documentation editor',
  },
  {
    path: '/api/nl-editor',
    router: nlEditorRoutes,
    description: 'Natural language documentation editing',
  },
  {
    path: '/api/doc-impact',
    router: docImpactRoutes,
    description: 'PR documentation impact analysis',
  },
  {
    path: '/api/migration',
    router: migrationRoutes,
    description: 'Smart migration engine for importing docs',
  },
  {
    path: '/api/polling',
    router: pollingRoutes,
    description: 'Webhook-less change detection via polling',
  },
  {
    path: '/api/multi-repo-graph',
    router: multiRepoGraphRoutes,
    description: 'Multi-repository documentation graph',
  },
  // Next-gen features v2
  {
    path: '/api/gitops',
    router: gitopsRoutes,
    description: 'GitOps documentation-as-code configuration',
  },
  {
    path: '/api/pr-doc-review',
    router: prDocReviewRoutes,
    description: 'AI documentation review in PR comments',
  },
  {
    path: '/api/federated-hub',
    router: federatedHubRoutes,
    description: 'Federated multi-repo documentation hub',
  },
  {
    path: '/api/onboarding-copilot',
    router: onboardingCopilotRoutes,
    description: 'Smart onboarding copilot with personalized paths',
  },
  {
    path: '/api/collaborative-editor',
    router: collaborativeEditorRoutes,
    description: 'Real-time collaborative document editor',
  },
  {
    path: '/api/api-changelog',
    router: apiChangelogRoutes,
    description: 'Automated API changelog and breaking change alerts',
  },
  {
    path: '/api/executive-reports',
    router: executiveReportsRoutes,
    description: 'Executive ROI reports and dashboards',
  },
  {
    path: '/api/sdk-docs',
    router: sdkDocsRoutes,
    description: 'Multi-language SDK documentation generator',
  },
  // Next-gen features v3
  {
    path: '/api/smart-diff',
    router: smartDiffRoutes,
    description: 'Smart semantic documentation diff viewer',
  },
  {
    path: '/api/doc-quality',
    router: docQualityScoreRoutes,
    description: 'AI documentation quality scoring',
  },
  {
    path: '/api/auto-healing',
    router: autoHealingRoutes,
    description: 'Auto-healing documentation issues',
  },
  {
    path: '/api/knowledge-graph-v2',
    router: multiRepoGraphV2Routes,
    description: 'Multi-repo knowledge graph V2',
  },
  {
    path: '/api/roi-dashboard-v2',
    router: roiDashboardV2Routes,
    description: 'Documentation ROI dashboard V2',
  },
  {
    path: '/api/examples-v2',
    router: interactiveExamplesV2Routes,
    description: 'Interactive code examples V2',
  },
  {
    path: '/api/compliance-v2',
    router: complianceScanV2Routes,
    description: 'Compliance & security scanner V2',
  },
  {
    path: '/api/multi-lang-v2',
    router: multiLangDocRoutes,
    description: 'Multi-language documentation V2',
  },
  {
    path: '/api/doc-driven-dev',
    router: docDrivenDevRoutes,
    description: 'Doc-driven development mode',
  },
  {
    path: '/api/chatbot',
    router: docChatbotRoutes,
    description: 'Documentation chatbot for support',
  },
  {
    path: '/api/impact-scoring',
    router: impactScoringRoutes,
    description: 'Enhanced documentation impact scoring for PRs',
  },
  {
    path: '/api/spec-docs',
    router: specAwareDocsRoutes,
    description: 'OpenAPI/GraphQL spec-aware documentation generation',
  },
  {
    path: '/api/monorepo-hub',
    router: monorepoHubRoutes,
    description: 'Smart monorepo documentation hub',
  },
  {
    path: '/api/realtime-editor',
    router: realtimeEditorRoutes,
    description: 'Real-time collaborative documentation editor',
  },
  // Next-gen v4 features
  {
    path: '/api/autopilot',
    router: autopilotRoutes,
    description: 'Zero-config documentation autopilot mode',
  },
  {
    path: '/api/pr-review-bot',
    router: prReviewBotRoutes,
    description: 'PR review bot with inline doc suggestions',
  },
  {
    path: '/api/coverage-ci-gate',
    router: coverageCIGateRoutes,
    description: 'AST-based documentation coverage CI gate',
  },
  {
    path: '/api/onboarding-generator',
    router: onboardingGeneratorRoutes,
    description: 'Interactive onboarding path generator',
  },
  {
    path: '/api/translation-sync',
    router: translationSyncRoutes,
    description: 'Multi-language documentation sync with glossaries',
  },
  {
    path: '/api/doc-tests-runtime',
    router: docTestsRuntimeRoutes,
    description: 'Doc-as-tests runtime: extract and execute code examples',
  },
  {
    path: '/api/self-healing-auto',
    router: selfHealingAutoRoutes,
    description: 'Autonomous self-healing documentation',
  },
  {
    path: '/api/widget-contextual',
    router: widgetContextualRoutes,
    description: 'Contextual documentation widget with URL matching',
  },
  {
    path: '/api/roi-executive',
    router: roiExecutiveRoutes,
    description: 'Executive ROI dashboard and reports',
  },
  {
    path: '/api/federated-search',
    router: federatedSearchRoutes,
    description: 'Federated cross-repo documentation search',
  },
  // Next-gen v5 features
  {
    path: '/api/doc-agent',
    router: docAgentRoutes,
    description: 'AI documentation agent with agentic reasoning loop',
  },
  {
    path: '/api/copilot-extension',
    router: copilotExtensionRoutes,
    description: 'GitHub Copilot extension @docsynth commands',
  },
  {
    path: '/api/doc-diff-staging',
    router: docDiffStagingRoutes,
    description: 'Smart documentation diff and staging workflow',
  },
  {
    path: '/api/knowledge-base',
    router: knowledgeBaseRAGRoutes,
    description: 'RAG 2.0 knowledge base with citations',
  },
  {
    path: '/api/team-collaboration',
    router: teamCollaborationRoutes,
    description: 'Multi-reviewer doc approval workflows',
  },
  {
    path: '/api/doc-analytics-insights',
    router: docAnalyticsInsightsRoutes,
    description: 'Documentation analytics and reader behavior insights',
  },
  {
    path: '/api/framework-templates',
    router: frameworkTemplatesRoutes,
    description: 'Multi-framework documentation templates',
  },
  {
    path: '/api/doc-governance',
    router: docGovernanceRoutes,
    description: 'Documentation governance and compliance enforcement',
  },
  {
    path: '/api/doc-migration',
    router: docMigrationEngineRoutes,
    description: 'Incremental documentation migration engine',
  },
  {
    path: '/api/onboarding-intelligence',
    router: onboardingIntelligenceRoutes,
    description: 'Developer onboarding intelligence and journey tracking',
  },
  // Next-gen v6 features
  {
    path: '/api/docs-gitops',
    router: docsGitOpsRoutes,
    description: 'Docs-as-Infrastructure with plan/apply GitOps semantics',
  },
  {
    path: '/api/pair-writing',
    router: pairWritingRoutes,
    description: 'Real-time AI co-pilot pair writing sessions',
  },
  {
    path: '/api/doc-supply-chain',
    router: docSupplyChainRoutes,
    description: 'Documentation supply chain security and attestation',
  },
  {
    path: '/api/doc-portal',
    router: docPortalRoutes,
    description: 'Multi-tenant white-labeled documentation portals',
  },
  {
    path: '/api/impact-attribution',
    router: impactAttributionRoutes,
    description: 'Documentation impact attribution and ROI correlation',
  },
  {
    path: '/api/doc-quality-benchmark',
    router: docQualityBenchmarkRoutes,
    description: 'AI documentation quality benchmark and leaderboard',
  },
  {
    path: '/api/doc-webhooks',
    router: docWebhooksRoutes,
    description: 'Event-driven documentation webhooks',
  },
  {
    path: '/api/doc-ab-testing',
    router: docABTestingRoutes,
    description: 'Documentation A/B testing experiments',
  },
  {
    path: '/api/offline-sync',
    router: offlineSyncRoutes,
    description: 'Offline-first documentation sync',
  },
  {
    path: '/api/doc-gamification',
    router: docGamificationRoutes,
    description: 'Documentation skill tree and gamification',
  },
  // Next-gen v7 features
  {
    path: '/api/doc-lsp',
    router: docLSPRoutes,
    description: 'Documentation Language Server Protocol',
  },
  {
    path: '/api/doc-dep-graph',
    router: docDepGraphRoutes,
    description: 'Documentation dependency graph and blast radius',
  },
  {
    path: '/api/doc-semver',
    router: docSemverRoutes,
    description: 'Semantic documentation versioning',
  },
  {
    path: '/api/doc-ql',
    router: docQLRoutes,
    description: 'DocQL query language for documentation metadata',
  },
  {
    path: '/api/doc-federation',
    router: docFederationRoutes,
    description: 'Cross-organization documentation federation',
  },
  {
    path: '/api/doc-regression',
    router: docRegressionRoutes,
    description: 'Documentation regression testing in CI',
  },
  {
    path: '/api/doc-context-translation',
    router: docContextTranslationRoutes,
    description: 'AI context-aware technical translation',
  },
  {
    path: '/api/doc-health-badge',
    router: docHealthBadgeRoutes,
    description: 'Documentation health badges and status checks',
  },
  {
    path: '/api/doc-playground',
    router: docPlaygroundRoutes,
    description: 'Interactive documentation code playgrounds',
  },
  {
    path: '/api/doc-forecast',
    router: docForecastRoutes,
    description: 'Documentation change forecasting',
  },
];

/**
 * Community and sharing routes
 */
const communityFeatureRoutes: RouteConfig[] = [
  { path: '/api/hub', router: hubRoutes, description: 'Documentation hub' },
  { path: '/api/community', router: communityRoutes, description: 'Community features' },
  { path: '/api/playground', router: playgroundRoutes, description: 'API playground' },
];

// ============================================================================
// Route Registration
// ============================================================================

/**
 * All route groups in registration order
 */
export const allRouteGroups = {
  core: coreRoutes,
  repository: repositoryRoutes,
  organization: organizationRoutes,
  analytics: analyticsFeatureRoutes,
  documentation: documentationRoutes,
  advancedDoc: advancedDocRoutes,
  integration: integrationRoutes,
  nextGen: nextGenRoutes,
  community: communityFeatureRoutes,
};

/**
 * Register all routes on a Hono app instance.
 *
 * @param app - The Hono application instance
 * @returns The number of routes registered
 */
export function registerAllRoutes(app: Hono): number {
  let count = 0;

  for (const group of Object.values(allRouteGroups)) {
    for (const route of group) {
      app.route(route.path, route.router);
      count++;
    }
  }

  return count;
}

/**
 * Get a flat list of all registered routes with metadata.
 * Useful for documentation and debugging.
 */
export function getRegisteredRoutes(): RouteConfig[] {
  return Object.values(allRouteGroups).flat();
}

/**
 * Get routes grouped by category.
 */
export function getRoutesByCategory(): Record<string, RouteConfig[]> {
  return { ...allRouteGroups };
}
