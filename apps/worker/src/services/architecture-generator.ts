import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';
import type { FileChange, GeneratedDocument } from '@docsynth/types';

const log = createLogger('architecture-generator');

export interface ArchitectureContext {
  prTitle: string;
  prBody: string | null;
  prNumber: number;
  owner: string;
  repo: string;
  changes: FileChange[];
  projectStructure: ProjectStructure;
  existingArchDocs: string | null;
  dependencies: Dependency[];
}

export interface ProjectStructure {
  directories: string[];
  entryPoints: string[];
  modules: ModuleInfo[];
}

export interface ModuleInfo {
  name: string;
  path: string;
  exports: string[];
  dependencies: string[];
}

export interface Dependency {
  name: string;
  version: string;
  type: 'production' | 'development';
}

export interface ArchitectureResult {
  document: GeneratedDocument;
  diagram: string;
  tokensUsed: number;
}

export class ArchitectureGeneratorService {
  private anthropic: Anthropic | null = null;
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  // Determine if changes warrant architecture doc update
  shouldUpdateArchDocs(changes: FileChange[]): boolean {
    const hasStructuralChanges = changes.some(
      (c) =>
        c.path.includes('package.json') ||
        c.path.includes('tsconfig') ||
        c.path.endsWith('index.ts') ||
        c.path.endsWith('index.js') ||
        c.path.includes('/src/') && c.changeType === 'added'
    );

    const hasNewModules = changes.some((c) =>
      c.semanticChanges.some((sc) =>
        ['new-module', 'new-class', 'architecture-change'].includes(sc.type)
      )
    );

    return hasStructuralChanges || hasNewModules;
  }

  async generateArchitectureDocs(context: ArchitectureContext): Promise<ArchitectureResult> {
    log.info(
      { owner: context.owner, repo: context.repo, prNumber: context.prNumber },
      'Generating architecture documentation'
    );

    // Generate both the document and diagram
    const [docResult, diagramResult] = await Promise.all([
      this.generateDocument(context),
      this.generateDiagram(context),
    ]);

    // Combine diagram into document
    const contentWithDiagram = docResult.content.replace(
      '## System Diagram',
      `## System Diagram\n\n${diagramResult.diagram}`
    );

    return {
      document: {
        path: 'docs/architecture.md',
        type: 'ARCHITECTURE',
        title: 'Architecture Overview',
        content: contentWithDiagram,
        action: context.existingArchDocs ? 'update' : 'create',
      },
      diagram: diagramResult.diagram,
      tokensUsed: docResult.tokensUsed + diagramResult.tokensUsed,
    };
  }

  private async generateDocument(
    context: ArchitectureContext
  ): Promise<{ content: string; tokensUsed: number }> {
    const prompt = this.buildDocumentPrompt(context);
    return this.generate(prompt);
  }

  private buildDocumentPrompt(context: ArchitectureContext): string {
    return `Generate architecture documentation for this project:

## Project
**Repository:** ${context.owner}/${context.repo}

## Project Structure
**Directories:**
${context.projectStructure.directories.map((d) => `- ${d}`).join('\n')}

**Entry Points:**
${context.projectStructure.entryPoints.map((e) => `- ${e}`).join('\n')}

**Modules:**
${context.projectStructure.modules
  .map((m) => `### ${m.name}\n- Path: ${m.path}\n- Exports: ${m.exports.join(', ')}\n- Dependencies: ${m.dependencies.join(', ')}`)
  .join('\n\n')}

## Dependencies
**Production:**
${context.dependencies
  .filter((d) => d.type === 'production')
  .map((d) => `- ${d.name}@${d.version}`)
  .join('\n') || 'None'}

**Development:**
${context.dependencies
  .filter((d) => d.type === 'development')
  .slice(0, 10)
  .map((d) => `- ${d.name}@${d.version}`)
  .join('\n') || 'None'}

## Recent Changes (PR #${context.prNumber})
${context.prTitle}
${context.prBody ?? ''}

## Existing Architecture Docs
${context.existingArchDocs?.slice(0, 1000) ?? 'None - this will be the first architecture document'}

---

Generate comprehensive architecture documentation:

# Architecture Overview

## Introduction
Brief overview of what this project does and its primary purpose.

## System Diagram
(Placeholder for Mermaid diagram)

## High-Level Architecture
Describe the overall architecture pattern (monolith, microservices, monorepo, etc.)

## Core Components

### Component 1
- **Purpose:** What it does
- **Location:** Where it lives
- **Key files:** Important files

### Component 2
...

## Data Flow
Describe how data flows through the system.

## Key Design Decisions
List important architectural decisions and their rationale.

## Technology Stack
- **Runtime:** 
- **Framework:**
- **Database:**
- **Other:**

## Module Dependencies
Describe how modules depend on each other.

## External Integrations
List external services and APIs the system integrates with.

## Security Considerations
Key security aspects of the architecture.

## Performance Considerations
Key performance aspects.

## Future Considerations
Areas for potential improvement or expansion.

---

Output ONLY the architecture documentation in markdown:`;
  }

  private async generateDiagram(
    context: ArchitectureContext
  ): Promise<{ diagram: string; tokensUsed: number }> {
    const prompt = `Generate a Mermaid diagram for this project architecture:

**Modules:**
${context.projectStructure.modules.map((m) => `- ${m.name}: exports ${m.exports.length} items, depends on: ${m.dependencies.join(', ') || 'none'}`).join('\n')}

**Recent Changes:**
${context.changes.map((c) => `- ${c.changeType}: ${c.path}`).slice(0, 10).join('\n')}

Generate a Mermaid flowchart showing:
1. Main components/modules
2. Data flow between them
3. External dependencies

Use this format:
\`\`\`mermaid
flowchart TB
    subgraph "Layer Name"
        A[Component A]
        B[Component B]
    end
    A --> B
\`\`\`

Keep it readable (max 15 nodes). Output ONLY the mermaid code block:`;

