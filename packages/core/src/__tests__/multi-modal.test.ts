import { describe, it, expect } from 'vitest';
import {
  generateAudioScript,
  estimateAudioDuration,
  generateChapterMarkers,
  generateAudioMetadata,
  generatePodcastSummary,
} from '../audio-summary.js';
import {
  generateAltText,
  generateCaptions,
  checkWCAGCompliance,
  checkColorContrast,
  generateScreenReaderSummary,
  scoreAccessibility,
} from '../accessibility.js';
import {
  getVoiceConfig,
  generateVoiceoverScript,
  estimateVoiceoverDuration,
  SUPPORTED_VOICES,
} from '../multi-lang-voiceover.js';

// ============================================================================
// Audio Summary
// ============================================================================

describe('audio-summary', () => {
  const sampleMarkdown = [
    '# Getting Started',
    '',
    'This is the introduction to our API documentation.',
    '',
    '## Installation',
    '',
    'Run `npm install` to get started. Then configure your environment.',
    '',
    '## Usage',
    '',
    'Import the module and call the main function.',
  ].join('\n');

  describe('generateAudioScript', () => {
    it('should generate a script with sections from markdown', () => {
      const script = generateAudioScript('Test Doc', sampleMarkdown);
      expect(script.title).toBe('Test Doc');
      expect(script.sections.length).toBeGreaterThan(0);
      expect(script.totalWordCount).toBeGreaterThan(0);
      expect(script.estimatedDurationMs).toBeGreaterThan(0);
      expect(script.language).toBe('en');
      expect(script.format).toBe('mp3');
    });

    it('should respect custom options', () => {
      const script = generateAudioScript('Test', sampleMarkdown, {
        language: 'es',
        format: 'ogg',
        speakingRate: 1.5,
      });
      expect(script.language).toBe('es');
      expect(script.format).toBe('ogg');
    });

    it('should split sections by headings', () => {
      const script = generateAudioScript('Test', sampleMarkdown);
      const headings = script.sections.map((s) => s.heading);
      expect(headings).toContain('Getting Started');
      expect(headings).toContain('Installation');
      expect(headings).toContain('Usage');
    });
  });

  describe('estimateAudioDuration', () => {
    it('should return positive duration for non-empty text', () => {
      const duration = estimateAudioDuration('This is a short sentence.');
      expect(duration).toBeGreaterThan(0);
    });

    it('should return shorter duration with faster speaking rate', () => {
      const normal = estimateAudioDuration('A sentence with several words in it.', 1.0);
      const fast = estimateAudioDuration('A sentence with several words in it.', 2.0);
      expect(fast).toBeLessThan(normal);
    });
  });

  describe('generateChapterMarkers', () => {
    it('should generate markers for each section', () => {
      const script = generateAudioScript('Test', sampleMarkdown);
      const markers = generateChapterMarkers(script);
      expect(markers.length).toBe(script.sections.length);
      expect(markers[0].startMs).toBe(0);
      expect(markers[0].index).toBe(0);
    });

    it('should have sequential non-overlapping markers', () => {
      const script = generateAudioScript('Test', sampleMarkdown);
      const markers = generateChapterMarkers(script);
      for (let i = 1; i < markers.length; i++) {
        expect(markers[i].startMs).toBeGreaterThanOrEqual(markers[i - 1].endMs);
      }
    });
  });

  describe('generateAudioMetadata', () => {
    it('should return correct metadata', () => {
      const script = generateAudioScript('Test', sampleMarkdown);
      const meta = generateAudioMetadata(script);
      expect(meta.wordCount).toBe(script.totalWordCount);
      expect(meta.sectionCount).toBe(script.sections.length);
      expect(meta.format).toBe('mp3');
    });
  });

  describe('generatePodcastSummary', () => {
    it('should generate a podcast-style script', () => {
      const script = generatePodcastSummary('v1.0.0', '- Added new feature\n- Fixed bug');
      expect(script.title).toBe('v1.0.0');
      expect(script.sections.length).toBeGreaterThan(0);
      expect(script.totalWordCount).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Accessibility
// ============================================================================

describe('accessibility', () => {
  describe('generateAltText', () => {
    it('should generate alt text for a diagram', () => {
      const result = generateAltText('user authentication flow', 'diagram');
      expect(result.altText).toContain('Diagram showing');
      expect(result.altText).toContain('user authentication flow');
      expect(result.contentType).toBe('diagram');
    });

    it('should handle empty descriptions', () => {
      const result = generateAltText('');
      expect(result.altText).toBe('Decorative image');
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should set appropriate content type prefix', () => {
      expect(generateAltText('data', 'chart').altText).toContain('Chart displaying');
      expect(generateAltText('page', 'screenshot').altText).toContain('Screenshot of');
      expect(generateAltText('menu', 'icon').altText).toContain('Icon representing');
    });
  });

  describe('generateCaptions', () => {
    const entries = [
      { index: 1, startMs: 0, endMs: 5000, text: 'Hello world' },
      { index: 2, startMs: 5000, endMs: 10000, text: 'Second caption' },
    ];

    it('should generate VTT format by default', () => {
      const vtt = generateCaptions(entries, 'vtt');
      expect(vtt).toContain('WEBVTT');
      expect(vtt).toContain('00:00:00.000 --> 00:00:05.000');
      expect(vtt).toContain('Hello world');
    });

    it('should generate SRT format', () => {
      const srt = generateCaptions(entries, 'srt');
      expect(srt).not.toContain('WEBVTT');
      expect(srt).toContain('00:00:00,000 --> 00:00:05,000');
    });

    it('should handle empty entries', () => {
      expect(generateCaptions([], 'vtt')).toBe('WEBVTT\n');
      expect(generateCaptions([], 'srt')).toBe('');
    });
  });

  describe('checkColorContrast', () => {
    it('should pass AA for black on white', () => {
      const result = checkColorContrast('#000000', '#ffffff');
      expect(result.passesAA).toBe(true);
      expect(result.passesAAA).toBe(true);
      expect(result.ratio).toBeGreaterThan(7);
    });

    it('should fail for low contrast colors', () => {
      const result = checkColorContrast('#cccccc', '#ffffff');
      expect(result.passesAA).toBe(false);
    });

    it('should handle invalid colors', () => {
      const result = checkColorContrast('invalid', '#fff');
      expect(result.ratio).toBe(0);
      expect(result.passesAA).toBe(false);
    });
  });

  describe('checkWCAGCompliance', () => {
    it('should detect missing alt text on images', () => {
      const html = '<html lang="en"><body><img src="test.png"></body></html>';
      const result = checkWCAGCompliance(html);
      expect(result.issues.some((i) => i.rule === 'img-alt')).toBe(true);
    });

    it('should pass for well-formed HTML', () => {
      const html =
        '<html lang="en"><body><img src="test.png" alt="A test image"><h1>Title</h1><h2>Sub</h2></body></html>';
      const result = checkWCAGCompliance(html);
      expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
      expect(result.score).toBeGreaterThan(80);
    });

    it('should detect heading hierarchy issues', () => {
      const html = '<html lang="en"><h1>Title</h1><h3>Skipped</h3>';
      const result = checkWCAGCompliance(html);
      expect(result.issues.some((i) => i.rule === 'heading-order')).toBe(true);
    });

    it('should detect missing lang attribute', () => {
      const html = '<html><body>Content</body></html>';
      const result = checkWCAGCompliance(html);
      expect(result.issues.some((i) => i.rule === 'html-lang')).toBe(true);
    });
  });

  describe('generateScreenReaderSummary', () => {
    it('should summarize complex content', () => {
      const content = '<table><tr><td>data</td></tr></table><img src="x"><img src="y">';
      const summary = generateScreenReaderSummary(content);
      expect(summary).toContain('1 table(s)');
      expect(summary).toContain('2 image(s)');
    });

    it('should handle plain text', () => {
      const summary = generateScreenReaderSummary('Just plain text.');
      expect(summary).toContain('text content');
    });
  });

  describe('scoreAccessibility', () => {
    it('should return a numeric score', () => {
      const score = scoreAccessibility('<html lang="en"><body>Clean</body></html>');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should give lower score for accessibility issues', () => {
      const good = scoreAccessibility('<html lang="en"><body><img alt="ok" src="x"></body></html>');
      const bad = scoreAccessibility('<html><body><img src="x"><img src="y"></body></html>');
      expect(good).toBeGreaterThan(bad);
    });
  });
});

// ============================================================================
// Multi-language Voiceover
// ============================================================================

describe('multi-lang-voiceover', () => {
  describe('SUPPORTED_VOICES', () => {
    it('should have at least 20 voice configurations', () => {
      expect(SUPPORTED_VOICES.length).toBeGreaterThanOrEqual(20);
    });

    it('should have unique language codes', () => {
      const codes = SUPPORTED_VOICES.map((v) => v.languageCode);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  describe('getVoiceConfig', () => {
    it('should find voice by exact language code', () => {
      const voice = getVoiceConfig('en-US');
      expect(voice).toBeDefined();
      expect(voice!.languageCode).toBe('en-US');
    });

    it('should find voice by language prefix', () => {
      const voice = getVoiceConfig('es');
      expect(voice).toBeDefined();
      expect(voice!.languageCode).toContain('es');
    });

    it('should return undefined for unsupported language', () => {
      expect(getVoiceConfig('xx-XX')).toBeUndefined();
    });
  });

  describe('generateVoiceoverScript', () => {
    it('should generate segments from text', () => {
      const script = generateVoiceoverScript('Hello, this is a test.', 'en-US');
      expect(script.segments.length).toBeGreaterThan(0);
      expect(script.totalWordCount).toBeGreaterThan(0);
      expect(script.estimatedDurationMs).toBeGreaterThan(0);
      expect(script.language).toBe('English');
    });

    it('should detect code blocks and keep them separate', () => {
      const text = 'Install the package:\n\n```bash\nnpm install foo\n```\n\nThen use it.';
      const script = generateVoiceoverScript(text, 'en-US');
      const codeSegments = script.segments.filter((s) => s.type === 'code');
      expect(codeSegments.length).toBe(1);
      expect(codeSegments[0].language).toBe('en-US');
    });

    it('should detect pronunciation hints for technical terms', () => {
      const text = 'Use the API to send JSON data via REST endpoints.';
      const script = generateVoiceoverScript(text, 'en-US');
      expect(script.pronunciationHints.length).toBeGreaterThan(0);
      const terms = script.pronunciationHints.map((h) => h.term);
      expect(terms).toContain('API');
      expect(terms).toContain('JSON');
      expect(terms).toContain('REST');
    });
  });

  describe('estimateVoiceoverDuration', () => {
    it('should return positive duration', () => {
      const duration = estimateVoiceoverDuration('A few words to speak.', 'en-US');
      expect(duration).toBeGreaterThan(0);
    });

    it('should return different durations for different languages', () => {
      const text = 'This text has enough words to show a difference in estimated duration.';
      const enDuration = estimateVoiceoverDuration(text, 'en-US');
      const jaDuration = estimateVoiceoverDuration(text, 'ja-JP');
      // Japanese has slower speed (0.9) so duration should be longer
      expect(jaDuration).toBeGreaterThan(enDuration);
    });
  });
});
