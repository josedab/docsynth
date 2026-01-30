import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limiter.js';
import { NotFoundError, ValidationError, createLogger, generateId, getAnthropicClient } from '@docsynth/utils';

const app = new Hono();
const log = createLogger('video-doc-routes');

// Type assertion for new Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Video Script Generation
// ============================================================================

interface VideoScript {
  id: string;
  title: string;
  description: string;
  duration: number; // estimated seconds
  scenes: VideoScene[];
  narration: string;
  keywords: string[];
}

interface VideoScene {
  id: string;
  order: number;
  type: 'intro' | 'concept' | 'code' | 'demo' | 'summary';
  title: string;
  narration: string;
  visualInstructions: string;
  codeSnippet?: string;
  duration: number;
}

// Generate video script from documentation
app.post('/generate-script', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    documentId?: string;
    topic: string;
    context?: string;
    targetAudience?: string;
    targetDuration?: number; // minutes
    style?: 'tutorial' | 'overview' | 'deep-dive';
  }>();

  if (!body.topic) {
    throw new ValidationError('topic is required');
  }

  let documentContent = '';
  let documentTitle = body.topic;

  // If documentId provided, use that as source
  if (body.documentId) {
    const document = await prisma.document.findUnique({
      where: { id: body.documentId },
      include: { repository: { select: { organizationId: true } } },
    });

    if (!document || document.repository.organizationId !== orgId) {
      throw new NotFoundError('Document', body.documentId);
    }

    documentContent = document.content;
    documentTitle = document.title;
  }

  const targetDuration = (body.targetDuration ?? 5) * 60; // Convert to seconds
  const style = body.style ?? 'tutorial';

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  // Generate video script using AI
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `Generate a video documentation script for the following topic.

Topic: ${body.topic}
Target Audience: ${body.targetAudience ?? 'developers'}
Target Duration: ${targetDuration} seconds
Style: ${style}

${documentContent ? `Source Documentation:\n${documentContent.slice(0, 3000)}` : ''}
${body.context ? `Additional Context:\n${body.context}` : ''}

Generate a JSON object with this structure:
{
  "title": "Video title",
  "description": "Brief description for video metadata",
  "scenes": [
    {
      "order": 1,
      "type": "intro|concept|code|demo|summary",
      "title": "Scene title",
      "narration": "What the narrator says (full script)",
      "visualInstructions": "What should be shown on screen",
      "codeSnippet": "Code to display if applicable",
      "duration": estimated_seconds
    }
  ],
  "keywords": ["relevant", "keywords", "for", "seo"]
}

Include 4-8 scenes covering:
1. Introduction (hook and overview)
2. Main concepts with explanations
3. Code examples with walkthrough
4. Summary and next steps

Return ONLY valid JSON.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  
  let scriptData: Omit<VideoScript, 'id' | 'narration'>;
  try {
    scriptData = JSON.parse(content);
  } catch {
    throw new ValidationError('Failed to generate valid video script');
  }

  // Calculate total duration and compile full narration
  const totalDuration = scriptData.scenes?.reduce((acc, s) => acc + (s.duration || 30), 0) || targetDuration;
  const fullNarration = scriptData.scenes?.map(s => s.narration).join('\n\n') || '';

  const script: VideoScript = {
    id: generateId('vscript'),
    title: scriptData.title || documentTitle,
    description: scriptData.description || '',
    duration: totalDuration,
    scenes: (scriptData.scenes || []).map((s, i) => ({
      id: generateId('scene'),
      order: s.order || i + 1,
      type: s.type || 'concept',
      title: s.title || `Scene ${i + 1}`,
      narration: s.narration || '',
      visualInstructions: s.visualInstructions || '',
      codeSnippet: s.codeSnippet,
      duration: s.duration || 30,
    })),
    narration: fullNarration,
    keywords: scriptData.keywords || [],
  };

  // Store script
  await db.videoScript.create({
    data: {
      id: script.id,
      organizationId: orgId,
      documentId: body.documentId,
      title: script.title,
      description: script.description,
      duration: script.duration,
      scenes: script.scenes,
      narration: script.narration,
      keywords: script.keywords,
      status: 'draft',
    },
  });

  log.info({ scriptId: script.id, scenes: script.scenes.length }, 'Video script generated');

  return c.json({
    success: true,
    data: script,
  }, 201);
});

// Get video script
app.get('/scripts/:scriptId', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  return c.json({
    success: true,
    data: script,
  });
});

// List video scripts
app.get('/scripts', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (status) whereClause.status = status;

  const scripts = await db.videoScript.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      duration: true,
      status: true,
      createdAt: true,
    },
  });

  return c.json({
    success: true,
    data: scripts,
  });
});

// Update video script
app.put('/scripts/:scriptId', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    title?: string;
    description?: string;
    scenes?: VideoScene[];
    status?: 'draft' | 'review' | 'approved' | 'published';
  }>();

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const updated = await db.videoScript.update({
    where: { id: scriptId },
    data: {
      title: body.title,
      description: body.description,
      scenes: body.scenes,
      status: body.status,
      narration: body.scenes?.map(s => s.narration).join('\n\n'),
      duration: body.scenes?.reduce((acc, s) => acc + s.duration, 0),
    },
  });

  return c.json({
    success: true,
    data: updated,
  });
});

// Delete video script
app.delete('/scripts/:scriptId', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  await db.videoScript.delete({ where: { id: scriptId } });

  return c.json({ success: true });
});

// ============================================================================
// Text-to-Speech / Narration
// ============================================================================

// Generate narration audio for a scene
app.post('/scripts/:scriptId/scenes/:sceneOrder/narration', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const sceneOrder = parseInt(c.req.param('sceneOrder'), 10);
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    voice?: string;
    speed?: number;
  }>();

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const scenes = script.scenes as VideoScene[];
  const scene = scenes.find(s => s.order === sceneOrder);

  if (!scene) {
    throw new NotFoundError('Scene', String(sceneOrder));
  }

  // In production, this would call a TTS service (e.g., ElevenLabs, AWS Polly)
  // For now, return metadata about what would be generated
  const narrationMetadata = {
    sceneId: scene.id,
    text: scene.narration,
    estimatedDuration: Math.ceil(scene.narration.split(' ').length / 2.5), // ~150 wpm
    voice: body.voice || 'default',
    speed: body.speed || 1.0,
    status: 'pending', // Would be 'processing' or 'completed' in production
  };

  return c.json({
    success: true,
    data: {
      message: 'Narration generation queued',
      ...narrationMetadata,
    },
  }, 202);
});

// ============================================================================
// Code Animation / Visual Generation
// ============================================================================

// Generate code animation instructions
app.post('/scripts/:scriptId/code-animations', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const scenes = script.scenes as VideoScene[];
  const codeScenes = scenes.filter(s => s.type === 'code' && s.codeSnippet);

  // Generate animation instructions for each code scene
  const animations = await Promise.all(codeScenes.map(async (scene) => {
    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Generate code animation instructions for this code walkthrough.

Code:
\`\`\`
${scene.codeSnippet}
\`\`\`

Narration: ${scene.narration}

Return JSON array of animation steps:
[
  { "line": 1, "action": "highlight|type|fade-in", "delay": 0.5, "description": "what's happening" }
]

Each step should sync with the narration. Return ONLY the JSON array.`,
        },
      ],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
    
    try {
      return {
        sceneId: scene.id,
        sceneOrder: scene.order,
        steps: JSON.parse(content),
      };
    } catch {
      return {
        sceneId: scene.id,
        sceneOrder: scene.order,
        steps: [],
      };
    }
  }));

  return c.json({
    success: true,
    data: {
      scriptId,
      animations,
    },
  });
});

// ============================================================================
// Video Export / Rendering
// ============================================================================

// Queue video rendering
app.post('/scripts/:scriptId/render', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    format?: '1080p' | '720p' | '4k';
    includeSubtitles?: boolean;
    brandingOptions?: {
      logo?: string;
      watermark?: boolean;
      intro?: boolean;
      outro?: boolean;
    };
  }>();

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  // In production, this would queue a video rendering job
  const renderJob = {
    id: generateId('render'),
    scriptId,
    format: body.format || '1080p',
    includeSubtitles: body.includeSubtitles ?? true,
    branding: body.brandingOptions || {},
    status: 'queued',
    estimatedCompletionTime: new Date(Date.now() + script.duration * 10 * 1000), // ~10x realtime
  };

  return c.json({
    success: true,
    data: {
      message: 'Video render job queued',
      job: renderJob,
    },
  }, 202);
});

export { app as videoDocRoutes };
