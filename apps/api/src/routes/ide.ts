import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, createLogger, getAnthropicClient } from '@docsynth/utils';
import {
  parseApiSurface,
  detectBreakingChanges,
  analyzeBreakingChangesWithAI,
  analyzeDocumentationImpact,
} from '../services/breaking-change.service.js';
import type {
  IDEPreviewRequest,
  IDEPreviewResponse,
  IDESuggestion,
  StyleWarning,
  DocumentPreview,
  IDEDiffAnalysis,
  DiffChange,
  DocumentType,
  SemanticChangeType,
  StyleProfile,
} from '@docsynth/types';

const app = new Hono();
const log = createLogger('ide-routes');

// Helper to safely cast Prisma JSON to StyleProfile
function toStyleProfile(data: unknown): StyleProfile | null {
  if (!data || typeof data !== 'object') return null;
  return data as StyleProfile;
}

// Get extension manifest / configuration
app.get('/manifest', async (c) => {
  return c.json({
    success: true,
    data: {
      name: 'DocSynth',
      displayName: 'DocSynth - AI Documentation',
      version: '0.2.0',
      description: 'AI-powered documentation that stays current with your code',
      publisher: 'DocSynth',
      capabilities: [
        'doc-preview',
        'doc-health',
        'doc-suggestions',
        'inline-docs',
        'diff-analysis',
        'style-enforcement',
        'real-time-preview',
      ],
      endpoints: {
        preview: '/api/ide/preview',
        health: '/api/ide/health',
        suggestions: '/api/ide/suggestions',
        inline: '/api/ide/inline',
        diff: '/api/ide/diff',
        style: '/api/ide/style',
        config: '/api/ide/config',
      },
      supportedLanguages: ['typescript', 'javascript', 'python', 'go', 'rust', 'java'],
      settings: {
        autoPreview: { type: 'boolean', default: true, description: 'Enable automatic preview on save' },
        previewDebounceMs: { type: 'number', default: 500, description: 'Debounce delay for preview updates' },
        showInlineHints: { type: 'boolean', default: true, description: 'Show inline documentation hints' },
        styleEnforcement: { type: 'string', enum: ['off', 'warn', 'error'], default: 'warn' },
      },
    },
  });
});

