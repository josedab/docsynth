import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger, generateId } from '@docsynth/utils';

const log = createLogger('video-generator');

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

interface VideoScript {
  id: string;
  title: string;
  description: string;
  duration: number;
  scenes: VideoScene[];
  narration: string;
  keywords: string[];
}

interface NarrationSegment {
  sceneId: string;
  text: string;
  audioUrl?: string;
  duration: number;
  timestamps?: Array<{ word: string; start: number; end: number }>;
}

interface CodeAnimation {
  sceneId: string;
  steps: Array<{
    line: number;
    action: 'highlight' | 'type' | 'fade-in' | 'zoom';
    delay: number;
    description: string;
  }>;
}

interface VideoAssets {
  narrations: NarrationSegment[];
  animations: CodeAnimation[];
  visualCues: Array<{
    sceneId: string;
    type: 'diagram' | 'screenshot' | 'annotation';
    prompt: string;
  }>;
}

export class VideoGeneratorService {
  private anthropic: Anthropic;
  private openai: OpenAI;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generateScriptFromDocument(params: {
    documentContent: string;
    documentTitle: string;
    targetAudience: string;
    targetDurationMinutes: number;
    style: 'tutorial' | 'overview' | 'deep-dive' | 'walkthrough';
    includeCode: boolean;
  }): Promise<VideoScript> {
    log.info({ title: params.documentTitle, style: params.style }, 'Generating video script');

    const targetDurationSeconds = params.targetDurationMinutes * 60;

    const prompt = `Generate a video documentation script for the following content.

Document Title: ${params.documentTitle}
Target Audience: ${params.targetAudience}
Target Duration: ${targetDurationSeconds} seconds (approximately ${params.targetDurationMinutes} minutes)
Style: ${params.style}
Include Code Examples: ${params.includeCode}

Source Documentation:
${params.documentContent.slice(0, 6000)}

Create an engaging video script that:
1. Hooks viewers in the first 10 seconds
2. Breaks down complex concepts into digestible chunks
3. Uses conversational, clear language
4. ${params.includeCode ? 'Includes practical code examples with step-by-step explanations' : 'Focuses on conceptual understanding'}
5. Ends with clear next steps or call-to-action

Generate a JSON object:
{
  "title": "Engaging video title",
  "description": "SEO-friendly description (150-200 chars)",
  "scenes": [
    {
      "order": 1,
      "type": "intro|concept|code|demo|summary",
      "title": "Scene title",
      "narration": "Complete narrator script for this scene",
      "visualInstructions": "Detailed instructions for what should appear on screen",
      "codeSnippet": "Code to display (if applicable)",
      "duration": estimated_seconds
    }
  ],
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Guidelines:
- Intro scene: 15-30 seconds, grab attention, preview what they'll learn
- Concept scenes: 30-60 seconds each, one concept per scene
- Code scenes: 45-90 seconds, explain line by line
- Demo scenes: 30-60 seconds, show practical application
- Summary: 15-30 seconds, recap and next steps

Return ONLY valid JSON.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '{}';

    let scriptData: Partial<VideoScript>;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      scriptData = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (error) {
      log.error({ error, content: content.slice(0, 500) }, 'Failed to parse script JSON');
      throw new Error('Failed to generate valid video script');
    }

    const script: VideoScript = {
      id: generateId('vscript'),
      title: scriptData.title ?? params.documentTitle,
      description: scriptData.description ?? '',
      duration: 0,
      scenes: [],
      narration: '',
      keywords: scriptData.keywords ?? [],
    };

    // Process scenes
    script.scenes = (scriptData.scenes ?? []).map((scene, index) => ({
      id: generateId('scene'),
      order: scene.order ?? index + 1,
      type: scene.type ?? 'concept',
      title: scene.title ?? `Scene ${index + 1}`,
      narration: scene.narration ?? '',
      visualInstructions: scene.visualInstructions ?? '',
      codeSnippet: scene.codeSnippet,
      duration: scene.duration ?? 30,
    }));

    // Calculate totals
    script.duration = script.scenes.reduce((sum, s) => sum + s.duration, 0);
    script.narration = script.scenes.map((s) => s.narration).join('\n\n');

    log.info(
      { scriptId: script.id, scenes: script.scenes.length, duration: script.duration },
      'Video script generated'
    );

    return script;
  }

  async generateNarrationAudio(scene: VideoScene, voice: string = 'alloy'): Promise<NarrationSegment> {
    log.info({ sceneId: scene.id, voice }, 'Generating narration audio');

    // Use OpenAI TTS for voice generation
    try {
      const audioResponse = await this.openai.audio.speech.create({
        model: 'tts-1-hd',
        voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
        input: scene.narration,
        speed: 1.0,
      });

      // In production, save audio to cloud storage and return URL
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      const estimatedDuration = Math.ceil(scene.narration.split(' ').length / 2.5);

      return {
        sceneId: scene.id,
        text: scene.narration,
        audioUrl: `data:audio/mp3;base64,${audioBuffer.toString('base64')}`,
        duration: estimatedDuration,
      };
    } catch (error) {
      log.warn({ error, sceneId: scene.id }, 'TTS failed, returning text-only narration');

      // Fallback: return text-only narration segment
      return {
        sceneId: scene.id,
        text: scene.narration,
        duration: Math.ceil(scene.narration.split(' ').length / 2.5),
      };
    }
  }

  async generateCodeAnimations(scene: VideoScene): Promise<CodeAnimation> {
    if (!scene.codeSnippet) {
      return { sceneId: scene.id, steps: [] };
    }

    log.info({ sceneId: scene.id }, 'Generating code animation');

    const prompt = `Generate step-by-step code animation instructions.

Code:
\`\`\`
${scene.codeSnippet}
\`\`\`

Narration: ${scene.narration}

Create animation steps that sync with the narration. Each step should:
1. Highlight a specific line or block
2. Time with the corresponding explanation in narration
3. Build understanding progressively

Return a JSON array:
[
  {
    "line": 1,
    "action": "highlight|type|fade-in|zoom",
    "delay": 0.5,
    "description": "Brief description of what's being explained"
  }
]

Actions:
- "type": Simulate typing the code character by character
- "highlight": Highlight the line with a glow effect
- "fade-in": Fade the line in
- "zoom": Zoom into this code section

Return ONLY the JSON array.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '[]';

    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      const steps = JSON.parse(arrayMatch ? arrayMatch[0] : content);
      return { sceneId: scene.id, steps };
    } catch {
      log.warn({ sceneId: scene.id }, 'Failed to parse animation JSON');
      return { sceneId: scene.id, steps: [] };
    }
  }

  async generateVisualCues(scenes: VideoScene[]): Promise<VideoAssets['visualCues']> {
    const cues: VideoAssets['visualCues'] = [];

    for (const scene of scenes) {
      if (scene.type === 'concept' || scene.type === 'intro') {
        // Generate diagram prompts for concept scenes
        cues.push({
          sceneId: scene.id,
          type: 'diagram',
          prompt: await this.generateDiagramPrompt(scene),
        });
      }

      if (scene.visualInstructions.includes('screenshot') || scene.visualInstructions.includes('demo')) {
        cues.push({
          sceneId: scene.id,
          type: 'screenshot',
          prompt: scene.visualInstructions,
        });
      }
    }

    return cues;
  }

  private async generateDiagramPrompt(scene: VideoScene): Promise<string> {
    const prompt = `Based on this scene, suggest a simple diagram to visualize the concept.

Scene Title: ${scene.title}
Narration: ${scene.narration}
Visual Instructions: ${scene.visualInstructions}

Provide a brief diagram description (what shapes, arrows, labels to include) suitable for a documentation video. Keep it simple and clear.

Respond with just the diagram description in one paragraph.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  async generateSubtitles(
    scenes: VideoScene[],
    format: 'srt' | 'vtt' = 'vtt'
  ): Promise<string> {
    let output = '';
    let cumulativeTime = 0;

    if (format === 'vtt') {
      output = 'WEBVTT\n\n';
    }

    let subtitleIndex = 1;

    for (const scene of scenes) {
      // Split narration into subtitle chunks (max 10 words per line)
      const words = scene.narration.split(/\s+/);
      const chunks: string[] = [];
      let currentChunk: string[] = [];

      for (const word of words) {
        currentChunk.push(word);
        if (currentChunk.length >= 10) {
          chunks.push(currentChunk.join(' '));
          currentChunk = [];
        }
      }
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
      }

      const chunkDuration = scene.duration / chunks.length;

      for (const chunk of chunks) {
        const startTime = cumulativeTime;
        const endTime = cumulativeTime + chunkDuration;

        if (format === 'srt') {
          output += `${subtitleIndex}\n`;
          output += `${this.formatTimeSRT(startTime)} --> ${this.formatTimeSRT(endTime)}\n`;
          output += `${chunk}\n\n`;
        } else {
          output += `${this.formatTimeVTT(startTime)} --> ${this.formatTimeVTT(endTime)}\n`;
          output += `${chunk}\n\n`;
        }

        cumulativeTime = endTime;
        subtitleIndex++;
      }
    }

    return output;
  }

