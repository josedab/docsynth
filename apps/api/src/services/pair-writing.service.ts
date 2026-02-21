/**
 * Real-Time Co-Pilot Pair Writing Service
 *
 * Manages AI co-writing sessions with streaming suggestions, fact-checking
 * against the codebase, and context-aware completion support.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('pair-writing-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface Suggestion {
  id: string;
  type: 'completion' | 'example' | 'signature' | 'table' | 'explanation';
  content: string;
  position: number;
  confidence: number;
  accepted?: boolean;
}

export interface WritingSession {
  id: string;
  repositoryId: string;
  documentPath: string;
  userId: string;
  content: string;
  cursorPosition: number;
  status: 'active' | 'paused' | 'closed';
  suggestions: Suggestion[];
  createdAt: Date;
}

export interface FactCheckResult {
  claim: string;
  verified: boolean;
  evidence: string;
  confidence: number;
}

export interface SessionConfig {
  autoComplete: boolean;
  factCheckEnabled: boolean;
  suggestionDelay: number;
  maxSuggestions: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new pair-writing session for a document.
 */
export async function createSession(
  repositoryId: string,
  documentPath: string,
  userId: string
): Promise<WritingSession> {
  log.info({ repositoryId, documentPath, userId }, 'Creating writing session');

  const existingDoc = await prisma.document.findFirst({
    where: { repositoryId, path: documentPath },
    select: { content: true },
  });

  const sessionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const session: WritingSession = {
    id: sessionId,
    repositoryId,
    documentPath,
    userId,
    content: existingDoc?.content ?? '',
    cursorPosition: existingDoc?.content?.length ?? 0,
    status: 'active',
    suggestions: [],
    createdAt: new Date(),
  };

  await db.writingSession.create({
    data: {
      id: session.id,
      repositoryId,
      documentPath,
      userId,
      content: session.content,
      cursorPosition: session.cursorPosition,
      status: session.status,
      suggestions: JSON.parse(JSON.stringify(session.suggestions)),
      createdAt: session.createdAt,
    },
  });

  log.info({ sessionId, repositoryId, documentPath }, 'Writing session created');
  return session;
}

/**
 * Generate a context-aware suggestion based on current content and cursor position.
 */
