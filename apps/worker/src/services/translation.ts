import { createLogger } from '@docsynth/utils';
import type { SupportedLocale } from '@docsynth/types';

const log = createLogger('translation-service');

interface TranslationInput {
  content: string;
  sourceLocale: string;
  targetLocale: string;
  glossary?: Map<string, string>;
  preserveFormatting: boolean;
}

interface TranslationResult {
  content: string;
  wordCount: number;
  glossaryTermsUsed: string[];
  confidence: number;
}

interface GlossaryMatch {
  term: string;
  translation: string;
  position: number;
}

// Locale display names
const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
};

class TranslationService {
  /**
   * Translate documentation content
   * Note: In production, this would integrate with a translation API (DeepL, Google Translate, etc.)
   */
  async translate(input: TranslationInput): Promise<TranslationResult> {
    const { content, sourceLocale, targetLocale, glossary, preserveFormatting } = input;

    log.info({ sourceLocale, targetLocale, contentLength: content.length }, 'Starting translation');

    // Parse content to preserve formatting
    const { blocks, metadata } = this.parseContent(content, preserveFormatting);

    // Find and protect glossary terms
    const glossaryMatches: GlossaryMatch[] = [];
    if (glossary && glossary.size > 0) {
      for (const [term, translation] of glossary) {
        const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'gi');
        let match;
        while ((match = regex.exec(content)) !== null) {
          glossaryMatches.push({
            term,
            translation,
            position: match.index,
          });
        }
      }
    }

    // Translate each text block
    const translatedBlocks: string[] = [];
    for (const block of blocks) {
      if (block.type === 'code' || block.type === 'protected') {
        // Don't translate code blocks or protected content
        translatedBlocks.push(block.content);
      } else {
        const translated = await this.translateBlock(
          block.content,
          sourceLocale,
          targetLocale,
          glossaryMatches.map((m) => ({ term: m.term, translation: m.translation }))
        );
        translatedBlocks.push(translated);
      }
    }

    // Reconstruct content
    const translatedContent = this.reconstructContent(translatedBlocks, metadata, preserveFormatting);

    // Calculate metrics
    const wordCount = content.split(/\s+/).filter((w) => w.length > 0).length;
    const glossaryTermsUsed = [...new Set(glossaryMatches.map((m) => m.term))];
    const confidence = this.calculateConfidence(content, translatedContent, glossaryTermsUsed.length);

