import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError, createLogger, getAnthropicClient } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const log = createLogger('doc-review-copilot');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

const app = new Hono();

// List doc reviews for repository
app.get('/repository/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { status, limit, offset } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const whereClause: Record<string, unknown> = { repositoryId };
  if (status) whereClause.status = status;

  const [reviews, total] = await Promise.all([
    prisma.docReview.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.docReview.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { reviews, total },
  });
});

// Get single review with comments
app.get('/:reviewId', requireAuth, requireOrgAccess, async (c) => {
  const reviewId = c.req.param('reviewId');
  const orgId = c.get('organizationId');

  const review = await prisma.docReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError('Review', reviewId);
  }

  // Verify access
  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Review', reviewId);
  }

  // Get comments
  const comments = await prisma.docReviewComment.findMany({
    where: { reviewId },
    orderBy: { lineStart: 'asc' },
  });

  return c.json({
    success: true,
    data: { ...review, comments },
  });
});

// Trigger new review
app.post('/review', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    documentId?: string;
    pullRequestId?: string;
    content?: string;
    styleGuideId?: string;
  }>();

  if (!body.repositoryId) {
    throw new ValidationError('repositoryId is required');
  }

  // Verify repository access
  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Verify document if provided
  if (body.documentId) {
    const document = await prisma.document.findFirst({
      where: { id: body.documentId, repositoryId: body.repositoryId },
    });
    if (!document) {
      throw new NotFoundError('Document', body.documentId);
    }
  }

  // Queue review job
  const job = await addJob(QUEUE_NAMES.DOC_REVIEW_COPILOT, {
    repositoryId: body.repositoryId,
    documentId: body.documentId,
    pullRequestId: body.pullRequestId,
    content: body.content,
    styleGuideId: body.styleGuideId,
    checkAccuracy: true,
    checkStyle: true,
  });

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      message: 'Review started',
    },
  });
});

// Resolve comment
app.post('/:reviewId/comments/:commentId/resolve', requireAuth, requireOrgAccess, async (c) => {
  const reviewId = c.req.param('reviewId');
  const commentId = c.req.param('commentId');
  const orgId = c.get('organizationId');

  // Verify access
  const review = await prisma.docReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError('Review', reviewId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: review.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Review', reviewId);
  }

  await prisma.docReviewComment.update({
    where: { id: commentId },
    data: { resolved: true },
  });

  return c.json({ success: true });
});

// ============================================================================
// Style Guides
// ============================================================================

// List style guides
app.get('/style-guides', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const guides = await prisma.styleGuide.findMany({
    where: { organizationId: orgId },
    orderBy: { name: 'asc' },
  });

  return c.json({
    success: true,
    data: guides,
  });
});