    const { content, tokensUsed } = await this.generate(prompt);

    // Extract mermaid diagram from response
    const mermaidMatch = content.match(/```mermaid\n([\s\S]*?)```/);
    const diagram = mermaidMatch
      ? `\`\`\`mermaid\n${mermaidMatch[1]}\`\`\``
      : this.generateFallbackDiagram(context);

    return { diagram, tokensUsed };
  }

  private generateFallbackDiagram(context: ArchitectureContext): string {
    const modules = context.projectStructure.modules.slice(0, 6);

    let diagram = '```mermaid\nflowchart TB\n';
    diagram += '    subgraph "Project Structure"\n';

    for (const mod of modules) {
      const safeName = mod.name.replace(/[^a-zA-Z0-9]/g, '');
      diagram += `        ${safeName}["${mod.name}"]\n`;
    }

    diagram += '    end\n';

    // Add some basic connections
    if (modules.length > 1) {
      for (let i = 0; i < modules.length - 1; i++) {
        const from = modules[i]!.name.replace(/[^a-zA-Z0-9]/g, '');
        const to = modules[i + 1]!.name.replace(/[^a-zA-Z0-9]/g, '');
        if (modules[i]!.dependencies.some((d) => d.includes(modules[i + 1]!.name))) {
          diagram += `    ${from} --> ${to}\n`;
        }
      }
    }

    diagram += '```';
    return diagram;
  }

  private async generate(prompt: string): Promise<{ content: string; tokensUsed: number }> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        });

        const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return { content, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };
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

        const content = response.choices[0]?.message?.content ?? '';
        return { content, tokensUsed: response.usage?.total_tokens ?? 0 };
      } catch (error) {
        log.warn({ error }, 'OpenAI generation failed');
      }
    }

    return {
      content: this.generateFallbackContent(),
      tokensUsed: 0,
    };
  }

  private generateFallbackContent(): string {
    return `# Architecture Overview

## Introduction
This document provides an overview of the project architecture.

> **Note:** Full AI-generated architecture documentation requires ANTHROPIC_API_KEY or OPENAI_API_KEY configuration.

## System Diagram
\`\`\`mermaid
flowchart TB
    A[Client] --> B[API]
    B --> C[Database]
\`\`\`

## High-Level Architecture
See the project structure and README for details.

## Core Components
Review the source code directories for component information.

## Technology Stack
See package.json for dependencies.
`;
  }

  // Generate a component diagram for a specific module
  async generateComponentDiagram(module: ModuleInfo): Promise<string> {
    const prompt = `Generate a Mermaid class diagram for this module:

**Module:** ${module.name}
**Path:** ${module.path}
**Exports:** ${module.exports.join(', ')}
**Dependencies:** ${module.dependencies.join(', ')}

Generate a simple Mermaid class diagram showing the exported classes/functions.
Output ONLY the mermaid code block:`;

    const { content } = await this.generate(prompt);
    const match = content.match(/```mermaid\n([\s\S]*?)```/);
    return match ? `\`\`\`mermaid\n${match[1]}\`\`\`` : '';
  }
}

export const architectureGeneratorService = new ArchitectureGeneratorService();