    return {
      content: translatedContent,
      wordCount,
      glossaryTermsUsed,
      confidence,
    };
  }

  /**
   * Parse content into translatable blocks
   */
  private parseContent(
    content: string,
    preserveFormatting: boolean
  ): { blocks: Array<{ type: string; content: string }>; metadata: Record<string, unknown> } {
    const blocks: Array<{ type: string; content: string }> = [];
    const lines = content.split('\n');
    let currentBlock = '';
    let inCodeBlock = false;

    for (const line of lines) {
      // Code block detection
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          blocks.push({ type: 'code', content: currentBlock + line + '\n' });
          currentBlock = '';
          inCodeBlock = false;
        } else {
          // Start code block - save current text block first
          if (currentBlock.trim()) {
            blocks.push({ type: 'text', content: currentBlock });
          }
          currentBlock = line + '\n';
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        currentBlock += line + '\n';
        continue;
      }

      // Inline code (protect from translation)
      if (preserveFormatting && line.includes('`')) {
        // Split line by inline code
        const parts = line.split(/(`[^`]+`)/);
        let processedLine = '';
        for (const part of parts) {
          if (part.startsWith('`') && part.endsWith('`')) {
            processedLine += part; // Keep inline code as-is
          } else {
            processedLine += part;
          }
        }
        currentBlock += processedLine + '\n';
      } else {
        currentBlock += line + '\n';
      }
    }

    // Add remaining content
    if (currentBlock.trim()) {
      blocks.push({ type: inCodeBlock ? 'code' : 'text', content: currentBlock });
    }

    return { blocks, metadata: {} };
  }

  /**
   * Translate a single block of text
   * Note: In production, this would call an actual translation API
   */
  private async translateBlock(
    text: string,
    sourceLocale: string,
    targetLocale: string,
    glossary: Array<{ term: string; translation: string }>
  ): Promise<string> {
    // Protect inline code
    const inlineCodePattern = /`[^`]+`/g;
    const inlineCodes: string[] = [];
    let protectedText = text.replace(inlineCodePattern, (match) => {
      inlineCodes.push(match);
      return `__CODE_${inlineCodes.length - 1}__`;
    });

    // Apply glossary terms
    for (const { term, translation } of glossary) {
      const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'gi');
      protectedText = protectedText.replace(regex, translation);
    }

    // Simulate translation (in production, call translation API)
    // For now, we'll add markers to show it would be translated
    let translated = protectedText;

    // In production, you would do:
    // translated = await this.callTranslationAPI(protectedText, sourceLocale, targetLocale);

    // For development/testing, we'll mark the content
    if (sourceLocale !== targetLocale) {
      // Add locale marker for testing purposes
      const localeName = LOCALE_NAMES[targetLocale] || targetLocale;
      translated = `[${localeName}] ${protectedText}`;
    }

    // Restore inline code
    translated = translated.replace(/__CODE_(\d+)__/g, (_, idx) => inlineCodes[parseInt(idx, 10)]!);

    return translated;
  }

  /**
   * Reconstruct content from translated blocks
   */
  private reconstructContent(
    blocks: string[],
    _metadata: Record<string, unknown>,
    _preserveFormatting: boolean
  ): string {
    return blocks.join('');
  }

  /**
   * Calculate translation confidence score
   */
  private calculateConfidence(
    original: string,
    translated: string,
    glossaryTermsUsed: number
  ): number {
    // Base confidence
    let confidence = 0.8;

    // Boost for glossary usage
    if (glossaryTermsUsed > 0) {
      confidence += Math.min(0.1, glossaryTermsUsed * 0.02);
    }

    // Penalize if lengths are very different (might indicate translation issues)
    const lengthRatio = translated.length / original.length;
    if (lengthRatio < 0.5 || lengthRatio > 2) {
      confidence -= 0.1;
    }

    // Check for preserved formatting
    const originalCodeBlocks = (original.match(/```/g) || []).length;
    const translatedCodeBlocks = (translated.match(/```/g) || []).length;
    if (originalCodeBlocks !== translatedCodeBlocks) {
      confidence -= 0.2;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Detect source locale from content
   */
  detectLocale(content: string): SupportedLocale {
    // Simple heuristic - in production, use a language detection library
    const sample = content.substring(0, 500).toLowerCase();

    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return 'ja';
    if (/[\uac00-\ud7a3]/.test(sample)) return 'ko';
    if (/[\u4e00-\u9fff]/.test(sample)) {
      return sample.includes('的') ? 'zh-CN' : 'zh-TW';
    }
    if (/[\u0400-\u04ff]/.test(sample)) return 'ru';
    if (/[\u0600-\u06ff]/.test(sample)) return 'ar';
    if (/[\u0900-\u097f]/.test(sample)) return 'hi';
    if (/[\u0e00-\u0e7f]/.test(sample)) return 'th';

    // Check for common words in European languages
    if (/\b(der|die|das|und|ist)\b/i.test(sample)) return 'de';
    if (/\b(le|la|les|et|est|dans)\b/i.test(sample)) return 'fr';
    if (/\b(el|la|los|las|es|en|de)\b/i.test(sample)) return 'es';
    if (/\b(il|la|gli|le|è|in|di)\b/i.test(sample)) return 'it';
    if (/\b(o|a|os|as|é|em|de)\b/i.test(sample)) return 'pt';
    if (/\b(het|de|een|en|is|van)\b/i.test(sample)) return 'nl';

    return 'en'; // Default to English
  }

  /**
   * Get locale display name
   */
  getLocaleName(locale: string): string {
    return LOCALE_NAMES[locale] || locale;
  }
}

export const translationService = new TranslationService();