// Create style guide
app.post('/style-guides', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    name: string;
    description?: string;
    rules?: Array<{ pattern: string; message: string; severity: string }>;
    examples?: Array<{ bad: string; good: string }>;
    isDefault?: boolean;
  }>();

  if (!body.name) {
    throw new ValidationError('name is required');
  }

  // If setting as default, unset other defaults
  if (body.isDefault) {
    await prisma.styleGuide.updateMany({
      where: { organizationId: orgId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const guide = await prisma.styleGuide.create({
    data: {
      organizationId: orgId,
      name: body.name,
      description: body.description,
      rules: body.rules || [],
      examples: body.examples || [],
      isDefault: body.isDefault || false,
    },
  });

  return c.json({
    success: true,
    data: guide,
  });
});

// Update style guide
app.put('/style-guides/:guideId', requireAuth, requireOrgAccess, async (c) => {
  const guideId = c.req.param('guideId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    name?: string;
    description?: string;
    rules?: unknown[];
    examples?: unknown[];
    isDefault?: boolean;
  }>();

  const guide = await prisma.styleGuide.findFirst({
    where: { id: guideId, organizationId: orgId },
  });

  if (!guide) {
    throw new NotFoundError('StyleGuide', guideId);
  }

  // If setting as default, unset other defaults
  if (body.isDefault) {
    await prisma.styleGuide.updateMany({
      where: { organizationId: orgId, isDefault: true, id: { not: guideId } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.styleGuide.update({
    where: { id: guideId },
    data: {
      name: body.name,
      description: body.description,
      rules: body.rules as object | undefined,
      examples: body.examples as object | undefined,
      isDefault: body.isDefault,
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete style guide
app.delete('/style-guides/:guideId', requireAuth, requireOrgAccess, async (c) => {
  const guideId = c.req.param('guideId');
  const orgId = c.get('organizationId');

  const guide = await prisma.styleGuide.findFirst({
    where: { id: guideId, organizationId: orgId },
  });

  if (!guide) {
    throw new NotFoundError('StyleGuide', guideId);
  }

  await prisma.styleGuide.delete({
    where: { id: guideId },
  });

  return c.json({ success: true });
});

// ============================================================================
// PR Comments to Documentation (Feature 8)
// ============================================================================

interface PRComment {
  id: string;
  body: string;
  path?: string;
  position?: number;
  line?: number;
  author: string;
  createdAt: string;
  type: 'review' | 'comment' | 'suggestion';
}

interface DocSuggestion {
  type: 'new' | 'update' | 'clarification';
  documentType: string;
  title: string;
  content: string;
  sourceComment: string;
  confidence: number;
  affectedPath?: string;
}

// Analyze PR comments for documentation opportunities
app.post('/pr-comments/analyze', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    prNumber: number;
    comments: PRComment[];
  }>();

  if (!body.repositoryId || !body.comments || body.comments.length === 0) {
    throw new ValidationError('repositoryId and comments are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Analyze comments for documentation relevance
  const docRelevantComments = body.comments.filter((comment) => {
    const lower = comment.body.toLowerCase();
    return (
      lower.includes('document') ||
      lower.includes('doc') ||
      lower.includes('readme') ||
      lower.includes('explain') ||
      lower.includes('clarify') ||
      lower.includes('note') ||
      lower.includes('todo') ||
      lower.includes('fixme') ||
      lower.includes('example') ||
      lower.includes('usage') ||
      lower.includes('api')
    );
  });

  // Use AI to generate documentation suggestions
  const anthropic = getAnthropicClient();
  const suggestions: DocSuggestion[] = [];

  if (anthropic && docRelevantComments.length > 0) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: `Analyze these PR review comments and identify documentation opportunities.

Comments:
${docRelevantComments.map(c => `- [${c.author}] ${c.path ? `(${c.path}:${c.line || c.position || 0})` : ''}: ${c.body}`).join('\n')}

For each comment that suggests documentation should be added or updated, generate a suggestion.

Return JSON array:
[
  {
    "type": "new|update|clarification",
    "documentType": "README|API_REFERENCE|GUIDE|INLINE_COMMENT",
    "title": "Suggested section/doc title",
    "content": "Suggested documentation content (markdown)",
    "sourceComment": "The original comment that prompted this",
    "confidence": 0.0-1.0,
    "affectedPath": "file path if applicable"
  }
]

Only include suggestions with confidence > 0.5.`,
          },
        ],
      });

      const content = response.content[0];
      if (content?.type === 'text') {
        const jsonMatch = content.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestions.push(...parsed);
        }
      }
    } catch (error) {
      log.error({ error }, 'AI analysis of PR comments failed');
    }
  }

  // Store the analysis
  await db.prCommentAnalysis.create({
    data: {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      totalComments: body.comments.length,
      docRelevantComments: docRelevantComments.length,
      suggestions: suggestions,
      analyzedAt: new Date(),
    },
  });

  return c.json({
    success: true,
    data: {
      repositoryId: body.repositoryId,
      prNumber: body.prNumber,
      totalComments: body.comments.length,
      docRelevantCount: docRelevantComments.length,
      suggestions,
    },
  });
});

// Convert a specific PR comment to documentation
app.post('/pr-comments/convert', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    comment: PRComment;
    targetDocumentId?: string;
    documentType?: string;
  }>();

  if (!body.repositoryId || !body.comment) {
    throw new ValidationError('repositoryId and comment are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Use AI to convert the comment to documentation
  const anthropic = getAnthropicClient();

  if (!anthropic) {
    return c.json({
      success: false,
      error: { code: 'AI_UNAVAILABLE', message: 'AI service not configured' },
    }, 500);
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `Convert this PR review comment into proper documentation.

Comment:
"${body.comment.body}"

${body.comment.path ? `File: ${body.comment.path}` : ''}
${body.comment.line ? `Line: ${body.comment.line}` : ''}
Author: ${body.comment.author}

Generate documentation that:
1. Is professional and clear
2. Explains the concept mentioned in the comment
3. Uses markdown formatting
4. Includes code examples if relevant

Return JSON:
{
  "title": "Section or doc title",
  "content": "Full markdown documentation",
  "type": "${body.documentType || 'GUIDE'}",
  "tags": ["relevant", "tags"],
  "relatedTo": "file path or concept this relates to"
}`,
        },
      ],
    });

    const responseContent = response.content[0];
    if (responseContent?.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const jsonMatch = responseContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const docContent = JSON.parse(jsonMatch[0]);

    // Store as a pending documentation suggestion
    const suggestion = await db.docSuggestionFromComment.create({
      data: {
        repositoryId: body.repositoryId,
        sourceCommentId: body.comment.id,
        sourceCommentBody: body.comment.body,
        sourceCommentAuthor: body.comment.author,
        sourceFilePath: body.comment.path,
        suggestedTitle: docContent.title,
        suggestedContent: docContent.content,
        suggestedType: docContent.type,
        tags: docContent.tags || [],
        relatedTo: docContent.relatedTo,
        targetDocumentId: body.targetDocumentId,
        status: 'pending',
      },
    });

    log.info({
      suggestionId: suggestion.id,
      repositoryId: body.repositoryId,
      commentAuthor: body.comment.author,
    }, 'Doc suggestion created from PR comment');

    return c.json({
      success: true,
      data: {
        suggestionId: suggestion.id,
        title: docContent.title,
        content: docContent.content,
        type: docContent.type,
        tags: docContent.tags,
        relatedTo: docContent.relatedTo,
      },
    });
  } catch (error) {
    log.error({ error }, 'Failed to convert PR comment to documentation');
    return c.json({
      success: false,
      error: { code: 'CONVERSION_FAILED', message: 'Failed to convert comment' },
    }, 500);
  }
});

// Get pending documentation suggestions from comments
app.get('/pr-comments/suggestions/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { status = 'pending' } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const suggestions = await db.docSuggestionFromComment.findMany({
    where: {
      repositoryId,
      status,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return c.json({
    success: true,
    data: suggestions,
  });
});

// Apply a documentation suggestion (convert to actual document)
app.post('/pr-comments/suggestions/:suggestionId/apply', requireAuth, requireOrgAccess, async (c) => {
  const suggestionId = c.req.param('suggestionId');
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  const body = await c.req.json<{
    title?: string;
    content?: string;
    type?: string;
    targetPath?: string;
  }>();

  const suggestion = await db.docSuggestionFromComment.findUnique({
    where: { id: suggestionId },
  });

  if (!suggestion) {
    throw new NotFoundError('Suggestion', suggestionId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: suggestion.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', suggestion.repositoryId);
  }

  // Create or update the document
  const title = body.title || suggestion.suggestedTitle;
  const content = body.content || suggestion.suggestedContent;
  const type = body.type || suggestion.suggestedType;
  const path = body.targetPath || `docs/${title.toLowerCase().replace(/\s+/g, '-')}.md`;

  let document;
  if (suggestion.targetDocumentId) {
    // Update existing document
    document = await prisma.document.update({
      where: { id: suggestion.targetDocumentId },
      data: {
        content: content,
        version: { increment: 1 },
      },
    });
  } else {
    // Create new document
    document = await prisma.document.create({
      data: {
        repositoryId: suggestion.repositoryId,
        path: path,
        type: type,
        title: title,
        content: content,
        version: 1,
        metadata: {
          sourceComment: suggestion.sourceCommentId,
          appliedBy: userId,
        },
      },
    });
  }

  // Update suggestion status
  await db.docSuggestionFromComment.update({
    where: { id: suggestionId },
    data: {
      status: 'applied',
      appliedDocumentId: document.id,
      appliedAt: new Date(),
      appliedBy: userId,
    },
  });

  log.info({
    suggestionId,
    documentId: document.id,
    userId,
  }, 'Doc suggestion applied');

  return c.json({
    success: true,
    data: {
      documentId: document.id,
      path: document.path,
      title: document.title,
    },
  });
});

// Dismiss a documentation suggestion
app.post('/pr-comments/suggestions/:suggestionId/dismiss', requireAuth, requireOrgAccess, async (c) => {
  const suggestionId = c.req.param('suggestionId');
  const orgId = c.get('organizationId');
  const userId = c.get('userId');
  const body = await c.req.json<{ reason?: string }>();

  const suggestion = await db.docSuggestionFromComment.findUnique({
    where: { id: suggestionId },
  });

  if (!suggestion) {
    throw new NotFoundError('Suggestion', suggestionId);
  }

  const repository = await prisma.repository.findFirst({
    where: { id: suggestion.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', suggestion.repositoryId);
  }

  await db.docSuggestionFromComment.update({
    where: { id: suggestionId },
    data: {
      status: 'dismissed',
      dismissedReason: body.reason,
      dismissedAt: new Date(),
      dismissedBy: userId,
    },
  });

  return c.json({ success: true });
});

// Get comment-to-doc conversion analytics
app.get('/pr-comments/analytics/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const { days = '30' } = c.req.query();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const since = new Date();
  since.setDate(since.getDate() - parseInt(days, 10));

  const [total, applied, dismissed, pending] = await Promise.all([
    db.docSuggestionFromComment.count({
      where: { repositoryId, createdAt: { gte: since } },
    }),
    db.docSuggestionFromComment.count({
      where: { repositoryId, status: 'applied', createdAt: { gte: since } },
    }),
    db.docSuggestionFromComment.count({
      where: { repositoryId, status: 'dismissed', createdAt: { gte: since } },
    }),
    db.docSuggestionFromComment.count({
      where: { repositoryId, status: 'pending' },
    }),
  ]);

  // Get top contributors from comments
  const topContributors = await db.docSuggestionFromComment.groupBy({
    by: ['sourceCommentAuthor'],
    where: { repositoryId, status: 'applied', createdAt: { gte: since } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  });

  return c.json({
    success: true,
    data: {
      repositoryId,
      period: { days: parseInt(days, 10), since: since.toISOString() },
      summary: {
        total,
        applied,
        dismissed,
        pending,
        conversionRate: total > 0 ? Math.round((applied / total) * 100) : 0,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topContributors: topContributors.map((c: any) => ({
        author: c.sourceCommentAuthor,
        contributions: c._count?.id ?? 0,
      })),
    },
  });
});

export const docReviewCopilotRoutes = app;
