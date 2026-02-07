import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';
import {
  detectBrokenLinks,
  healIssue,
  generateSimpleDiff,
  mapAlertTypeToIssueType,
  isAutoFixable,
  analyzeDocumentForRegeneration,
  regenerateSection,
  applyRegeneratedSections,
  runProactiveSelfHealing,
  type DocumentIssue,
  type HealingResult,
  type AutoRegenerationConfig,
} from '../services/self-healing.js';

const app = new Hono();

// ============================================================================
// Issue Detection
// ============================================================================

// Scan documents for issues
app.post('/scan', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId?: string;
    documentId?: string;
    issueTypes?: DocumentIssue['type'][];
  }>().catch(() => ({} as { repositoryId?: string; documentId?: string; issueTypes?: DocumentIssue['type'][] }));

  // Verify repository access if specified
  if (body.repositoryId) {
    const repo = await prisma.repository.findFirst({
      where: { id: body.repositoryId, organizationId: orgId },
    });
    if (!repo) throw new NotFoundError('Repository', body.repositoryId);
  }

  // Queue background scan job
  const job = await addJob(QUEUE_NAMES.HEALTH_SCAN, {
    organizationId: orgId,
    repositoryId: body.repositoryId,
    scheduled: false,
    createAlerts: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Self-healing scan started',
    },
  });
});

// Get detected issues for a repository
app.get('/issues/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { type, severity, status } = c.req.query();

  // Verify access
  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  // Get alerts that represent healable issues
  const whereClause: Record<string, unknown> = {
    repositoryId,
    acknowledged: status === 'resolved' ? true : false,
  };

  if (type) whereClause.alertType = type;
  if (severity) whereClause.severity = severity;

  const alerts = await prisma.healthAlert.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // Get document paths separately
  const documentIds = alerts.map(a => a.documentId).filter((id): id is string => !!id);
  const documents = documentIds.length > 0 
    ? await prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, path: true, title: true },
      })
    : [];
  const docMap = new Map(documents.map(d => [d.id, d]));

  // Transform to DocumentIssue format
  const issues: DocumentIssue[] = alerts.map(alert => {
    const doc = alert.documentId ? docMap.get(alert.documentId) : undefined;
    return {
      id: alert.id,
      type: mapAlertTypeToIssueType(alert.alertType),
      severity: alert.severity as DocumentIssue['severity'],
      documentId: alert.documentId || '',
      documentPath: doc?.path || 'Unknown',
      location: {
        text: alert.message,
      },
      description: alert.title,
      suggestedFix: (alert.metadata as Record<string, string>)?.suggestedFix,
      autoFixable: isAutoFixable(alert.alertType),
      detectedAt: alert.createdAt,
    };
  });

  // Group by type for summary
  const summary = {
    total: issues.length,
    byType: {
      brokenLinks: issues.filter(i => i.type === 'broken-link').length,
      outdatedRefs: issues.filter(i => i.type === 'outdated-reference').length,
      terminologyDrift: issues.filter(i => i.type === 'terminology-drift').length,
      missingSections: issues.filter(i => i.type === 'missing-section').length,
      deprecatedApis: issues.filter(i => i.type === 'deprecated-api').length,
      codeMismatches: issues.filter(i => i.type === 'code-mismatch').length,
    },
    autoFixable: issues.filter(i => i.autoFixable).length,
    critical: issues.filter(i => i.severity === 'critical').length,
  };

  return c.json({
    success: true,
    data: {
      repository: repo,
      issues,
      summary,
    },
  });
});

// ============================================================================
// Broken Link Detection & Fixing
// ============================================================================

// Detect broken links in a document
app.post('/detect/broken-links', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ documentId: string }>();

  if (!body.documentId) {
    throw new ValidationError('documentId is required');
  }

  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true, name: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  const content = document.content || '';
  const brokenLinks = await detectBrokenLinks(content, document.repository.name);

  return c.json({
    success: true,
    data: {
      documentId: document.id,
      documentPath: document.path,
      brokenLinks,
      totalLinksChecked: brokenLinks.length + (brokenLinks.filter(l => !l.broken).length),
    },
  });
});

// ============================================================================
// Terminology Drift Detection
// ============================================================================