// Enhanced doc preview with AI analysis
app.post('/preview', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<IDEPreviewRequest>();

  if (!body.repositoryId || !body.filePath) {
    throw new ValidationError('repositoryId and filePath are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      styleProfile: true,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Analyze file to determine what docs would be generated
  const analysis = await analyzeFileForDocsEnhanced(
    body.filePath,
    body.fileContent,
    body.cursorPosition,
    toStyleProfile(repository.styleProfile)
  );

  return c.json({
    success: true,
    data: analysis,
  });
});

// Get doc health status for workspace
app.get('/health/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
    include: {
      documents: {
        select: { id: true, path: true, type: true, updatedAt: true },
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const now = new Date();
  const healthStatus = repository.documents.map((doc) => {
    const daysSinceUpdate = Math.floor(
      (now.getTime() - doc.updatedAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    return {
      path: doc.path,
      type: doc.type,
      status: daysSinceUpdate <= 7 ? 'fresh' : daysSinceUpdate <= 30 ? 'aging' : 'stale',
      daysSinceUpdate,
    };
  });

  const summary = {
    fresh: healthStatus.filter((h) => h.status === 'fresh').length,
    aging: healthStatus.filter((h) => h.status === 'aging').length,
    stale: healthStatus.filter((h) => h.status === 'stale').length,
  };

  return c.json({
    success: true,
    data: {
      repositoryId,
      summary,
      documents: healthStatus,
    },
  });
});

// Get inline doc suggestions for a code block
app.post('/suggestions', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    codeBlock: string;
    lineNumber: number;
    context?: string;
  }>();

  if (!body.repositoryId || !body.codeBlock) {
    throw new ValidationError('repositoryId and codeBlock are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Generate documentation suggestions for the code
  const suggestions = generateCodeSuggestions(body.codeBlock, body.filePath);

  return c.json({
    success: true,
    data: {
      filePath: body.filePath,
      lineNumber: body.lineNumber,
      suggestions,
    },
  });
});

// Generate inline documentation
app.post('/inline', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    codeBlock: string;
    style?: 'jsdoc' | 'tsdoc' | 'docstring';
  }>();

  if (!body.repositoryId || !body.codeBlock) {
    throw new ValidationError('repositoryId and codeBlock are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Generate inline documentation
  const inlineDoc = generateInlineDoc(body.codeBlock, body.style ?? 'jsdoc');

  return c.json({
    success: true,
    data: {
      documentation: inlineDoc,
      style: body.style ?? 'jsdoc',
    },
  });
});


// Helper: Generate code documentation suggestions
function generateCodeSuggestions(
  codeBlock: string,
  _filePath: string
): { type: string; suggestion: string; priority: 'high' | 'medium' | 'low' }[] {
  const suggestions: { type: string; suggestion: string; priority: 'high' | 'medium' | 'low' }[] = [];

  // Check for undocumented functions
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g;
  let match;
  while ((match = funcRegex.exec(codeBlock)) !== null) {
    const funcName = match[1];
    suggestions.push({
      type: 'function',
      suggestion: `Add JSDoc documentation for function '${funcName}'`,
      priority: 'high',
    });
  }

  // Check for undocumented classes
  const classRegex = /(?:export\s+)?class\s+(\w+)/g;
  while ((match = classRegex.exec(codeBlock)) !== null) {
    const className = match[1];
    suggestions.push({
      type: 'class',
      suggestion: `Add class documentation for '${className}'`,
      priority: 'high',
    });
  }

  // Check for complex logic
  const complexity = (codeBlock.match(/if\s*\(|switch\s*\(|for\s*\(|while\s*\(/g) || []).length;
  if (complexity > 5) {
    suggestions.push({
      type: 'complexity',
      suggestion: 'Consider adding inline comments to explain complex logic',
      priority: 'medium',
    });
  }

  return suggestions;
}

// Helper: Generate inline documentation
function generateInlineDoc(codeBlock: string, style: 'jsdoc' | 'tsdoc' | 'docstring'): string {
  // Extract function signature
  const funcMatch = codeBlock.match(
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\w+))?/
  );

  if (!funcMatch) {
    return `/** TODO: Add documentation */`;
  }

  const funcName = funcMatch[1];
  const params = funcMatch[2]
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) ?? [];
  const returnType = funcMatch[3] ?? 'void';

  if (style === 'jsdoc' || style === 'tsdoc') {
    let doc = `/**\n * ${funcName} - TODO: Add description\n *\n`;
    for (const param of params) {
      const paramName = param.split(':')[0]?.trim() ?? param;
      doc += ` * @param ${paramName} - TODO: describe parameter\n`;
    }
    if (returnType !== 'void') {
      doc += ` * @returns ${returnType} - TODO: describe return value\n`;
    }
    doc += ' */';
    return doc;
  }

  // Python docstring style
  let doc = `"""\n${funcName} - TODO: Add description\n\nArgs:\n`;
  for (const param of params) {
    const paramName = param.split(':')[0]?.trim() ?? param;
    doc += `    ${paramName}: TODO: describe parameter\n`;
  }
  doc += `\nReturns:\n    TODO: describe return value\n"""`;
  return doc;
}

// ============================================================================
// Enhanced IDE Features (Feature 3: IDE Real-Time Doc Preview)
// ============================================================================

// Analyze diff between original and modified content
app.post('/diff', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    originalContent: string;
    modifiedContent: string;
  }>();

  if (!body.repositoryId || !body.filePath) {
    throw new ValidationError('repositoryId and filePath are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const analysis = analyzeDiff(
    body.originalContent || '',
    body.modifiedContent || '',
    body.filePath
  );

  return c.json({
    success: true,
    data: analysis,
  });
});

// Check style compliance
app.post('/style', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    content: string;
  }>();

  if (!body.repositoryId || !body.content) {
    throw new ValidationError('repositoryId and content are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      styleProfile: true,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const warnings = checkStyleCompliance(body.content, body.filePath, toStyleProfile(repository.styleProfile));

  return c.json({
    success: true,
    data: {
      filePath: body.filePath,
      warnings,
      compliant: warnings.length === 0,
    },
  });
});

// Get or update IDE extension configuration for a repository
app.get('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const config = (repository.config as Record<string, unknown>)?.ide ?? {
    autoPreview: true,
    previewDebounceMs: 500,
    showInlineHints: true,
    styleEnforcement: 'warn',
    excludePatterns: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
  };

  return c.json({
    success: true,
    data: config,
  });
});

app.put('/config/:repositoryId', requireAuth, requireOrgAccess, async (c) => {
  const repositoryId = c.req.param('repositoryId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    autoPreview?: boolean;
    previewDebounceMs?: number;
    showInlineHints?: boolean;
    styleEnforcement?: 'off' | 'warn' | 'error';
    excludePatterns?: string[];
  }>();

  const repository = await prisma.repository.findFirst({
    where: { id: repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', repositoryId);
  }

  const currentConfig = repository.config as Record<string, unknown>;
  const updatedConfig = {
    ...currentConfig,
    ide: {
      ...(currentConfig?.ide as Record<string, unknown> || {}),
      ...body,
    },
  };

  await prisma.repository.update({
    where: { id: repositoryId },
    data: { config: updatedConfig },
  });

  return c.json({
    success: true,
    data: updatedConfig.ide,
  });
});

// Generate AI-powered inline documentation
app.post('/inline/ai', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    codeBlock: string;
    context?: string;
    style?: 'jsdoc' | 'tsdoc' | 'docstring';
  }>();

  if (!body.repositoryId || !body.codeBlock) {
    throw new ValidationError('repositoryId and codeBlock are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      styleProfile: true,
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const documentation = await generateAIInlineDoc(
    body.codeBlock,
    body.filePath,
    body.context,
    body.style ?? 'jsdoc',
    toStyleProfile(repository.styleProfile)
  );

  return c.json({
    success: true,
    data: documentation,
  });
});

// ============================================================================
// ============================================================================
// Enhanced Helper Functions
// ============================================================================

async function analyzeFileForDocsEnhanced(
  filePath: string,
  content: string,
  cursorPosition?: { line: number; character: number },
  styleProfile?: StyleProfile | null
): Promise<IDEPreviewResponse> {
  const suggestedTypes: DocumentType[] = [];
  const suggestions: IDESuggestion[] = [];
  const styleWarnings: StyleWarning[] = [];
  const previews: DocumentPreview[] = [];
  let confidence = 0;

  // Analyze exports
  const exportMatches = content.matchAll(/export\s+(default\s+)?(?:const|function|class|interface|type)\s+(\w+)/g);
  const exports = Array.from(exportMatches);
  
  if (exports.length > 0) {
    suggestedTypes.push('API_REFERENCE');
    confidence += 30;
    
    previews.push({
      type: 'API_REFERENCE',
      title: `API Reference for ${filePath.split('/').pop()}`,
      contentPreview: `Documents ${exports.length} exported ${exports.length === 1 ? 'symbol' : 'symbols'}`,
      affectedSections: exports.map((e) => e[2]).filter((s): s is string => s !== undefined),
      estimatedLength: exports.length * 150,
    });
  }

  // Analyze classes
  const classMatches = content.matchAll(/(?:export\s+)?class\s+(\w+)/g);
  const classes = Array.from(classMatches);
  
  for (const classMatch of classes) {
    const className = classMatch[1];
    const classStart = content.indexOf(classMatch[0]);
    const lineNumber = content.slice(0, classStart).split('\n').length;

    // Check if class has documentation
    const beforeClass = content.slice(Math.max(0, classStart - 200), classStart);
    if (!beforeClass.includes('/**') && !beforeClass.includes('*/')) {
      suggestions.push({
        type: 'missing-doc',
        message: `Class '${className}' is missing documentation`,
        location: { line: lineNumber, character: 0 },
        severity: 'warning',
        quickFix: {
          title: 'Add class documentation',
          replacement: `/**\n * ${className} - TODO: Add description\n */\n`,
        },
      });
    }
  }

  // Analyze functions
  const funcMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g);
  const functions = Array.from(funcMatches);

  for (const funcMatch of functions) {
    const funcName = funcMatch[1];
    const funcStart = content.indexOf(funcMatch[0]);
    const lineNumber = content.slice(0, funcStart).split('\n').length;

    // Check if function has documentation
    const beforeFunc = content.slice(Math.max(0, funcStart - 200), funcStart);
    if (!beforeFunc.includes('/**') && !beforeFunc.includes('*/')) {
      suggestions.push({
        type: 'missing-doc',
        message: `Function '${funcName}' is missing documentation`,
        location: { line: lineNumber, character: 0 },
        severity: 'warning',
        quickFix: {
          title: 'Add function documentation',
          replacement: `/**\n * ${funcName} - TODO: Add description\n */\n`,
        },
      });
    }
  }

  // Check for route handlers
  if (filePath.includes('/routes/') || filePath.includes('/api/')) {
    suggestedTypes.push('API_REFERENCE');
    confidence += 25;
  }

  // Check for README-worthy content
  if (filePath.includes('src/') && content.length > 500 && !filePath.includes('.test.') && !filePath.includes('.spec.')) {
    if (!suggestedTypes.includes('README')) {
      suggestedTypes.push('README');
    }
    confidence += 10;
  }

  // Check complexity
  const controlStructures = (content.match(/if\s*\(|switch\s*\(|for\s*\(|while\s*\(/g) || []).length;
  if (controlStructures > 10) {
    suggestions.push({
      type: 'complexity',
      message: 'High complexity detected. Consider adding explanatory comments.',
      location: { line: 1, character: 0 },
      severity: 'info',
    });
  }

  // Style checks
  if (styleProfile) {
    const warnings = checkStyleCompliance(content, filePath, styleProfile);
    styleWarnings.push(...warnings);
  }

  const wouldGenerate = confidence >= 30;

  return {
    wouldGenerateDocs: wouldGenerate,
    documentTypes: [...new Set(suggestedTypes)],
    preview: previews,
    suggestions,
    styleWarnings,
    confidence: Math.min(100, confidence),
  };
}

function analyzeDiff(
  originalContent: string,
  modifiedContent: string,
  filePath: string
): IDEDiffAnalysis {
  const changes: DiffChange[] = [];
  
  const originalLines = originalContent.split('\n');
  const modifiedLines = modifiedContent.split('\n');

  // Simple line-by-line diff
  let i = 0;
  let j = 0;

  while (i < originalLines.length || j < modifiedLines.length) {
    if (i >= originalLines.length) {
      // Remaining lines are additions
      const content = modifiedLines[j] ?? '';
      changes.push({
        type: 'added',
        startLine: j + 1,
        endLine: j + 1,
        content,
        semanticType: detectSemanticType(content),
      });
      j++;
    } else if (j >= modifiedLines.length) {
      // Remaining lines are deletions
      const content = originalLines[i] ?? '';
      changes.push({
        type: 'removed',
        startLine: i + 1,
        endLine: i + 1,
        content,
        semanticType: detectSemanticType(content),
      });
      i++;
    } else if (originalLines[i] !== modifiedLines[j]) {
      // Line modified
      const content = modifiedLines[j] ?? '';
      changes.push({
        type: 'modified',
        startLine: j + 1,
        endLine: j + 1,
        content,
        semanticType: detectSemanticType(content),
      });
      i++;
      j++;
    } else {
      i++;
      j++;
    }
  }

  // Determine documentation impact
  const hasNewExports = changes.some((c) => c.type === 'added' && c.content.includes('export'));
  const hasNewFunctions = changes.some((c) => c.type === 'added' && /function\s+\w+/.test(c.content));
  const hasNewClasses = changes.some((c) => c.type === 'added' && /class\s+\w+/.test(c.content));
  const hasSignatureChanges = changes.some((c) => c.semanticType === 'signature-change');

  const affectedDocTypes: DocumentType[] = [];
  const suggestedActions: string[] = [];

  if (hasNewExports || hasNewFunctions || hasNewClasses) {
    affectedDocTypes.push('API_REFERENCE');
    suggestedActions.push('Update API documentation with new exports');
  }

  if (hasSignatureChanges) {
    affectedDocTypes.push('API_REFERENCE');
    suggestedActions.push('Update API documentation to reflect signature changes');
  }

  if (filePath.includes('README') || (changes.length > 20 && filePath.includes('src/'))) {
    affectedDocTypes.push('README');
    suggestedActions.push('Consider updating README with significant changes');
  }

  return {
    originalContent,
    modifiedContent,
    changes,
    documentationImpact: {
      requiresUpdate: affectedDocTypes.length > 0,
      affectedDocTypes,
      suggestedActions,
    },
  };
}

function detectSemanticType(line: string): SemanticChangeType | undefined {
  if (/export\s+(default\s+)?(?:const|function|class)/.test(line)) {
    return 'new-export';
  }
  if (/function\s+\w+/.test(line)) {
    return 'new-function';
  }
  if (/class\s+\w+/.test(line)) {
    return 'new-class';
  }
  if (/interface\s+\w+/.test(line)) {
    return 'new-interface';
  }
  if (/type\s+\w+\s*=/.test(line)) {
    return 'new-type';
  }
  if (/@deprecated/.test(line)) {
    return 'deprecation';
  }
  return undefined;
}

function checkStyleCompliance(
  content: string,
  filePath: string,
  styleProfile: StyleProfile | null
): StyleWarning[] {
  const warnings: StyleWarning[] = [];

  // Check for consistent doc style
  const jsdocCount = (content.match(/\/\*\*/g) || []).length;
  const slashCommentCount = (content.match(/\/\/\s*\w/g) || []).length;

  if (jsdocCount > 0 && slashCommentCount > jsdocCount * 2) {
    warnings.push({
      rule: 'consistent-doc-style',
      message: 'Mix of JSDoc and line comments. Consider using consistent documentation style.',
      location: { line: 1, character: 0 },
      expected: 'JSDoc comments (/**)',
      actual: 'Mix of styles',
    });
  }

  // Check for TODO/FIXME without tracking
  const todoMatches = content.matchAll(/\/\/\s*(TODO|FIXME)(?!:\s*\w+-\d+)/gi);
  for (const match of todoMatches) {
    const lineNumber = content.slice(0, match.index).split('\n').length;
    warnings.push({
      rule: 'tracked-todos',
      message: 'TODO/FIXME should reference a ticket number',
      location: { line: lineNumber, character: 0 },
      expected: 'TODO: TICKET-123',
      actual: match[0],
    });
  }

  // Check terminology consistency if style profile exists
  if (styleProfile?.terminology) {
    for (const [incorrect, correct] of Object.entries(styleProfile.terminology)) {
      const regex = new RegExp(`\\b${incorrect}\\b`, 'gi');
      const matches = content.matchAll(regex);
      for (const match of matches) {
        const lineNumber = content.slice(0, match.index).split('\n').length;
        warnings.push({
          rule: 'terminology',
          message: `Use '${correct}' instead of '${incorrect}'`,
          location: { line: lineNumber, character: 0 },
          expected: correct,
          actual: incorrect,
        });
      }
    }
  }

  return warnings;
}

async function generateAIInlineDoc(
  codeBlock: string,
  filePath: string,
  context: string | undefined,
  style: 'jsdoc' | 'tsdoc' | 'docstring',
  styleProfile: StyleProfile | null
): Promise<{ documentation: string; confidence: number }> {
  try {
    const styleGuidance = styleProfile?.tone
      ? `Tone: formality=${styleProfile.tone.formality}, technicality=${styleProfile.tone.technicality}`
      : '';

    const anthropic = getAnthropicClient();
    if (!anthropic) {
      throw new Error('Anthropic client not available');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Generate ${style} documentation for this code.

Code:
\`\`\`
${codeBlock}
\`\`\`

${context ? `Context: ${context}` : ''}
${styleGuidance}

File: ${filePath}

Requirements:
- Use ${style} format
- Be concise but complete
- Include parameter descriptions
- Include return value description
- Add example if helpful

Return ONLY the documentation comment, no explanations.`,
        },
      ],
    });

    const documentation = response.content[0]?.type === 'text' 
      ? response.content[0].text.trim() 
      : generateInlineDoc(codeBlock, style);

    return {
      documentation,
      confidence: 0.85,
    };
  } catch (error) {
    log.warn({ error }, 'AI doc generation failed, using fallback');
    return {
      documentation: generateInlineDoc(codeBlock, style),
      confidence: 0.5,
    };
  }
}

// Explain code using documentation context (for Copilot Chat integration)
app.post('/explain', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    code: string;
    filePath?: string;
  }>();

  if (!body.repositoryId || !body.code) {
    throw new ValidationError('repositoryId and code are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      documents: {
        take: 10,
        select: { id: true, path: true, title: true, content: true, type: true },
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Find related documentation
  const relatedDocs = findRelatedDocumentation(body.code, repository.documents);

  // Generate explanation using AI with doc context
  const explanation = await generateCodeExplanation(
    body.code,
    relatedDocs,
    body.filePath
  );

  return c.json({
    success: true,
    data: explanation,
  });
});

// Helper: Find documentation related to code
function findRelatedDocumentation(
  code: string,
  documents: { id: string; path: string; title: string; content: string; type: string }[]
): Array<{ title: string; path: string; excerpt: string }> {
  const codeLower = code.toLowerCase();

  // Extract identifiers from code
  const identifiers = codeLower.match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
  const uniqueIdentifiers = [...new Set(identifiers)].filter(id => id.length > 2);

  return documents
    .map((doc) => {
      const contentLower = doc.content.toLowerCase();
      let relevance = 0;

      for (const id of uniqueIdentifiers) {
        if (contentLower.includes(id)) {
          relevance++;
        }
      }

      // Boost for matching file paths
      if (doc.path.toLowerCase().includes(code.split('/').pop()?.toLowerCase() || '')) {
        relevance += 5;
      }

      return {
        doc,
        relevance,
      };
    })
    .filter((d) => d.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)
    .map((d) => ({
      title: d.doc.title,
      path: d.doc.path,
      excerpt: d.doc.content.slice(0, 300) + '...',
    }));
}

// Helper: Generate code explanation with documentation context
async function generateCodeExplanation(
  code: string,
  relatedDocs: Array<{ title: string; path: string; excerpt: string }>,
  filePath?: string
): Promise<{
  explanation: string;
  relatedDocs: Array<{ title: string; path: string; excerpt: string }>;
  codeExamples: Array<{ language: string; code: string; description?: string }>;
}> {
  const anthropic = getAnthropicClient();

  if (!anthropic) {
    return {
      explanation: 'Unable to generate explanation - AI service not configured.',
      relatedDocs,
      codeExamples: [],
    };
  }

  const docContext = relatedDocs
    .map((d) => `### ${d.title}\n${d.excerpt}`)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: `Explain this code based on the project documentation.

Code:
\`\`\`
${code}
\`\`\`

${filePath ? `File: ${filePath}` : ''}

Related Documentation:
${docContext || 'No related documentation found.'}

Provide:
1. A clear explanation of what this code does
2. How it fits into the larger project (based on docs)
3. Any relevant usage examples

Be concise but helpful.`,
        },
      ],
    });

    const explanation = response.content[0]?.type === 'text'
      ? response.content[0].text
      : 'Unable to generate explanation.';

    return {
      explanation,
      relatedDocs,
      codeExamples: [],
    };
  } catch (error) {
    log.error({ error }, 'Code explanation generation failed');
    return {
      explanation: 'Unable to generate explanation due to an error.',
      relatedDocs,
      codeExamples: [],
    };
  }
}