export async function generateSuggestion(
  sessionId: string,
  content: string,
  cursorPosition: number
): Promise<Suggestion> {
  log.info({ sessionId, cursorPosition }, 'Generating suggestion');

  const session = await db.writingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const context = content.slice(Math.max(0, cursorPosition - 500), cursorPosition);
  const suggestionType = detectCompletionContext(context);

  let suggestionContent: string;
  let confidence: number;

  if (suggestionType === 'signature' || suggestionType === 'example') {
    const result = generateCodeExample(context, suggestionType);
    suggestionContent = result.content;
    confidence = result.confidence;
  } else if (suggestionType === 'table') {
    suggestionContent = generateTableSkeleton(context);
    confidence = 0.7;
  } else if (suggestionType === 'explanation') {
    suggestionContent = generateExplanation(context);
    confidence = 0.65;
  } else {
    suggestionContent = generateCompletion(context);
    confidence = 0.8;
  }

  const suggestion: Suggestion = {
    id: `sug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: suggestionType,
    content: suggestionContent,
    position: cursorPosition,
    confidence,
    accepted: undefined,
  };

  await db.writingSession.update({
    where: { id: sessionId },
    data: {
      content,
      cursorPosition,
      suggestions: {
        push: JSON.parse(JSON.stringify(suggestion)),
      },
    },
  });

  log.info({ sessionId, suggestionType, confidence }, 'Suggestion generated');
  return suggestion;
}

/**
 * Validate factual claims in documentation content against the actual codebase.
 */
export async function factCheckContent(
  repositoryId: string,
  content: string
): Promise<FactCheckResult[]> {
  log.info({ repositoryId, contentLength: content.length }, 'Fact-checking content');

  const claims = extractFactualClaims(content);
  const results: FactCheckResult[] = [];

  const repoFiles = await prisma.document.findMany({
    where: { repositoryId, path: { endsWith: '.ts' } },
    select: { path: true, content: true },
    take: 200,
  });

  const codeContent = repoFiles
    .filter((f) => f.content)
    .map((f) => ({ path: f.path, content: f.content! }));

  for (const claim of claims) {
    let verified = false;
    let evidence = 'No matching code found';
    let confidence = 0.3;

    // Check function name claims
    const funcMatch = claim.match(/`(\w+)\(`|function\s+(\w+)/);
    if (funcMatch) {
      const funcName = funcMatch[1] ?? funcMatch[2];
      for (const file of codeContent) {
        if (
          file.content.includes(`function ${funcName}`) ||
          file.content.includes(`${funcName}(`)
        ) {
          verified = true;
          evidence = `Found in ${file.path}`;
          confidence = 0.95;
          break;
        }
      }
    }

    // Check parameter claims
    const paramMatch = claim.match(/accepts?\s+(?:a\s+)?`?(\w+)`?\s+parameter/i);
    if (paramMatch) {
      const paramName = paramMatch[1];
      for (const file of codeContent) {
        if (file.content.includes(paramName)) {
          verified = true;
          evidence = `Parameter found in ${file.path}`;
          confidence = 0.85;
          break;
        }
      }
    }

    // Check return type claims
    const returnMatch = claim.match(/returns?\s+(?:a\s+)?`?(\w+)`?/i);
    if (returnMatch && !verified) {
      const typeName = returnMatch[1];
      for (const file of codeContent) {
        if (
          file.content.includes(`}: ${typeName}`) ||
          file.content.includes(`Promise<${typeName}>`)
        ) {
          verified = true;
          evidence = `Return type found in ${file.path}`;
          confidence = 0.8;
          break;
        }
      }
    }

    results.push({ claim, verified, evidence, confidence });
  }

  log.info(
    { repositoryId, claims: claims.length, verified: results.filter((r) => r.verified).length },
    'Fact-check complete'
  );
  return results;
}

/**
 * Accept and apply a suggestion to the session content.
 */
export async function acceptSuggestion(
  sessionId: string,
  suggestionId: string
): Promise<WritingSession> {
  log.info({ sessionId, suggestionId }, 'Accepting suggestion');

  const session = await db.writingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const suggestions = (session.suggestions ?? []) as Suggestion[];
  const suggestion = suggestions.find((s: Suggestion) => s.id === suggestionId);
  if (!suggestion) throw new Error(`Suggestion ${suggestionId} not found in session`);

  suggestion.accepted = true;

  const currentContent = session.content as string;
  const position = suggestion.position;
  const newContent =
    currentContent.slice(0, position) + suggestion.content + currentContent.slice(position);

  await db.writingSession.update({
    where: { id: sessionId },
    data: {
      content: newContent,
      cursorPosition: position + suggestion.content.length,
      suggestions: JSON.parse(JSON.stringify(suggestions)),
    },
  });

  log.info({ sessionId, suggestionId, type: suggestion.type }, 'Suggestion accepted');
  return {
    id: session.id,
    repositoryId: session.repositoryId,
    documentPath: session.documentPath,
    userId: session.userId,
    content: newContent,
    cursorPosition: position + suggestion.content.length,
    status: session.status,
    suggestions,
    createdAt: session.createdAt,
  };
}

/**
 * Get the current state of a writing session.
 */
export async function getSession(sessionId: string): Promise<WritingSession | null> {
  const session = await db.writingSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  return {
    id: session.id,
    repositoryId: session.repositoryId,
    documentPath: session.documentPath,
    userId: session.userId,
    content: session.content,
    cursorPosition: session.cursorPosition,
    status: session.status,
    suggestions: (session.suggestions ?? []) as Suggestion[],
    createdAt: session.createdAt,
  };
}

/**
 * Persist final content and close the writing session.
 */
export async function closeSession(sessionId: string): Promise<void> {
  log.info({ sessionId }, 'Closing writing session');

  const session = await db.writingSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // Save content back to the document
  await prisma.document.updateMany({
    where: { repositoryId: session.repositoryId, path: session.documentPath },
    data: { content: session.content, updatedAt: new Date() },
  });

  await db.writingSession.update({
    where: { id: sessionId },
    data: { status: 'closed', closedAt: new Date() },
  });

  const suggestions = (session.suggestions ?? []) as Suggestion[];
  const accepted = suggestions.filter((s: Suggestion) => s.accepted).length;

  log.info({ sessionId, accepted, total: suggestions.length }, 'Writing session closed');
}

// ============================================================================
// Private Helpers
// ============================================================================

function detectCompletionContext(
  context: string
): 'completion' | 'example' | 'signature' | 'table' | 'explanation' {
  const tail = context.trimEnd();
  if (/```\w*\s*$/.test(tail) || /example/i.test(tail.slice(-80))) return 'example';
  if (/function|method|api|endpoint/i.test(tail.slice(-60)) && /\(/.test(tail.slice(-30)))
    return 'signature';
  if (/\|.*\|.*\|/.test(tail.slice(-100)) || /table|comparison/i.test(tail.slice(-60)))
    return 'table';
  if (/why|how|what|explain/i.test(tail.slice(-40))) return 'explanation';
  return 'completion';
}

function generateCodeExample(
  context: string,
  style: 'signature' | 'example'
): { content: string; confidence: number } {
  const funcMatch = context.match(/(\w+)\s*\(/);
  const funcName = funcMatch?.[1] ?? 'myFunction';

  if (style === 'signature') {
    return {
      content: `\n\`\`\`typescript\nfunction ${funcName}(param: string): Promise<void>\n\`\`\`\n`,
      confidence: 0.75,
    };
  }

  return {
    content: `\n\`\`\`typescript\nimport { ${funcName} } from './module';\n\nconst result = await ${funcName}('value');\nconsole.log(result);\n\`\`\`\n`,
    confidence: 0.7,
  };
}

function generateTableSkeleton(context: string): string {
  const headerMatch = context.match(/(\w+)\s+(?:vs|and|comparison)/i);
  const subject = headerMatch?.[1] ?? 'Feature';

  return `\n| ${subject} | Description | Default |\n|---|---|---|\n| Option A | Description of A | — |\n| Option B | Description of B | — |\n`;
}

function generateExplanation(context: string): string {
  const topicMatch = context.match(/(?:why|how|what)\s+(?:does?\s+)?(\w+\s?\w*)/i);
  const topic = topicMatch?.[1]?.trim() ?? 'this feature';

  return `\n${topic.charAt(0).toUpperCase() + topic.slice(1)} works by processing the input data through a series of validation and transformation steps. `;
}

function generateCompletion(context: string): string {
  const lastLine = context.split('\n').pop()?.trim() ?? '';

  if (lastLine.startsWith('#')) {
    return '\n\nThis section describes the key concepts and usage patterns.\n';
  }
  if (lastLine.startsWith('-') || lastLine.startsWith('*')) {
    return '\n- Additional item to consider\n';
  }
  if (lastLine.endsWith(':')) {
    return '\n\n1. First step\n2. Second step\n3. Third step\n';
  }
  return ' This provides a solid foundation for building on top of the existing functionality.';
}

function extractFactualClaims(content: string): string[] {
  const claims: string[] = [];
  const sentences = content.split(/[.!?\n]/).filter((s) => s.trim().length > 10);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();

    if (/`\w+`/.test(trimmed) || /function\s+\w+/.test(trimmed)) claims.push(trimmed);
    else if (/(?:returns?|accepts?|requires?|throws?|supports?)\s/i.test(trimmed))
      claims.push(trimmed);
  }

  return [...new Set(claims)].slice(0, 20);
}