// Detect terminology inconsistencies
app.post('/detect/terminology', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const repo = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    select: { id: true, name: true },
  });
  if (!repo) throw new NotFoundError('Repository', body.repositoryId);

  // Get all documents for the repository
  const documents = await prisma.document.findMany({
    where: { repositoryId: body.repositoryId },
    select: { id: true, path: true, content: true },
    take: 50, // Limit for performance
  });

  // Get glossary terms for comparison
  const glossary = await prisma.glossary.findMany({
    where: { organizationId: orgId },
    select: { term: true, definition: true, translations: true },
  });

  // Build terminology map from translations (use as pseudo-aliases)
  const termMap = new Map<string, { preferred: string; definition: string }>();
  for (const entry of glossary) {
    const translations = (entry.translations as Record<string, string>) || {};
    // Add translated terms as potential drift indicators
    for (const translatedTerm of Object.values(translations)) {
      if (translatedTerm && translatedTerm !== entry.term) {
        termMap.set(translatedTerm.toLowerCase(), {
          preferred: entry.term,
          definition: entry.definition || '',
        });
      }
    }
  }

  // Detect drift
  const driftIssues: Array<{
    documentId: string;
    documentPath: string;
    term: string;
    preferredTerm: string;
    occurrences: number;
    suggestedFix: string;
  }> = [];

  for (const doc of documents) {
    const content = (doc.content || '').toLowerCase();
    for (const [alias, { preferred }] of termMap) {
      if (alias !== preferred.toLowerCase() && content.includes(alias)) {
        const occurrences = (content.match(new RegExp(alias, 'gi')) || []).length;
        driftIssues.push({
          documentId: doc.id,
          documentPath: doc.path,
          term: alias,
          preferredTerm: preferred,
          occurrences,
          suggestedFix: `Replace "${alias}" with "${preferred}"`,
        });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      repositoryId: body.repositoryId,
      driftIssues,
      totalDocumentsScanned: documents.length,
      glossaryTermsChecked: glossary.length,
    },
  });
});

// ============================================================================
// Auto-Healing
// ============================================================================

// Auto-fix detected issues
app.post('/heal', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    issueIds: string[];
    mode: 'auto' | 'review';
    createPR?: boolean;
  }>();

  if (!body.issueIds || body.issueIds.length === 0) {
    throw new ValidationError('issueIds array is required');
  }

  // Get the alerts/issues to fix
  const alerts = await prisma.healthAlert.findMany({
    where: {
      id: { in: body.issueIds },
      organizationId: orgId,
      acknowledged: false,
    },
  });

  // Get associated documents
  const docIds = alerts.map(a => a.documentId).filter((id): id is string => !!id);
  const docs = docIds.length > 0 
    ? await prisma.document.findMany({
        where: { id: { in: docIds } },
        include: { repository: { select: { id: true, organizationId: true, name: true } } },
      })
    : [];
  const docMap = new Map(docs.map(d => [d.id, d]));

  const results: HealingResult[] = [];

  for (const alert of alerts) {
    const document = alert.documentId ? docMap.get(alert.documentId) : undefined;
    if (!document) {
      results.push({
        issueId: alert.id,
        status: 'skipped',
        error: 'No document associated with this issue',
      });
      continue;
    }

    try {
      const result = await healIssue(alert, document, body.mode);
      results.push(result);

      // Mark as acknowledged if fixed
      if (result.status === 'fixed') {
        await prisma.healthAlert.update({
          where: { id: alert.id },
          data: {
            acknowledged: true,
            acknowledgedBy: userId,
            acknowledgedAt: new Date(),
            metadata: {
              ...(alert.metadata as object || {}),
              healedAt: new Date(),
              healingMode: body.mode,
            },
          },
        });
      }
    } catch (error) {
      results.push({
        issueId: alert.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // If createPR is requested, log for manual PR creation
  // Note: Full PR generation would require a dedicated queue/worker
  const prQueued = body.createPR && results.some(r => r.status === 'fixed');

  const summary = {
    total: body.issueIds.length,
    fixed: results.filter(r => r.status === 'fixed').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
  };

  return c.json({
    success: true,
    data: {
      results,
      summary,
      prQueued,
    },
  });
});

// ============================================================================
// Preview Changes
// ============================================================================

// Preview healing changes without applying
app.post('/preview', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ issueId: string }>();

  if (!body.issueId) {
    throw new ValidationError('issueId is required');
  }

  const alert = await prisma.healthAlert.findFirst({
    where: { id: body.issueId, organizationId: orgId },
  });

  if (!alert) {
    throw new NotFoundError('Issue', body.issueId);
  }

  // Get associated document
  const document = alert.documentId
    ? await prisma.document.findUnique({
        where: { id: alert.documentId },
        select: { id: true, path: true, content: true },
      })
    : null;

  if (!document) {
    throw new ValidationError('No document associated with this issue');
  }

  const result = await healIssue(alert, document, 'review');

  // Generate diff
  const diff = result.originalContent && result.newContent
    ? generateSimpleDiff(result.originalContent, result.newContent)
    : null;

  return c.json({
    success: true,
    data: {
      issueId: body.issueId,
      documentPath: document.path,
      canAutoFix: result.status !== 'skipped',
      preview: {
        originalSnippet: result.originalContent?.slice(0, 500),
        newSnippet: result.newContent?.slice(0, 500),
        diff,
      },
      error: result.error,
    },
  });
});

