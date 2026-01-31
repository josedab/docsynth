import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';

const log = createLogger('diagram-generator-service');

export type DiagramType = 
  | 'sequence'
  | 'flowchart'
  | 'class'
  | 'entity-relationship'
  | 'state'
  | 'architecture';

export interface DiagramResult {
  type: DiagramType;
  title: string;
  mermaidCode: string;
  description: string;
}

export class DiagramGeneratorService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async generateArchitectureDiagram(
    files: { path: string; content: string }[],
    projectName: string
  ): Promise<DiagramResult> {
    log.info({ fileCount: files.length }, 'Generating architecture diagram');

    const fileStructure = files
      .map((f) => {
        const imports = this.extractImports(f.content);
        const exports = this.extractExports(f.content);
        return `File: ${f.path}\nImports: ${imports.join(', ')}\nExports: ${exports.join(', ')}`;
      })
      .join('\n\n');

    const prompt = this.buildArchitecturePrompt(fileStructure, projectName);
    return this.runGeneration(prompt, 'architecture');
  }

  async generateSequenceDiagram(
    functionCode: string,
    functionName: string
  ): Promise<DiagramResult> {
    log.info({ functionName }, 'Generating sequence diagram');

    const prompt = this.buildSequencePrompt(functionCode, functionName);
    return this.runGeneration(prompt, 'sequence');
  }

  async generateClassDiagram(
    classCode: string[],
    moduleName: string
  ): Promise<DiagramResult> {
    log.info({ classCount: classCode.length }, 'Generating class diagram');

    const prompt = this.buildClassPrompt(classCode.join('\n\n'), moduleName);
    return this.runGeneration(prompt, 'class');
  }

  async generateFlowchart(
    processDescription: string,
    processName: string
  ): Promise<DiagramResult> {
    log.info({ processName }, 'Generating flowchart');

    const prompt = this.buildFlowchartPrompt(processDescription, processName);
    return this.runGeneration(prompt, 'flowchart');
  }

  async generateERDiagram(
    schemaCode: string,
    databaseName: string
  ): Promise<DiagramResult> {
    log.info({ databaseName }, 'Generating ER diagram');

    const prompt = this.buildERPrompt(schemaCode, databaseName);
    return this.runGeneration(prompt, 'entity-relationship');
  }

  private buildArchitecturePrompt(fileStructure: string, projectName: string): string {
    return `Analyze the following project structure and generate a Mermaid architecture/flowchart diagram.

## Project: ${projectName}

## File Structure and Dependencies
${fileStructure}

---

Create a Mermaid flowchart diagram showing:
1. Main components/modules
2. How they relate to each other
3. Data flow between components

Return a JSON object:
{
  "title": "Architecture diagram title",
  "mermaidCode": "flowchart TD\\n  ...",
  "description": "Brief description of the architecture"
}

Use flowchart TD (top-down) or LR (left-right) format. Use subgraphs to group related components.
Return ONLY the JSON object:`;
  }

  private buildSequencePrompt(functionCode: string, functionName: string): string {
    return `Analyze the following function and generate a Mermaid sequence diagram.

## Function: ${functionName}
\`\`\`typescript
${functionCode}
\`\`\`

---

Create a Mermaid sequence diagram showing:
1. Participants (caller, services, databases, etc.)
2. Method calls and their order
3. Return values
4. Any async operations or loops

Return a JSON object:
{
  "title": "Sequence diagram title",
  "mermaidCode": "sequenceDiagram\\n  ...",
  "description": "Brief description of the flow"
}

Return ONLY the JSON object:`;
  }

  private buildClassPrompt(classCode: string, moduleName: string): string {
    return `Analyze the following classes/interfaces and generate a Mermaid class diagram.

## Module: ${moduleName}
\`\`\`typescript
${classCode}
\`\`\`

---

Create a Mermaid class diagram showing:
1. Classes and interfaces
2. Properties and methods
3. Inheritance and implementation relationships
4. Associations between classes

Return a JSON object:
{
  "title": "Class diagram title",
  "mermaidCode": "classDiagram\\n  ...",
  "description": "Brief description of the class structure"
}

Return ONLY the JSON object:`;
  }

  private buildFlowchartPrompt(processDescription: string, processName: string): string {
    return `Create a Mermaid flowchart for the following process.

## Process: ${processName}
${processDescription}

---

Create a Mermaid flowchart showing:
1. Start and end points
2. Decision points
3. Process steps
4. Flow direction

Return a JSON object:
{
  "title": "Flowchart title",
  "mermaidCode": "flowchart TD\\n  ...",
  "description": "Brief description of the process"
}

Return ONLY the JSON object:`;
  }

  private buildERPrompt(schemaCode: string, databaseName: string): string {
    return `Analyze the following database schema and generate a Mermaid ER diagram.

## Database: ${databaseName}
\`\`\`
${schemaCode}
\`\`\`

---

Create a Mermaid ER diagram showing:
1. Entities (tables)
2. Attributes (columns)
3. Relationships (one-to-one, one-to-many, many-to-many)
4. Primary and foreign keys

Return a JSON object:
{
  "title": "ER diagram title",
  "mermaidCode": "erDiagram\\n  ...",
  "description": "Brief description of the data model"
}

Return ONLY the JSON object:`;
  }

  private async runGeneration(prompt: string, type: DiagramType): Promise<DiagramResult> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return this.parseResponse(text, type);
      } catch (error) {
        log.warn({ error }, 'Anthropic generation failed');
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message?.content ?? '';
        return this.parseResponse(text, type);
      } catch (error) {
        log.warn({ error }, 'OpenAI generation failed');
      }
    }

    return this.getDefaultDiagram(type);
  }

  private parseResponse(text: string, type: DiagramType): DiagramResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type,
          title: parsed.title ?? `${type} Diagram`,
          mermaidCode: parsed.mermaidCode ?? '',
          description: parsed.description ?? '',
        };
      }
    } catch (error) {
      log.warn({ error }, 'Failed to parse diagram response');
    }

    return this.getDefaultDiagram(type);
  }

  private getDefaultDiagram(type: DiagramType): DiagramResult {
    const defaults: Record<DiagramType, string> = {
      sequence: 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: Request\n  B-->>A: Response',
      flowchart: 'flowchart TD\n  A[Start] --> B[Process]\n  B --> C[End]',
      class: 'classDiagram\n  class Example {\n    +property\n    +method()\n  }',
      'entity-relationship': 'erDiagram\n  ENTITY1 ||--o{ ENTITY2 : has',
      state: 'stateDiagram-v2\n  [*] --> State1\n  State1 --> [*]',
      architecture: 'flowchart TD\n  subgraph System\n    A[Component A]\n    B[Component B]\n  end',
    };

    return {
      type,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} Diagram`,
      mermaidCode: defaults[type] ?? defaults.flowchart,
      description: 'Default diagram - configure LLM API keys for custom generation',
    };
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) imports.push(match[1]);
    }
    return imports;
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:const|function|class|interface|type|enum)\s+(\w+)/g;
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) exports.push(match[1]);
    }
    return exports;
  }

  formatAsMermaidBlock(diagram: DiagramResult): string {
    return `## ${diagram.title}

${diagram.description}

\`\`\`mermaid
${diagram.mermaidCode}
\`\`\`
`;
  }
}

export const diagramGeneratorService = new DiagramGeneratorService();
