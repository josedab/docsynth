/**
 * Documentation Language Server Protocol Service
 *
 * Provides LSP-style diagnostics (stale references, broken links, missing params),
 * context-aware completions, and cross-reference resolution for documentation files.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-lsp-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}

export interface Diagnostic {
  range: Range;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  code: string;
  source: 'docsynth';
}

export interface CompletionItem {
  label: string;
  kind: 'reference' | 'snippet' | 'api-signature';
  detail: string;
  insertText: string;
  documentation: string;
}

export interface ReferenceLocation {
  path: string;
  range: Range;
  type: 'doc-ref' | 'api-ref' | 'code-ref';
}

export interface IndexedFile {
  path: string;
  symbols: string[];
  references: string[];
  lastModified: Date;
}

export interface WorkspaceIndex {
  repositoryId: string;
  files: IndexedFile[];
  lastIndexed: Date;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Run all diagnostic checks on a document and return any issues found.
 */
export async function diagnoseDocument(
  repositoryId: string,
  filePath: string,
  content: string
): Promise<Diagnostic[]> {
  log.info({ repositoryId, filePath }, 'Running diagnostics on document');
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...checkBrokenLinks(content));
  diagnostics.push(...(await checkStaleReferences(content, repositoryId)));
  diagnostics.push(...checkMissingParams(content));

  try {
    await db.diagnosticRun.create({
      data: {
        repositoryId,
        filePath,
        diagnosticCount: diagnostics.length,
        errorCount: diagnostics.filter((d) => d.severity === 'error').length,
        warningCount: diagnostics.filter((d) => d.severity === 'warning').length,
      },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to persist diagnostic run');
  }

  log.info({ repositoryId, filePath, count: diagnostics.length }, 'Diagnostics complete');
  return diagnostics;
}

/**
 * Provide context-aware completions at a given cursor position.
 */
export async function getCompletions(
  repositoryId: string,
  filePath: string,
  content: string,
  position: Position
): Promise<CompletionItem[]> {
  log.info({ repositoryId, filePath, position }, 'Generating completions');
  const completions: CompletionItem[] = [];
  const lines = content.split('\n');
  const prefix = (lines[position.line] ?? '').slice(0, position.character);

  const refMatch = prefix.match(/@ref:(\w*)$/);
  if (refMatch) {
    const sigs = await findApiSignatures(repositoryId, refMatch[1] ?? '');
    completions.push(...sigs);
  }

  if (prefix.trim() === '') {
    completions.push({
      label: 'api-endpoint',
      kind: 'snippet',
      detail: 'API endpoint documentation block',
      insertText: '### `${1:METHOD} ${2:/path}`\n\n${3:Description}\n',
      documentation: 'Insert a complete API endpoint documentation block',
    });
  }

  log.info({ repositoryId, count: completions.length }, 'Completions generated');
  return completions;
}

/**
 * Resolve a documentation cross-reference to its target location.
 */
export async function resolveReference(
  repositoryId: string,
  reference: string
): Promise<ReferenceLocation | null> {
  log.info({ repositoryId, reference }, 'Resolving reference');
  const typeMap: Record<string, ReferenceLocation['type']> = {
    ref: 'doc-ref',
    api: 'api-ref',
    code: 'code-ref',
  };
  const prefixMatch = reference.match(/^@(ref|api|code):(.+)$/);
  const symbol = prefixMatch ? prefixMatch[2]! : reference;
  const refType = prefixMatch ? (typeMap[prefixMatch[1]!] ?? 'doc-ref') : 'doc-ref';

  try {
    const indexed = await db.workspaceSymbol.findFirst({ where: { repositoryId, name: symbol } });
    if (indexed) {
      return {
        path: indexed.filePath,
        range: {
          start: { line: indexed.startLine, character: indexed.startCol },
          end: { line: indexed.endLine, character: indexed.endCol },
        },
        type: refType,
      };
    }
    const docs = await db.document.findMany({
      where: { repositoryId },
      select: { filePath: true, content: true },
    });
    for (const doc of docs) {
      const idx = (doc.content ?? '').indexOf(symbol);
      if (idx >= 0) {
        const before = doc.content.slice(0, idx);
        const line = before.split('\n').length - 1;
        const character = idx - before.lastIndexOf('\n') - 1;
        return {
          path: doc.filePath,
          range: {
            start: { line, character },
            end: { line, character: character + symbol.length },
          },
          type: refType,
        };
      }
    }
  } catch (error) {
    log.error({ error, reference }, 'Failed to resolve reference');
  }
  return null;
}

/**
 * Index all files in a repository for LSP features.
 */
export async function indexWorkspace(repositoryId: string): Promise<WorkspaceIndex> {
  log.info({ repositoryId }, 'Indexing workspace');
  const documents = await db.document.findMany({
    where: { repositoryId },
    select: { filePath: true, content: true, updatedAt: true },
  });

  const files: IndexedFile[] = documents.map(
    (doc: { filePath: string; content: string; updatedAt: Date }) => ({
      path: doc.filePath,
      symbols: extractSymbols(doc.content ?? ''),
      references: detectDocReferences(doc.content ?? ''),
      lastModified: doc.updatedAt,
    })
  );

  try {
    await db.workspaceIndex.upsert({
      where: { repositoryId },
      create: {
        repositoryId,
        fileCount: files.length,
        symbolCount: files.reduce((s, f) => s + f.symbols.length, 0),
        indexedAt: new Date(),
      },
      update: {
        fileCount: files.length,
        symbolCount: files.reduce((s, f) => s + f.symbols.length, 0),
        indexedAt: new Date(),
      },
    });
  } catch (error) {
    log.warn({ error }, 'Failed to persist workspace index');
  }

  log.info({ repositoryId, fileCount: files.length }, 'Workspace indexing complete');
  return { repositoryId, files, lastIndexed: new Date() };
}

/**
 * Get symbols defined at a specific cursor position in a file.
 */
export async function getSymbolsAtPosition(
  repositoryId: string,
  filePath: string,
  position: Position
): Promise<string[]> {
  log.info({ repositoryId, filePath, position }, 'Getting symbols at position');
  try {
    const doc = await db.document.findFirst({
      where: { repositoryId, filePath },
      select: { content: true },
    });
    if (!doc?.content) return [];
    const line = doc.content.split('\n')[position.line];
    if (!line) return [];
    const wordStart = line.slice(0, position.character).match(/[\w.-]+$/)?.[0] ?? '';
    const wordEnd = line.slice(position.character).match(/^[\w.-]+/)?.[0] ?? '';
    const word = wordStart + wordEnd;
    if (!word) return [];
    return extractSymbols(doc.content).filter((sym) => sym === word || sym.includes(word));
  } catch (error) {
    log.error({ error, filePath }, 'Failed to get symbols at position');
    return [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

function checkBrokenLinks(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');
  const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    linkPattern.lastIndex = 0;
    while ((m = linkPattern.exec(lines[i]!)) !== null) {
      const url = m[2] ?? '';
      if (!url.trim()) {
        diagnostics.push({
          range: {
            start: { line: i, character: m.index },
            end: { line: i, character: m.index + m[0].length },
          },
          severity: 'error',
          message: `Empty link target for "${m[1]}"`,
          code: 'broken-link-empty',
          source: 'docsynth',
        });
      } else if (url === '#' || url.startsWith('TODO')) {
        diagnostics.push({
          range: {
            start: { line: i, character: m.index },
            end: { line: i, character: m.index + m[0].length },
          },
          severity: 'warning',
          message: `Placeholder link: "${url}"`,
          code: 'broken-link-placeholder',
          source: 'docsynth',
        });
      }
    }
  }
  return diagnostics;
}

async function checkStaleReferences(content: string, repositoryId: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');
  for (const ref of detectDocReferences(content)) {
    try {
      const exists = await db.workspaceSymbol.findFirst({ where: { repositoryId, name: ref } });
      if (!exists) {
        for (let i = 0; i < lines.length; i++) {
          const col = lines[i]!.indexOf(ref);
          if (col >= 0) {
            diagnostics.push({
              range: {
                start: { line: i, character: col },
                end: { line: i, character: col + ref.length },
              },
              severity: 'warning',
              message: `Stale reference: "${ref}"`,
              code: 'stale-reference',
              source: 'docsynth',
            });
            break;
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  return diagnostics;
}

function checkMissingParams(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (!inCode) continue;
    const m = line.match(/(?:function|def|func|fn)\s+(\w+)\s*\(([^)]+)\)/);
    if (m) {
      for (const p of m[2]!.split(',')) {
        const name = p
          .trim()
          .split(/[:\s=]/)[0]!
          .trim();
        if (name && !content.includes(`@param ${name}`) && !content.includes(`| ${name} |`)) {
          diagnostics.push({
            range: { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
            severity: 'hint',
            message: `Param "${name}" of "${m[1]}" undocumented`,
            code: 'missing-param-doc',
            source: 'docsynth',
          });
        }
      }
    }
  }
  return diagnostics;
}

function detectDocReferences(content: string): string[] {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  const patterns = [/@ref:(\w[\w.-]*)/g, /\{@link\s+(\w[\w.-]*)\}/g, /\[\[(\w[\w.-]*)\]\]/g];
  for (const p of patterns) {
    while ((m = p.exec(content)) !== null) refs.push(m[1]!);
  }
  return [...new Set(refs)];
}

async function findApiSignatures(repositoryId: string, prefix: string): Promise<CompletionItem[]> {
  try {
    const symbols = await db.workspaceSymbol.findMany({
      where: { repositoryId, name: { startsWith: prefix }, type: 'function' },
      take: 10,
    });
    return symbols.map((s: { name: string; signature: string; filePath: string }) => ({
      label: s.name,
      kind: 'api-signature' as const,
      detail: s.signature ?? s.name,
      insertText: `\`${s.name}\``,
      documentation: `Defined in ${s.filePath}`,
    }));
  } catch {
    return [];
  }
}

function extractSymbols(content: string): string[] {
  const syms: string[] = [];
  let m: RegExpExecArray | null;
  const hp = /^#{1,6}\s+(.+)$/gm;
  while ((m = hp.exec(content)) !== null) syms.push(m[1]!.trim());
  const cp = /`(\w[\w.]*(?:\([^)]*\))?)`/g;
  while ((m = cp.exec(content)) !== null) syms.push(m[1]!);
  return [...new Set(syms)];
}