// ============================================================================
// Healing History
// ============================================================================

// Get healing history
app.get('/history/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { limit } = c.req.query();

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  // Get acknowledged alerts with healing metadata
  const healedAlerts = await prisma.healthAlert.findMany({
    where: {
      repositoryId,
      acknowledged: true,
    },
    orderBy: { acknowledgedAt: 'desc' },
    take: limit ? parseInt(limit, 10) : 50,
  });

  // Get document paths
  const docIds = healedAlerts.map(a => a.documentId).filter((id): id is string => !!id);
  const docs = docIds.length > 0
    ? await prisma.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, path: true, title: true },
      })
    : [];
  const docMap = new Map(docs.map(d => [d.id, d]));

  const history = healedAlerts
    .filter((a) => (a.metadata as Record<string, unknown>)?.healedAt)
    .map((a) => {
      const metadata = a.metadata as Record<string, unknown>;
      const doc = a.documentId ? docMap.get(a.documentId) : undefined;
      return {
        id: a.id,
        issueType: mapAlertTypeToIssueType(a.alertType),
        documentPath: doc?.path || 'Unknown',
        healedAt: metadata.healedAt,
        healingMode: metadata.healingMode,
        fixedBy: a.acknowledgedBy,
      };
    });

  return c.json({
    success: true,
    data: {
      repositoryId,
      history,
      totalHealed: history.length,
    },
  });
});

// ============================================================================
// Code Sync Detection
// ============================================================================

// Detect code/doc mismatches
app.post('/detect/code-sync', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ repositoryId: string }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  const repo = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });
  if (!repo) throw new NotFoundError('Repository', body.repositoryId);

  // Get recent code changes (PRs)
  const recentPRs = await prisma.pREvent.findMany({
    where: {
      repositoryId: body.repositoryId,
      mergedAt: { 
        not: null,
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) 
      },
    },
    orderBy: { mergedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      title: true,
      prNumber: true,
      mergedAt: true,
      payload: true, // Contains files info
    },
  });

  // Get documents that might be affected
  const documents = await prisma.document.findMany({
    where: { repositoryId: body.repositoryId },
    select: { id: true, path: true, title: true, updatedAt: true, metadata: true },
  });

  // Detect potential mismatches
  const mismatches: Array<{
    documentId: string;
    documentPath: string;
    relatedPR: {
      prNumber: number;
      title: string;
      mergedAt: Date;
    };
    lastDocUpdate: Date;
    risk: 'low' | 'medium' | 'high';
  }> = [];

  for (const doc of documents) {
    // Use metadata for related files info
    const metadata = (doc.metadata as Record<string, unknown>) || {};
    const relatedFiles = (metadata.relatedFiles as string[]) || [];

    for (const pr of recentPRs) {
      // Extract files from PR payload
      const payload = (pr.payload as Record<string, unknown>) || {};
      const prFiles = (payload.files as string[]) || [];

      // Check if any PR files overlap with doc's related files
      const overlap = prFiles.filter((f: string) => 
        relatedFiles.some(rf => f.includes(rf) || rf.includes(f))
      );

      if (overlap.length > 0 && pr.mergedAt && pr.mergedAt > doc.updatedAt) {
        mismatches.push({
          documentId: doc.id,
          documentPath: doc.path,
          relatedPR: {
            prNumber: pr.prNumber,
            title: pr.title || '',
            mergedAt: pr.mergedAt,
          },
          lastDocUpdate: doc.updatedAt,
          risk: overlap.length > 3 ? 'high' : overlap.length > 1 ? 'medium' : 'low',
        });
      }
    }
  }

  return c.json({
    success: true,
    data: {
      repositoryId: body.repositoryId,
      mismatches: mismatches.sort((a, b) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[a.risk] - riskOrder[b.risk];
      }),
      summary: {
        totalDocuments: documents.length,
        recentPRs: recentPRs.length,
        potentialMismatches: mismatches.length,
        highRisk: mismatches.filter(m => m.risk === 'high').length,
      },
    },
  });
});

// ============================================================================
// Auto-Regeneration (Self-Healing v2)
// ============================================================================

