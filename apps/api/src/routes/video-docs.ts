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

// ============================================================================
// Thumbnail Generation
// ============================================================================

// Generate thumbnail for a video
app.post('/scripts/:scriptId/thumbnail', requireAuth, requireOrgAccess, rateLimit('ai'), async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    style?: 'minimal' | 'detailed' | 'branded';
    includeTitle?: boolean;
    colorScheme?: string;
  }>();

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    throw new Error('Anthropic client not available');
  }

  // Generate thumbnail design prompt
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Create a thumbnail design specification for a developer documentation video.

Video Title: ${script.title}
Description: ${script.description}
Keywords: ${(script.keywords as string[]).join(', ')}
Style: ${body.style ?? 'minimal'}

Generate a JSON object with:
{
  "headline": "Short eye-catching headline (max 5 words)",
  "subheadline": "Optional supporting text",
  "iconSuggestion": "Emoji or icon name that represents the topic",
  "colors": {
    "background": "#hex",
    "primary": "#hex",
    "text": "#hex"
  },
  "layoutType": "centered|split|featured-code",
  "codeSnippet": "Short code snippet to feature (if applicable, max 3 lines)"
}

Return ONLY valid JSON.`,
      },
    ],
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';

  let thumbnailSpec: object;
  try {
    thumbnailSpec = JSON.parse(content);
  } catch {
    thumbnailSpec = {
      headline: script.title,
      iconSuggestion: '📚',
      colors: { background: '#1a1a2e', primary: '#4a9eff', text: '#ffffff' },
      layoutType: 'centered',
    };
  }

  return c.json({
    success: true,
    data: {
      scriptId,
      specification: thumbnailSpec,
      dimensions: { width: 1280, height: 720 },
    },
  });
});

// ============================================================================
// Chapter Markers
// ============================================================================

// Generate chapter markers for a video
app.post('/scripts/:scriptId/chapters', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const scenes = script.scenes as VideoScene[];
  let cumulativeTime = 0;

  const chapters = scenes.map((scene) => {
    const startTime = cumulativeTime;
    cumulativeTime += scene.duration;

    return {
      id: scene.id,
      title: scene.title,
      startTime,
      startTimeFormatted: formatTimestamp(startTime),
      duration: scene.duration,
      type: scene.type,
    };
  });

  // Generate YouTube-compatible chapter description
  const youtubeChapters = chapters
    .map((ch) => `${ch.startTimeFormatted} ${ch.title}`)
    .join('\n');

  return c.json({
    success: true,
    data: {
      scriptId,
      chapters,
      youtubeFormat: youtubeChapters,
      totalDuration: cumulativeTime,
    },
  });
});

// ============================================================================
// Video Series Management
// ============================================================================

// Create a video series
app.post('/series', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    title: string;
    description?: string;
    repositoryId?: string;
  }>();

  if (!body.title) {
    throw new ValidationError('title is required');
  }

  const seriesId = generateId('vseries');

  await db.videoSeries.create({
    data: {
      id: seriesId,
      organizationId: orgId,
      repositoryId: body.repositoryId,
      title: body.title,
      description: body.description,
      order: [],
      status: 'draft',
    },
  });

  return c.json({
    success: true,
    data: { id: seriesId, title: body.title },
  }, 201);
});

// Add script to series
app.post('/series/:seriesId/scripts/:scriptId', requireAuth, requireOrgAccess, async (c) => {
  const seriesId = c.req.param('seriesId');
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ position?: number }>();

  const series = await db.videoSeries.findFirst({
    where: { id: seriesId, organizationId: orgId },
  });

  if (!series) {
    throw new NotFoundError('VideoSeries', seriesId);
  }

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const order = (series.order as string[]) || [];
  if (order.includes(scriptId)) {
    return c.json({ success: true, message: 'Script already in series' });
  }

  if (body.position !== undefined && body.position >= 0 && body.position < order.length) {
    order.splice(body.position, 0, scriptId);
  } else {
    order.push(scriptId);
  }

  await db.videoSeries.update({
    where: { id: seriesId },
    data: { order },
  });

  return c.json({
    success: true,
    data: { seriesId, scriptId, position: order.indexOf(scriptId) },
  });
});

// Get video series with scripts
app.get('/series/:seriesId', requireAuth, requireOrgAccess, async (c) => {
  const seriesId = c.req.param('seriesId');
  const orgId = c.get('organizationId');

  const series = await db.videoSeries.findFirst({
    where: { id: seriesId, organizationId: orgId },
  });

  if (!series) {
    throw new NotFoundError('VideoSeries', seriesId);
  }

  const order = (series.order as string[]) || [];

  const scripts = order.length > 0
    ? await db.videoScript.findMany({
        where: { id: { in: order }, organizationId: orgId },
        select: {
          id: true,
          title: true,
          description: true,
          duration: true,
          status: true,
        },
      })
    : [];

  // Sort scripts by order
  const orderedScripts = order
    .map((id) => scripts.find((s: { id: string }) => s.id === id))
    .filter(Boolean);

  return c.json({
    success: true,
    data: {
      ...series,
      scripts: orderedScripts,
      totalDuration: orderedScripts.reduce((sum: number, s: { duration?: number }) => sum + (s?.duration || 0), 0),
    },
  });
});

// List video series
app.get('/series', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const seriesList = await db.videoSeries.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      description: true,
      order: true,
      status: true,
      createdAt: true,
    },
  });

  const seriesWithCounts = seriesList.map((s: { id: string; order: string[] | null }) => ({
    ...s,
    scriptCount: Array.isArray(s.order) ? s.order.length : 0,
  }));

  return c.json({
    success: true,
    data: seriesWithCounts,
  });
});

// ============================================================================
// Transcript Export
// ============================================================================

// Export transcript in various formats
app.get('/scripts/:scriptId/transcript', requireAuth, requireOrgAccess, async (c) => {
  const scriptId = c.req.param('scriptId');
  const orgId = c.get('organizationId');
  const format = c.req.query('format') || 'text';

  const script = await db.videoScript.findFirst({
    where: { id: scriptId, organizationId: orgId },
  });

  if (!script) {
    throw new NotFoundError('VideoScript', scriptId);
  }

  const scenes = script.scenes as VideoScene[];

  switch (format) {
    case 'json': {
      return c.json({
        success: true,
        data: {
          title: script.title,
          segments: scenes.map((scene) => ({
            title: scene.title,
            type: scene.type,
            text: scene.narration,
            duration: scene.duration,
          })),
        },
      });
    }

    case 'srt': {
      let srt = '';
      let cumulativeTime = 0;
      let index = 1;

      for (const scene of scenes) {
        // Split into chunks of ~10 words
        const words = scene.narration.split(/\s+/);
        const chunks: string[] = [];
        let chunk: string[] = [];

        for (const word of words) {
          chunk.push(word);
          if (chunk.length >= 10) {
            chunks.push(chunk.join(' '));
            chunk = [];
          }
        }
        if (chunk.length > 0) chunks.push(chunk.join(' '));

        const chunkDuration = scene.duration / Math.max(chunks.length, 1);

        for (const text of chunks) {
          const start = formatSRT(cumulativeTime);
          const end = formatSRT(cumulativeTime + chunkDuration);
          srt += `${index}\n${start} --> ${end}\n${text}\n\n`;
          cumulativeTime += chunkDuration;
          index++;
        }
      }

      return c.text(srt, 200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${script.title.replace(/\s+/g, '_')}.srt"`,
      });
    }

    case 'vtt': {
      let vtt = 'WEBVTT\n\n';
      let cumulativeTime = 0;

      for (const scene of scenes) {
        const words = scene.narration.split(/\s+/);
        const chunks: string[] = [];
        let chunk: string[] = [];

        for (const word of words) {
          chunk.push(word);
          if (chunk.length >= 10) {
            chunks.push(chunk.join(' '));
            chunk = [];
          }
        }
        if (chunk.length > 0) chunks.push(chunk.join(' '));

        const chunkDuration = scene.duration / Math.max(chunks.length, 1);

        for (const text of chunks) {
          const start = formatVTT(cumulativeTime);
          const end = formatVTT(cumulativeTime + chunkDuration);
          vtt += `${start} --> ${end}\n${text}\n\n`;
          cumulativeTime += chunkDuration;
        }
      }

      return c.text(vtt, 200, {
        'Content-Type': 'text/vtt',
        'Content-Disposition': `attachment; filename="${script.title.replace(/\s+/g, '_')}.vtt"`,
      });
    }

    default: {
      // Plain text transcript
      const transcript = scenes
        .map((scene) => `## ${scene.title}\n\n${scene.narration}`)
        .join('\n\n---\n\n');

      return c.text(`# ${script.title}\n\n${transcript}`, 200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${script.title.replace(/\s+/g, '_')}_transcript.txt"`,
      });
    }
  }
});

// ============================================================================
// Video Analytics
// ============================================================================

// Track video view/engagement
app.post('/scripts/:scriptId/analytics', async (c) => {
  const scriptId = c.req.param('scriptId');
  const body = await c.req.json<{
    event: 'view' | 'play' | 'pause' | 'complete' | 'chapter_skip';
    timestamp?: number;
    metadata?: Record<string, unknown>;
  }>();

  // In production, store in analytics table
  log.info({ scriptId, event: body.event, timestamp: body.timestamp }, 'Video analytics event');

  return c.json({ success: true });
});

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function formatVTT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export { app as videoDocRoutes };
