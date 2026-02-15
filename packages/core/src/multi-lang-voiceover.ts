// ============================================================================
// Types
// ============================================================================

export interface VoiceConfig {
  language: string;
  languageCode: string;
  voiceName: string;
  gender: 'male' | 'female' | 'neutral';
  speed: number;
  pitch: number;
}

export interface VoiceoverScript {
  language: string;
  segments: VoiceoverSegment[];
  totalWordCount: number;
  estimatedDurationMs: number;
  pronunciationHints: PronunciationHint[];
  generatedAt: string;
}

export interface VoiceoverSegment {
  type: 'spoken' | 'code' | 'pause';
  text: string;
  language: string;
  durationMs: number;
}

export interface PronunciationHint {
  term: string;
  phonetic: string;
  keepOriginal: boolean;
}

// ============================================================================
// Voice presets
// ============================================================================

export const SUPPORTED_VOICES: ReadonlyArray<VoiceConfig> = [
  {
    language: 'English',
    languageCode: 'en-US',
    voiceName: 'en-US-Neural',
    gender: 'neutral',
    speed: 1.0,
    pitch: 0,
  },
  {
    language: 'English (UK)',
    languageCode: 'en-GB',
    voiceName: 'en-GB-Neural',
    gender: 'neutral',
    speed: 1.0,
    pitch: 0,
  },
  {
    language: 'Spanish',
    languageCode: 'es-ES',
    voiceName: 'es-ES-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'French',
    languageCode: 'fr-FR',
    voiceName: 'fr-FR-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'German',
    languageCode: 'de-DE',
    voiceName: 'de-DE-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Italian',
    languageCode: 'it-IT',
    voiceName: 'it-IT-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Portuguese',
    languageCode: 'pt-BR',
    voiceName: 'pt-BR-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Japanese',
    languageCode: 'ja-JP',
    voiceName: 'ja-JP-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Korean',
    languageCode: 'ko-KR',
    voiceName: 'ko-KR-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Chinese (Mandarin)',
    languageCode: 'zh-CN',
    voiceName: 'zh-CN-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Chinese (Cantonese)',
    languageCode: 'zh-HK',
    voiceName: 'zh-HK-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Arabic',
    languageCode: 'ar-SA',
    voiceName: 'ar-SA-Neural',
    gender: 'male',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Hindi',
    languageCode: 'hi-IN',
    voiceName: 'hi-IN-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Russian',
    languageCode: 'ru-RU',
    voiceName: 'ru-RU-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Dutch',
    languageCode: 'nl-NL',
    voiceName: 'nl-NL-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Polish',
    languageCode: 'pl-PL',
    voiceName: 'pl-PL-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Swedish',
    languageCode: 'sv-SE',
    voiceName: 'sv-SE-Neural',
    gender: 'female',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Turkish',
    languageCode: 'tr-TR',
    voiceName: 'tr-TR-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Vietnamese',
    languageCode: 'vi-VN',
    voiceName: 'vi-VN-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Thai',
    languageCode: 'th-TH',
    voiceName: 'th-TH-Neural',
    gender: 'female',
    speed: 0.9,
    pitch: 0,
  },
  {
    language: 'Indonesian',
    languageCode: 'id-ID',
    voiceName: 'id-ID-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
  {
    language: 'Czech',
    languageCode: 'cs-CZ',
    voiceName: 'cs-CZ-Neural',
    gender: 'male',
    speed: 0.95,
    pitch: 0,
  },
] as const;

// ============================================================================
// Constants
// ============================================================================

const AVG_WORDS_PER_MINUTE = 150;
const MS_PER_MINUTE = 60_000;
const CODE_BLOCK_PAUSE_MS = 2_000;
const PARAGRAPH_PAUSE_MS = 500;

const TECHNICAL_TERMS: ReadonlyArray<PronunciationHint> = [
  { term: 'API', phonetic: 'A P I', keepOriginal: true },
  { term: 'URL', phonetic: 'U R L', keepOriginal: true },
  { term: 'HTML', phonetic: 'H T M L', keepOriginal: true },
  { term: 'CSS', phonetic: 'C S S', keepOriginal: true },
  { term: 'JSON', phonetic: 'jayson', keepOriginal: true },
  { term: 'SQL', phonetic: 'S Q L', keepOriginal: true },
  { term: 'REST', phonetic: 'rest', keepOriginal: true },
  { term: 'GraphQL', phonetic: 'graph Q L', keepOriginal: true },
  { term: 'npm', phonetic: 'N P M', keepOriginal: true },
  { term: 'CLI', phonetic: 'C L I', keepOriginal: true },
  { term: 'SDK', phonetic: 'S D K', keepOriginal: true },
  { term: 'IDE', phonetic: 'I D E', keepOriginal: true },
  { term: 'YAML', phonetic: 'yamel', keepOriginal: true },
  { term: 'TOML', phonetic: 'tom-el', keepOriginal: true },
  { term: 'async', phonetic: 'ay-sink', keepOriginal: true },
  { term: 'stdin', phonetic: 'standard in', keepOriginal: true },
  { term: 'stdout', phonetic: 'standard out', keepOriginal: true },
  { term: 'kubectl', phonetic: 'kube-control', keepOriginal: true },
  { term: 'nginx', phonetic: 'engine-x', keepOriginal: true },
  { term: 'regex', phonetic: 'reg-ex', keepOriginal: true },
];

// ============================================================================
// Helpers
// ============================================================================

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function wordsToMs(wordCount: number, speed: number): number {
  return Math.round((wordCount / (AVG_WORDS_PER_MINUTE * speed)) * MS_PER_MINUTE);
}

function detectCodeBlocks(text: string): { before: string; code: string; after: string }[] {
  const parts: { before: string; code: string; after: string }[] = [];
  const regex = /```[\w]*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    parts.push({ before, code: match[1]!.trim(), after: '' });
    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) {
    return [{ before: text, code: '', after: '' }];
  }

  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    parts[parts.length - 1]!.after = remaining;
  }

  return parts;
}

function findPronunciationHints(text: string): PronunciationHint[] {
  const found: PronunciationHint[] = [];
  const seen = new Set<string>();

  for (const hint of TECHNICAL_TERMS) {
    const regex = new RegExp(`\\b${hint.term}\\b`, 'i');
    if (regex.test(text) && !seen.has(hint.term.toLowerCase())) {
      found.push(hint);
      seen.add(hint.term.toLowerCase());
    }
  }

  return found;
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Get voice configuration for a language code.
 */
export function getVoiceConfig(languageCode: string): VoiceConfig | undefined {
  return SUPPORTED_VOICES.find(
    (v) => v.languageCode === languageCode || v.languageCode.startsWith(languageCode.split('-')[0]!)
  );
}

/**
 * Generate a voiceover script with language-specific pronunciation hints.
 */
export function generateVoiceoverScript(text: string, languageCode: string): VoiceoverScript {
  const voice = getVoiceConfig(languageCode);
  const speed = voice?.speed ?? 1.0;
  const lang = voice?.language ?? languageCode;
  const codeParts = detectCodeBlocks(text);
  const segments: VoiceoverSegment[] = [];
  let totalWords = 0;
  let totalDurationMs = 0;

  for (const part of codeParts) {
    if (part.before.trim()) {
      const words = countWords(part.before);
      const durationMs = wordsToMs(words, speed);
      segments.push({
        type: 'spoken',
        text: part.before.trim(),
        language: languageCode,
        durationMs,
      });
      totalWords += words;
      totalDurationMs += durationMs;
    }

    if (part.code) {
      segments.push({
        type: 'code',
        text: part.code,
        language: 'en-US',
        durationMs: CODE_BLOCK_PAUSE_MS,
      });
      totalDurationMs += CODE_BLOCK_PAUSE_MS;

      segments.push({
        type: 'pause',
        text: '',
        language: languageCode,
        durationMs: PARAGRAPH_PAUSE_MS,
      });
      totalDurationMs += PARAGRAPH_PAUSE_MS;
    }

    if (part.after.trim()) {
      const words = countWords(part.after);
      const durationMs = wordsToMs(words, speed);
      segments.push({
        type: 'spoken',
        text: part.after.trim(),
        language: languageCode,
        durationMs,
      });
      totalWords += words;
      totalDurationMs += durationMs;
    }
  }

  const pronunciationHints = findPronunciationHints(text);

  return {
    language: lang,
    segments,
    totalWordCount: totalWords,
    estimatedDurationMs: totalDurationMs,
    pronunciationHints,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Estimate total voiceover duration for a given language.
 */
export function estimateVoiceoverDuration(text: string, languageCode: string): number {
  const script = generateVoiceoverScript(text, languageCode);
  return script.estimatedDurationMs;
}
