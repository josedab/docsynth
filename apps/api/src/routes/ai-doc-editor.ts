/**
 * AI Doc Editor Routes
 *
 * API endpoints for real-time AI-powered documentation editing,
 * including inline completions, improvement suggestions, and style fixes.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { aiDocEditorService, type EditorContext } from '../services/ai-doc-editor.js';

const log = createLogger('ai-doc-editor-routes');

const app = new Hono();

/**
 * Get inline completion suggestion at cursor position
 */
app.post('/completion', requireAuth, rateLimit('ai'), async (c) => {
  const body = await c.req.json<EditorContext>();

  if (!body.repositoryId || !body.content || !body.cursorPosition) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const suggestion = await aiDocEditorService.getInlineCompletion(body);

  return c.json({
    success: true,
    data: suggestion,
  });
});

/**
 * Get improvement suggestions for selected text
 */
app.post('/improve', requireAuth, rateLimit('ai'), async (c) => {
  const body = await c.req.json<EditorContext>();

  if (!body.repositoryId || !body.content || !body.selection) {
    return c.json({ success: false, error: 'Missing required fields (selection required)' }, 400);
  }

  const suggestions = await aiDocEditorService.getImprovementSuggestions(body);

  return c.json({
    success: true,
    data: suggestions,
  });
});

/**
 * Get style fixes for entire document
 */
app.post('/style-check', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const body = await c.req.json<{ repositoryId: string; content: string }>();

  if (!body.repositoryId || !body.content) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const fixes = await aiDocEditorService.getStyleFixes(body.repositoryId, body.content);

  return c.json({
    success: true,
    data: fixes,
  });
});

/**
 * Generate content for a section
 */
app.post('/generate-section', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    heading: string;
    context: string;
    documentType: string;
  }>();

  if (!body.repositoryId || !body.heading) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const content = await aiDocEditorService.generateSection(
    body.repositoryId,
    body.heading,
    body.context || '',
    body.documentType || 'GUIDE'
  );

  if (!content) {
    return c.json({ success: false, error: 'Failed to generate section' }, 500);
  }

  return c.json({
    success: true,
    data: { content },
  });
});

/**
 * Analyze entire document for issues
 */
app.post('/analyze', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const body = await c.req.json<{
    repositoryId: string;
    documentId: string;
    content: string;
  }>();

  if (!body.repositoryId || !body.documentId || !body.content) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const analysis = await aiDocEditorService.analyzeDocument(
    body.repositoryId,
    body.documentId,
    body.content
  );

  return c.json({
    success: true,
    data: analysis,
  });
});

/**
 * Apply a suggestion to a document
 */
app.post('/apply-suggestion', requireAuth, requireOrgAccess, async (c) => {
  const body = await c.req.json<{
    documentId: string;
    suggestionId: string;
    suggestionText: string;
    position: { line: number; character: number };
    endPosition?: { line: number; character: number };
  }>();

  if (!body.documentId || !body.suggestionId || !body.suggestionText || !body.position) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const result = await aiDocEditorService.applySuggestion(
    body.documentId,
    body.suggestionId,
    body.suggestionText,
    body.position,
    body.endPosition
  );

  if (!result.success) {
    return c.json({ success: false, error: 'Failed to apply suggestion' }, 500);
  }

  log.info({ documentId: body.documentId, suggestionId: body.suggestionId }, 'Suggestion applied');

  return c.json({
    success: true,
    data: { newContent: result.newContent },
  });
});

/**
 * Record feedback on a suggestion (accepted/rejected)
 */
app.post('/feedback', requireAuth, async (c) => {
  const user = c.get('user') as { id: string };
  const body = await c.req.json<{
    suggestionId: string;
    accepted: boolean;
  }>();

  if (!body.suggestionId || body.accepted === undefined) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  await aiDocEditorService.recordFeedback(body.suggestionId, body.accepted, user.id);

  return c.json({ success: true });
});

export { app as aiDocEditorRoutes };
