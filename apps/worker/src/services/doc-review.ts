import type { ReviewCategory, ReviewSeverity, DocSuggestion, CodeReference } from '@docsynth/types';

interface ReviewInput {
  content: string;
  documentType: string;
  filePath?: string;
  codeContext?: Array<{ path: string; content: string }>;
  styleGuide?: StyleGuideConfig;
}

interface StyleGuideConfig {
  rules: Array<{
    pattern: string;
    replacement?: string;
    message: string;
    severity: ReviewSeverity;
  }>;
  terminology: Record<string, string>;
}

interface ReviewResult {
  overallScore: number;
  accuracyScore: number;
  clarityScore: number;
  styleScore: number;
  suggestions: DocSuggestion[];
  codeReferences: CodeReference[];
  summary: string;
}

class DocReviewService {
  /**
   * Perform comprehensive documentation review
   */
  async reviewDocument(input: ReviewInput): Promise<ReviewResult> {
    const suggestions: DocSuggestion[] = [];
    const codeReferences: CodeReference[] = [];
    const lines = input.content.split('\n');

    // Check accuracy against code
    const accuracyIssues = await this.checkAccuracy(input.content, input.codeContext || []);
    suggestions.push(...accuracyIssues);

    // Check clarity
    const clarityIssues = this.checkClarity(lines);
    suggestions.push(...clarityIssues);

    // Check style guide compliance
    if (input.styleGuide) {
      const styleIssues = this.checkStyleGuide(lines, input.styleGuide);
      suggestions.push(...styleIssues);
    }

    // Check grammar and writing quality
    const grammarIssues = this.checkGrammar(lines);
    suggestions.push(...grammarIssues);

    // Check completeness
    const completenessIssues = this.checkCompleteness(input.content, input.documentType);
    suggestions.push(...completenessIssues);

    // Calculate scores
    const scores = this.calculateScores(suggestions, lines.length);

    // Generate summary
    const summary = this.generateSummary(suggestions, scores);

    return {
      ...scores,
      suggestions,
      codeReferences,
      summary,
    };
  }

  /**
   * Check documentation accuracy against code
   */
  private async checkAccuracy(
    content: string,
    codeContext: Array<{ path: string; content: string }>
  ): Promise<DocSuggestion[]> {
    const suggestions: DocSuggestion[] = [];
    const lines = content.split('\n');

    // Extract function/method references from documentation
    const codeRefPattern = /`([a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?)`/g;
    const backtickPattern = /```[\s\S]*?```/g;

    // Remove code blocks for reference extraction
    const contentWithoutBlocks = content.replace(backtickPattern, '');
    const refs = [...contentWithoutBlocks.matchAll(codeRefPattern)]
      .map((m) => m[1])
      .filter((r): r is string => r !== undefined);

    // Build code symbol index
    const codeSymbols = new Set<string>();
    for (const file of codeContext) {
      const funcPattern = /(?:function|const|let|var|class|interface|type)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
      const matches = [...file.content.matchAll(funcPattern)];
      matches.forEach((m) => codeSymbols.add(m[1]!));
    }

    // Check if referenced symbols exist in code
    for (const ref of refs) {
      const symbolName = ref.replace(/\([^)]*\)/, '');
      if (symbolName.length > 2 && !codeSymbols.has(symbolName)) {
        const lineIndex = lines.findIndex((l) => l.includes(`\`${ref}\``));
        if (lineIndex >= 0) {
          suggestions.push({
            id: `accuracy-${lineIndex}`,
            category: 'accuracy',
            severity: 'warning',
            lineStart: lineIndex + 1,
            lineEnd: lineIndex + 1,
            originalText: ref,
            suggestion: `Verify that \`${symbolName}\` exists in the codebase`,
            explanation: 'This symbol reference was not found in the provided code context',
          });
        }
      }
    }