  private formatTimeSRT(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  private formatTimeVTT(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }

  async generateVideoManifest(script: VideoScript, assets: VideoAssets): Promise<object> {
    return {
      version: '1.0',
      metadata: {
        title: script.title,
        description: script.description,
        duration: script.duration,
        keywords: script.keywords,
        generatedAt: new Date().toISOString(),
      },
      timeline: script.scenes.map((scene) => ({
        sceneId: scene.id,
        startTime: script.scenes
          .slice(0, scene.order - 1)
          .reduce((sum, s) => sum + s.duration, 0),
        duration: scene.duration,
        type: scene.type,
        title: scene.title,
        narration: assets.narrations.find((n) => n.sceneId === scene.id),
        animation: assets.animations.find((a) => a.sceneId === scene.id),
        visuals: assets.visualCues.filter((v) => v.sceneId === scene.id),
        code: scene.codeSnippet,
      })),
      rendering: {
        resolution: '1920x1080',
        fps: 30,
        format: 'mp4',
        codec: 'h264',
      },
    };
  }

  async processFullVideo(
    documentContent: string,
    documentTitle: string,
    options: {
      targetDurationMinutes: number;
      style: 'tutorial' | 'overview' | 'deep-dive' | 'walkthrough';
      includeCode: boolean;
      voice: string;
      generateAudio: boolean;
    }
  ): Promise<{ script: VideoScript; assets: VideoAssets; manifest: object; subtitles: string }> {
    // 1. Generate script
    const script = await this.generateScriptFromDocument({
      documentContent,
      documentTitle,
      targetAudience: 'developers',
      targetDurationMinutes: options.targetDurationMinutes,
      style: options.style,
      includeCode: options.includeCode,
    });

    // 2. Generate assets in parallel
    const [narrations, animations, visualCues] = await Promise.all([
      // Generate narrations (optionally with audio)
      Promise.all(
        script.scenes.map((scene) =>
          options.generateAudio
            ? this.generateNarrationAudio(scene, options.voice)
            : Promise.resolve({
                sceneId: scene.id,
                text: scene.narration,
                duration: Math.ceil(scene.narration.split(' ').length / 2.5),
              })
        )
      ),
      // Generate code animations
      Promise.all(
        script.scenes.filter((s) => s.type === 'code').map((scene) => this.generateCodeAnimations(scene))
      ),
      // Generate visual cues
      this.generateVisualCues(script.scenes),
    ]);

    const assets: VideoAssets = { narrations, animations, visualCues };

    // 3. Generate subtitles
    const subtitles = await this.generateSubtitles(script.scenes);

    // 4. Generate manifest
    const manifest = await this.generateVideoManifest(script, assets);

    log.info(
      {
        scriptId: script.id,
        scenes: script.scenes.length,
        narrations: narrations.length,
        animations: animations.length,
      },
      'Full video processing complete'
    );

    return { script, assets, manifest, subtitles };
  }
}

export const videoGenerator = new VideoGeneratorService();
