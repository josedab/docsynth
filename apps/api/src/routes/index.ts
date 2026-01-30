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

// Community features
import { hubRoutes } from './hub.js';
import { communityRoutes } from './community.js';
import { playgroundRoutes } from './playground.js';

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
  { path: '/api/doc-analytics', router: docAnalyticsRoutes, description: 'Documentation analytics' },
  { path: '/api/health-dashboard', router: healthDashboardRoutes, description: 'Health dashboard' },
  { path: '/api/coverage', router: coverageRoutes, description: 'Documentation coverage' },
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
  { path: '/api/integrations', router: integrationsRoutes, description: 'Third-party integrations' },
  { path: '/api/bot', router: botRoutes, description: 'Bot commands' },
  { path: '/api/ide', router: ideRoutes, description: 'IDE integration' },
  { path: '/api/onboarding', router: onboardingRoutes, description: 'User onboarding' },
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