    // Check for outdated patterns
    const outdatedPatterns = [
      { pattern: /callback\s*\(/i, message: 'Consider using async/await instead of callbacks' },
      { pattern: /var\s+/i, message: 'Consider using const/let instead of var in examples' },
      { pattern: /\.then\s*\(/i, message: 'Consider using async/await syntax for clarity' },
    ];

    lines.forEach((line, idx) => {
      for (const { pattern, message } of outdatedPatterns) {
        if (pattern.test(line)) {
          suggestions.push({
            id: `outdated-${idx}`,
            category: 'outdated',
            severity: 'suggestion',
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: line.trim(),
            suggestion: message,
            explanation: 'Modern JavaScript practices are recommended for documentation examples',
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * Check documentation clarity
   */
  private checkClarity(lines: string[]): DocSuggestion[] {
    const suggestions: DocSuggestion[] = [];

    lines.forEach((line, idx) => {
      // Check for overly long sentences
      const sentences = line.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      for (const sentence of sentences) {
        const wordCount = sentence.trim().split(/\s+/).length;
        if (wordCount > 40) {
          suggestions.push({
            id: `clarity-long-${idx}`,
            category: 'clarity',
            severity: 'suggestion',
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: sentence.trim().substring(0, 50) + '...',
            suggestion: 'Consider breaking this into shorter sentences',
            explanation: `Sentence has ${wordCount} words, which may be hard to follow`,
          });
        }
      }

      // Check for passive voice
      const passivePatterns = [
        /is\s+\w+ed\s+by/i,
        /are\s+\w+ed\s+by/i,
        /was\s+\w+ed\s+by/i,
        /were\s+\w+ed\s+by/i,
        /been\s+\w+ed/i,
      ];

      for (const pattern of passivePatterns) {
        if (pattern.test(line)) {
          suggestions.push({
            id: `clarity-passive-${idx}`,
            category: 'clarity',
            severity: 'info',
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: line.trim(),
            suggestion: 'Consider using active voice for clearer documentation',
            explanation: 'Active voice is generally clearer and more direct',
          });
          break;
        }
      }

      // Check for jargon without explanation
      const jargonTerms = ['idempotent', 'middleware', 'polymorphism', 'serialization'];
      for (const term of jargonTerms) {
        if (line.toLowerCase().includes(term) && !line.toLowerCase().includes('means') && !line.toLowerCase().includes('is a')) {
          suggestions.push({
            id: `clarity-jargon-${idx}-${term}`,
            category: 'clarity',
            severity: 'info',
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: term,
            suggestion: `Consider explaining "${term}" for readers unfamiliar with the term`,
            explanation: 'Technical jargon should be explained for broader accessibility',
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * Check style guide compliance
   */
  private checkStyleGuide(lines: string[], styleGuide: StyleGuideConfig): DocSuggestion[] {
    const suggestions: DocSuggestion[] = [];

    // Check terminology consistency
    lines.forEach((line, idx) => {
      for (const [incorrect, correct] of Object.entries(styleGuide.terminology)) {
        const pattern = new RegExp(`\\b${incorrect}\\b`, 'gi');
        if (pattern.test(line)) {
          suggestions.push({
            id: `style-term-${idx}-${incorrect}`,
            category: 'style',
            severity: 'warning',
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: incorrect,
            suggestion: `Use "${correct}" instead of "${incorrect}"`,
            explanation: 'Terminology should be consistent per style guide',
          });
        }
      }

      // Check custom rules
      for (const rule of styleGuide.rules) {
        const pattern = new RegExp(rule.pattern, 'gi');
        if (pattern.test(line)) {
          suggestions.push({
            id: `style-rule-${idx}-${rule.pattern}`,
            category: 'style',
            severity: rule.severity,
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: line.trim(),
            suggestion: rule.replacement || rule.message,
            explanation: rule.message,
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * Check grammar and writing quality
   */
  private checkGrammar(lines: string[]): DocSuggestion[] {
    const suggestions: DocSuggestion[] = [];

    const grammarRules = [
      { pattern: /\s+,/g, message: 'Remove space before comma', severity: 'error' as ReviewSeverity },
      { pattern: /\s+\./g, message: 'Remove space before period', severity: 'error' as ReviewSeverity },
      { pattern: /\s{2,}/g, message: 'Remove extra spaces', severity: 'warning' as ReviewSeverity },
      { pattern: /\bi\b/g, message: 'Capitalize "I"', severity: 'error' as ReviewSeverity },
      { pattern: /\bjavascript\b/g, message: 'Use "JavaScript" (capital J and S)', severity: 'warning' as ReviewSeverity },
      { pattern: /\btypescript\b/g, message: 'Use "TypeScript" (capital T and S)', severity: 'warning' as ReviewSeverity },
      { pattern: /\bgithub\b/g, message: 'Use "GitHub" (capital H)', severity: 'warning' as ReviewSeverity },
      { pattern: /e\.g\s+[^,]/g, message: 'Add comma after "e.g."', severity: 'info' as ReviewSeverity },
      { pattern: /i\.e\s+[^,]/g, message: 'Add comma after "i.e."', severity: 'info' as ReviewSeverity },
    ];

    lines.forEach((line, idx) => {
      // Skip code blocks
      if (line.trim().startsWith('```') || line.trim().startsWith('`')) return;

      for (const rule of grammarRules) {
        if (rule.pattern.test(line)) {
          suggestions.push({
            id: `grammar-${idx}-${rule.pattern.source}`,
            category: 'grammar',
            severity: rule.severity,
            lineStart: idx + 1,
            lineEnd: idx + 1,
            originalText: line.trim(),
            suggestion: rule.message,
            explanation: 'Grammar and formatting consistency',
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * Check documentation completeness
   */
  private checkCompleteness(content: string, documentType: string): DocSuggestion[] {
    const suggestions: DocSuggestion[] = [];
    const contentLower = content.toLowerCase();

    const requiredSections: Record<string, string[]> = {
      README: ['installation', 'usage', 'license'],
      API_REFERENCE: ['parameters', 'returns', 'example'],
      GUIDE: ['prerequisites', 'steps', 'next steps'],
      CHANGELOG: ['added', 'changed', 'removed', 'fixed'],
    };

    const sections = requiredSections[documentType] || [];
    const missingSections = sections.filter((section) => !contentLower.includes(section));

    if (missingSections.length > 0) {
      suggestions.push({
        id: 'completeness-sections',
        category: 'completeness',
        severity: 'warning',
        suggestion: `Consider adding sections for: ${missingSections.join(', ')}`,
        explanation: `${documentType} documents typically include these sections`,
      });
    }

    // Check for code examples
    if (!content.includes('```')) {
      suggestions.push({
        id: 'completeness-examples',
        category: 'completeness',
        severity: 'suggestion',
        suggestion: 'Add code examples to illustrate usage',
        explanation: 'Code examples significantly improve documentation usability',
      });
    }

    return suggestions;
  }

  /**
   * Calculate review scores
   */
  private calculateScores(
    suggestions: DocSuggestion[],
    _lineCount: number
  ): { overallScore: number; accuracyScore: number; clarityScore: number; styleScore: number } {
    const countByCategory = (category: ReviewCategory) =>
      suggestions.filter((s) => s.category === category).length;

    const countBySeverity = (severity: ReviewSeverity) =>
      suggestions.filter((s) => s.severity === severity).length;

    // Base scores
    const errorPenalty = countBySeverity('error') * 10;
    const warningPenalty = countBySeverity('warning') * 5;
    const suggestionPenalty = countBySeverity('suggestion') * 2;

    const baseScore = Math.max(0, 100 - errorPenalty - warningPenalty - suggestionPenalty);

    // Category scores
    const accuracyIssues = countByCategory('accuracy') + countByCategory('outdated');
    const clarityIssues = countByCategory('clarity') + countByCategory('grammar');
    const styleIssues = countByCategory('style') + countByCategory('completeness');

    const accuracyScore = Math.max(0, 100 - accuracyIssues * 15);
    const clarityScore = Math.max(0, 100 - clarityIssues * 10);
    const styleScore = Math.max(0, 100 - styleIssues * 8);

    const overallScore = Math.round(
      baseScore * 0.4 + accuracyScore * 0.25 + clarityScore * 0.2 + styleScore * 0.15
    );

    return { overallScore, accuracyScore, clarityScore, styleScore };
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    suggestions: DocSuggestion[],
    scores: { overallScore: number; accuracyScore: number; clarityScore: number; styleScore: number }
  ): string {
    const errorCount = suggestions.filter((s) => s.severity === 'error').length;
    const warningCount = suggestions.filter((s) => s.severity === 'warning').length;

    let summary = `Review complete with score ${scores.overallScore}/100. `;

    if (errorCount > 0) {
      summary += `Found ${errorCount} error${errorCount > 1 ? 's' : ''} that should be fixed. `;
    }

    if (warningCount > 0) {
      summary += `Found ${warningCount} warning${warningCount > 1 ? 's' : ''} to review. `;
    }

    if (scores.accuracyScore < 70) {
      summary += 'Accuracy needs attention - verify code references. ';
    }

    if (scores.clarityScore < 70) {
      summary += 'Consider simplifying language for clarity. ';
    }

    if (suggestions.length === 0) {
      summary = 'Documentation looks great! No issues found.';
    }

    return summary.trim();
  }
}

export const docReviewService = new DocReviewService();