// ============================================================================
// API Breaking Change Detection (Feature 5)
// ============================================================================

// Analyze code changes for breaking API changes
app.post('/breaking-changes', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    originalCode: string;
    modifiedCode: string;
    prContext?: { title?: string; body?: string };
  }>();

  if (!body.repositoryId || !body.filePath || !body.originalCode || !body.modifiedCode) {
    throw new ValidationError('repositoryId, filePath, originalCode, and modifiedCode are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
    include: {
      documents: {
        select: { path: true, content: true, type: true },
      },
    },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Analyze breaking changes with AI enhancement
  const report = await analyzeBreakingChangesWithAI(
    body.originalCode,
    body.modifiedCode,
    body.filePath,
    body.prContext ? { prTitle: body.prContext.title, prBody: body.prContext.body } : undefined
  );

  // Find affected documentation
  if (report.breakingChanges.length > 0) {
    const docs = repository.documents.map(d => ({
      path: d.path,
      content: d.content,
      type: d.type,
    }));
    report.affectedDocumentation = await analyzeDocumentationImpact(report.breakingChanges, docs);
  }

  return c.json({
    success: true,
    data: report,
  });
});

// Quick static analysis for breaking changes (no AI, faster)
app.post('/breaking-changes/quick', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    originalCode: string;
    modifiedCode: string;
  }>();

  if (!body.repositoryId || !body.filePath) {
    throw new ValidationError('repositoryId and filePath are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  // Static analysis only (fast)
  const oldSurface = parseApiSurface(body.originalCode || '', body.filePath);
  const newSurface = parseApiSurface(body.modifiedCode || '', body.filePath);
  const breakingChanges = detectBreakingChanges(oldSurface, newSurface);

  return c.json({
    success: true,
    data: {
      hasBreakingChanges: breakingChanges.length > 0,
      breakingChanges,
      suggestedVersionBump: breakingChanges.length > 0 ? 'major' : 'patch',
      apiSurface: {
        original: {
          functions: oldSurface.functions.length,
          interfaces: oldSurface.interfaces.length,
          types: oldSurface.types.length,
        },
        modified: {
          functions: newSurface.functions.length,
          interfaces: newSurface.interfaces.length,
          types: newSurface.types.length,
        },
      },
    },
  });
});

// Get API surface for a file
app.post('/api-surface', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    repositoryId: string;
    filePath: string;
    code: string;
  }>();

  if (!body.repositoryId || !body.filePath || !body.code) {
    throw new ValidationError('repositoryId, filePath, and code are required');
  }

  const repository = await prisma.repository.findFirst({
    where: { id: body.repositoryId, organizationId: orgId },
  });

  if (!repository) {
    throw new NotFoundError('Repository', body.repositoryId);
  }

  const surface = parseApiSurface(body.code, body.filePath);

  return c.json({
    success: true,
    data: {
      filePath: body.filePath,
      functions: surface.functions,
      interfaces: surface.interfaces,
      types: surface.types,
      exports: surface.exports,
      summary: {
        totalExports: surface.functions.length + surface.interfaces.length + surface.types.length,
        functions: surface.functions.length,
        interfaces: surface.interfaces.length,
        types: surface.types.length,
      },
    },
  });
});

export { app as ideRoutes };
