// ============================================================================
// Types
// ============================================================================

export type AudioFormat = 'mp3' | 'ogg' | 'wav';

export interface AudioScript {
  title: string;
  sections: AudioSection[];
  totalWordCount: number;
  estimatedDurationMs: number;
  language: string;
  format: AudioFormat;
  generatedAt: string;
}

export interface AudioSection {
  heading: string;
  spokenText: string;
  wordCount: number;
  estimatedDurationMs: number;
}

export interface ChapterMarker {
  title: string;
  startMs: number;
  endMs: number;
  index: number;
}

export interface TTSProvider {
  name: 'elevenlabs' | 'azure' | 'google';
  voiceId: string;
  language: string;
  speakingRate: number;
  pitch: number;
}

export interface AudioMetadata {
  estimatedDurationMs: number;
  wordCount: number;
  language: string;
  sectionCount: number;
  format: AudioFormat;
}

// ============================================================================
// Constants
// ============================================================================

const AVG_WORDS_PER_MINUTE = 150;
const MS_PER_MINUTE = 60_000;
const SECTION_PAUSE_MS = 1_500;

// ============================================================================
// Helpers
// ============================================================================

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function wordsToMs(wordCount: number, rate: number = 1.0): number {
  return Math.round((wordCount / (AVG_WORDS_PER_MINUTE * rate)) * MS_PER_MINUTE);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '(code block omitted)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '(image omitted)')
    .replace(/\|[^\n]+\|/g, '(table content)')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoSections(text: string): { heading: string; body: string }[] {
  const lines = text.split('\n');
  const sections: { heading: string; body: string }[] = [];
  let currentHeading = 'Introduction';
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      if (currentBody.length > 0) {
        sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
      }
      currentHeading = headingMatch[1]!;
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentBody.length > 0 || sections.length === 0) {
    sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
  }

  return sections.filter((s) => s.body.length > 0);
}

function toSpokenText(text: string): string {
  let spoken = stripMarkdown(text);
  spoken = spoken.replace(/\be\.g\./g, 'for example');
  spoken = spoken.replace(/\bi\.e\./g, 'that is');
  spoken = spoken.replace(/\betc\./g, 'and so on');
  spoken = spoken.replace(/\bvs\./g, 'versus');
  spoken = spoken.replace(/\bAPI\b/g, 'A P I');
  spoken = spoken.replace(/\bURL\b/g, 'U R L');
  spoken = spoken.replace(/\bHTML\b/g, 'H T M L');
  spoken = spoken.replace(/\bCSS\b/g, 'C S S');
  spoken = spoken.replace(/\bJSON\b/g, 'JSON');
  return spoken;
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Generate an audio-optimized script from documentation text.
 */
export function generateAudioScript(
  title: string,
  markdownText: string,
  options: { language?: string; format?: AudioFormat; speakingRate?: number } = {}
): AudioScript {
  const language = options.language ?? 'en';
  const format = options.format ?? 'mp3';
  const rate = options.speakingRate ?? 1.0;

  const rawSections = splitIntoSections(markdownText);
  const sections: AudioSection[] = rawSections.map((s) => {
    const spokenText = toSpokenText(s.body);
    const wordCount = countWords(spokenText);
    return {
      heading: s.heading,
      spokenText,
      wordCount,
      estimatedDurationMs: wordsToMs(wordCount, rate),
    };
  });

  const totalWordCount = sections.reduce((sum, s) => sum + s.wordCount, 0);
  const sectionDuration = sections.reduce((sum, s) => sum + s.estimatedDurationMs, 0);
  const pauseDuration = Math.max(0, sections.length - 1) * SECTION_PAUSE_MS;

  return {
    title,
    sections,
    totalWordCount,
    estimatedDurationMs: sectionDuration + pauseDuration,
    language,
    format,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Estimate audio duration in milliseconds from text.
 */
export function estimateAudioDuration(text: string, speakingRate: number = 1.0): number {
  const words = countWords(stripMarkdown(text));
  return wordsToMs(words, speakingRate);
}

/**
 * Generate chapter markers for an audio script.
 */
export function generateChapterMarkers(script: AudioScript): ChapterMarker[] {
  const markers: ChapterMarker[] = [];
  let currentMs = 0;

  for (let i = 0; i < script.sections.length; i++) {
    const section = script.sections[i]!;
    markers.push({
      title: section.heading,
      startMs: currentMs,
      endMs: currentMs + section.estimatedDurationMs,
      index: i,
    });
    currentMs += section.estimatedDurationMs + SECTION_PAUSE_MS;
  }

  return markers;
}

/**
 * Generate audio metadata for a script.
 */
export function generateAudioMetadata(script: AudioScript): AudioMetadata {
  return {
    estimatedDurationMs: script.estimatedDurationMs,
    wordCount: script.totalWordCount,
    language: script.language,
    sectionCount: script.sections.length,
    format: script.format,
  };
}

/**
 * Generate a podcast-style summary from changelog or release notes.
 */
export function generatePodcastSummary(
  releaseTitle: string,
  changelog: string,
  options: { language?: string; format?: AudioFormat } = {}
): AudioScript {
  const intro = `Welcome to the release summary for ${releaseTitle}. Here's what's new.`;
  const spoken = toSpokenText(changelog);
  const outro = `That's all for ${releaseTitle}. Thanks for listening.`;
  const fullText = `# ${releaseTitle}\n\n${intro}\n\n${spoken}\n\n# Closing\n\n${outro}`;

  return generateAudioScript(releaseTitle, fullText, options);
}