// Analyze document for sections needing regeneration
app.post('/analyze-regeneration/:documentId', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const documentId = c.req.param('documentId');
  const orgId = c.get('organizationId');

  const document = await prisma.document.findFirst({
    where: { id: documentId },
    include: {
      repository: {
        select: { id: true, organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', documentId);
  }

  const analysis = await analyzeDocumentForRegeneration(documentId, document.repositoryId);

  return c.json({
    success: true,
    data: {
      documentId,
      documentPath: document.path,
      ...analysis,
      sectionsNeedingUpdate: analysis.sections.filter(s => s.needsUpdate).length,
    },
  });
});

// Regenerate a specific section
app.post('/regenerate-section', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId: string;
    heading: string;
    context?: { relatedCode?: string; prContext?: string };
  }>();

  if (!body.documentId || !body.heading) {
    throw new ValidationError('documentId and heading are required');
  }

  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: {
      repository: {
        select: { organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  const result = await regenerateSection(body.documentId, body.heading, body.context || {});

  if (!result) {
    return c.json({ success: false, error: 'Section not found or could not be regenerated' }, 400);
  }

  return c.json({
    success: true,
    data: result,
  });
});

// Apply regenerated sections
app.post('/apply-regeneration', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId: string;
    sections: Array<{
      heading: string;
      originalContent: string;
      newContent: string;
      confidence: number;
      reason: string;
    }>;
  }>();

  if (!body.documentId || !body.sections?.length) {
    throw new ValidationError('documentId and sections are required');
  }

  const document = await prisma.document.findFirst({
    where: { id: body.documentId },
    include: {
      repository: {
        select: { organizationId: true },
      },
    },
  });

  if (!document || document.repository.organizationId !== orgId) {
    throw new NotFoundError('Document', body.documentId);
  }

  const result = await applyRegeneratedSections(body.documentId, body.sections);

  return c.json({
    success: true,
    data: {
      success: result.success,
      appliedSections: body.sections.length,
    },
  });
});

// Run proactive self-healing for a repository
app.post('/proactive/:repositoryId', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body: Partial<AutoRegenerationConfig> = await c.req.json<Partial<AutoRegenerationConfig>>().catch(() => ({}));

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const config: AutoRegenerationConfig = {
    enabled: body.enabled ?? true,
    confidenceThreshold: body.confidenceThreshold ?? 0.8,
    requireReview: body.requireReview ?? true,
    maxSectionsPerRun: body.maxSectionsPerRun ?? 5,
    excludePatterns: body.excludePatterns ?? ['CHANGELOG', 'LICENSE'],
  };

  const results = await runProactiveSelfHealing(repositoryId, config);

  return c.json({
    success: true,
    data: {
      repositoryId,
      results,
      summary: {
        documentsProcessed: results.length,
        sectionsRegenerated: results.reduce((sum, r) => sum + r.sections.length, 0),
        successful: results.filter(r => r.status === 'success').length,
        pendingReview: results.filter(r => r.status === 'partial').length,
        failed: results.filter(r => r.status === 'failed').length,
      },
    },
  });
});

// Get self-healing configuration
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, config: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const repoConfig = repo.config as Record<string, unknown> || {};
  const selfHealingConfig = (repoConfig.selfHealing as AutoRegenerationConfig) || {
    enabled: false,
    confidenceThreshold: 0.8,
    requireReview: true,
    maxSectionsPerRun: 5,
    excludePatterns: ['CHANGELOG', 'LICENSE'],
  };

  return c.json({
    success: true,
    data: selfHealingConfig,
  });
});

// Update self-healing configuration
app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<Partial<AutoRegenerationConfig>>();

  const repo = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    select: { id: true, config: true },
  });
  if (!repo) throw new NotFoundError('Repository', repositoryId);

  const currentConfig = repo.config as Record<string, unknown> || {};
  const currentSelfHealing = (currentConfig.selfHealing as AutoRegenerationConfig) || {};

  const updatedSelfHealing: AutoRegenerationConfig = {
    enabled: body.enabled ?? currentSelfHealing.enabled ?? false,
    confidenceThreshold: body.confidenceThreshold ?? currentSelfHealing.confidenceThreshold ?? 0.8,
    requireReview: body.requireReview ?? currentSelfHealing.requireReview ?? true,
    maxSectionsPerRun: body.maxSectionsPerRun ?? currentSelfHealing.maxSectionsPerRun ?? 5,
    excludePatterns: body.excludePatterns ?? currentSelfHealing.excludePatterns ?? [],
  };

  await prisma.repository.update({
    where: { id: repositoryId },
    data: {
      config: JSON.parse(JSON.stringify({
        ...currentConfig,
        selfHealing: updatedSelfHealing,
      })),
    },
  });

  return c.json({
    success: true,
    data: updatedSelfHealing,
  });
});

export { app as selfHealingRoutes };
