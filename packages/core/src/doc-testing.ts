// ============================================================================
// Types
// ============================================================================

export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'java';

export interface CodeBlock {
  language: SupportedLanguage | string;
  code: string;
  startLine: number;
  endLine: number;
  heading: string | null;
}

export interface ValidationResult {
  valid: boolean;
  language: string;
  errors: ValidationError[];
  startLine: number;
  endLine: number;
}

export interface ValidationError {
  message: string;
  line?: number;
  column?: number;
}

export interface DocumentValidationResult {
  codeBlocks: number;
  validBlocks: number;
  invalidBlocks: number;
  results: ValidationResult[];
}

// ============================================================================
// Constants
// ============================================================================

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  java: 'java',
};

const SUPPORTED_LANGUAGES = new Set<SupportedLanguage>([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
]);

const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
};

// ============================================================================
// Code Block Extraction
// ============================================================================

/**
 * Extract fenced code blocks from markdown content with language detection.
 */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split('\n');
  let currentHeading: string | null = null;
  let inBlock = false;
  let blockLang = '';
  let blockLines: string[] = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch && !inBlock) {
      currentHeading = headingMatch[2]!;
      continue;
    }

    // Detect fenced code block boundaries
    if (line.trimStart().startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        blockLang = line.trimStart().slice(3).trim().split(/\s/)[0] ?? '';
        blockLines = [];
        blockStart = i + 1;
      } else {
        inBlock = false;
        blocks.push({
          language: normalizeLanguage(blockLang),
          code: blockLines.join('\n'),
          startLine: blockStart + 1, // 1-indexed
          endLine: i + 1,
          heading: currentHeading,
        });
      }
      continue;
    }

    if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

/**
 * Normalize a language identifier to a supported language or return as-is.
 */
export function normalizeLanguage(lang: string): SupportedLanguage | string {
  const lower = lang.toLowerCase();
  return LANGUAGE_ALIASES[lower] ?? lower;
}

/**
 * Check if a language is supported for validation.
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.has(lang as SupportedLanguage);
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate all code blocks in a markdown document.
 */
export function validateDocument(markdown: string): DocumentValidationResult {
  const blocks = extractCodeBlocks(markdown);
  const results = blocks
    .filter((b) => isSupportedLanguage(b.language))
    .map((block) => validateCodeBlock(block));

  const validBlocks = results.filter((r) => r.valid).length;

  return {
    codeBlocks: results.length,
    validBlocks,
    invalidBlocks: results.length - validBlocks,
    results,
  };
}

/**
 * Validate a single code block based on its language.
 */
export function validateCodeBlock(block: CodeBlock): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isSupportedLanguage(block.language)) {
    return {
      valid: true,
      language: block.language,
      errors: [],
      startLine: block.startLine,
      endLine: block.endLine,
    };
  }

  // Universal checks
  errors.push(...checkBracketBalance(block.code));

  // Language-specific checks
  switch (block.language) {
    case 'typescript':
    case 'javascript':
      errors.push(...validateJavaScriptFamily(block.code));
      break;
    case 'python':
      errors.push(...validatePython(block.code));
      break;
    case 'go':
      errors.push(...validateGo(block.code));
      break;
    case 'rust':
      errors.push(...validateRust(block.code));
      break;
    case 'java':
      errors.push(...validateJava(block.code));
      break;
  }

  return {
    valid: errors.length === 0,
    language: block.language,
    errors,
    startLine: block.startLine,
    endLine: block.endLine,
  };
}

// ============================================================================
// Syntax Checks
// ============================================================================

/**
 * Check that brackets, braces, and parentheses are balanced.
 */
function checkBracketBalance(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const stack: { char: string; line: number }[] = [];
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const lines = code.split('\n');
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    inLineComment = false;

    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!;
      const next = line[col + 1];

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          col++;
        }
        continue;
      }

      if (inLineComment) continue;

      if (inString) {
        if (ch === '\\') {
          col++;
          continue;
        }
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === '/' && next === '/') {
        inLineComment = true;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        col++;
        continue;
      }
      if (ch === '#') {
        inLineComment = true;
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (BRACKET_PAIRS[ch]) {
        stack.push({ char: ch, line: lineIdx + 1 });
      } else if (closers[ch]) {
        const last = stack.pop();
        if (!last || last.char !== closers[ch]) {
          errors.push({ message: `Unmatched '${ch}'`, line: lineIdx + 1, column: col + 1 });
        }
      }
    }
  }

  for (const open of stack) {
    errors.push({ message: `Unclosed '${open.char}'`, line: open.line });
  }

  return errors;
}

function validateJavaScriptFamily(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Detect incomplete arrow functions: `=> {` without matching close on same line is fine,
    // but `=> ` at end of line without `{` or value is suspicious
    if (/^(const|let|var)\s+\w+\s*=\s*$/.test(line)) {
      errors.push({ message: 'Incomplete variable declaration', line: i + 1 });
    }
  }

  // Check for unterminated template literals
  const backtickCount = (code.match(/(?<!\\)`/g) ?? []).length;
  if (backtickCount % 2 !== 0) {
    errors.push({ message: 'Unterminated template literal' });
  }

  return errors;
}

function validatePython(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;

    // Check for mixed tabs and spaces in indentation
    const indent = line.match(/^(\s+)/);
    if (indent && /\t/.test(indent[1]!) && / /.test(indent[1]!)) {
      errors.push({ message: 'Mixed tabs and spaces in indentation', line: i + 1 });
    }

    // Check for colons after def/class/if/for/while
    if (
      /^\s*(def|class|if|elif|for|while|with|try|except|finally)\s/.test(line) &&
      !line.trimEnd().endsWith(':') &&
      !line.trimEnd().endsWith('\\')
    ) {
      errors.push({ message: `Missing colon after '${line.trim().split(/\s/)[0]}'`, line: i + 1 });
    }
  }

  return errors;
}

function validateGo(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Go opening braces must be on the same line
    if (/^(func|if|for|switch|select)\s/.test(line) && !line.includes('{') && !line.endsWith(')')) {
      errors.push({ message: 'Opening brace must be on the same line in Go', line: i + 1 });
    }
  }

  return errors;
}

function validateRust(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Check for missing semicolons on let bindings
    if (/^let\s+(mut\s+)?\w+/.test(line) && !line.endsWith(';') && !line.endsWith('{')) {
      errors.push({ message: 'Missing semicolon on let binding', line: i + 1 });
    }
  }

  return errors;
}

function validateJava(code: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Check for missing semicolons on statements (excluding blocks, comments, annotations)
    if (
      line.length > 0 &&
      !line.startsWith('//') &&
      !line.startsWith('*') &&
      !line.startsWith('@') &&
      !line.startsWith('import ') &&
      !line.endsWith('{') &&
      !line.endsWith('}') &&
      !line.endsWith(';') &&
      /^(return|System\.|int |String |double |float |boolean |char |long |short |byte )/.test(line)
    ) {
      errors.push({ message: 'Possibly missing semicolon', line: i + 1 });
    }
  }

  return errors;
}
