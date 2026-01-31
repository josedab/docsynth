import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@docsynth/utils';

const log = createLogger('openapi-generator-service');

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
  };
}

interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
}

interface OperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
}

interface ParameterObject {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required?: boolean;
  schema: SchemaObject;
  description?: string;
}

interface RequestBodyObject {
  required?: boolean;
  content: Record<string, { schema: SchemaObject }>;
}

interface ResponseObject {
  description: string;
  content?: Record<string, { schema: SchemaObject }>;
}

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  description?: string;
  example?: unknown;
}

export class OpenAPIGeneratorService {
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

  async generateFromRoutes(
    routeFiles: { path: string; content: string }[],
    projectName: string,
    version: string
  ): Promise<OpenAPISpec> {
    log.info({ fileCount: routeFiles.length }, 'Generating OpenAPI spec from routes');

    const combinedRoutes = routeFiles
      .map((f) => `// File: ${f.path}\n${f.content.slice(0, 5000)}`)
      .join('\n\n');

    const prompt = this.buildOpenAPIPrompt(combinedRoutes, projectName, version);
    const spec = await this.runGeneration(prompt, projectName, version);

    return spec;
  }

  private buildOpenAPIPrompt(routeCode: string, projectName: string, version: string): string {
    return `Analyze the following API route code and generate an OpenAPI 3.0 specification.

## Route Code
\`\`\`typescript
${routeCode}
\`\`\`

---

Generate a complete OpenAPI 3.0 specification that documents all the endpoints found in the code.

For each endpoint:
1. Extract the HTTP method and path
2. Document path and query parameters
3. Document request body schema (if applicable)
4. Document response schemas
5. Add helpful descriptions

Return a valid OpenAPI 3.0 JSON specification:
{
  "openapi": "3.0.0",
  "info": {
    "title": "${projectName}",
    "version": "${version}",
    "description": "API documentation"
  },
  "paths": {
    // Endpoint definitions
  },
  "components": {
    "schemas": {
      // Reusable schemas
    }
  }
}

Return ONLY the JSON object:`;
  }

  private async runGeneration(
    prompt: string,
    projectName: string,
    version: string
  ): Promise<OpenAPISpec> {
    if (this.anthropic) {
      try {
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
        return this.parseOpenAPIResponse(text, projectName, version);
      } catch (error) {
        log.warn({ error }, 'Anthropic generation failed');
      }
    }

    if (this.openai) {
      try {
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = response.choices[0]?.message?.content ?? '';
        return this.parseOpenAPIResponse(text, projectName, version);
      } catch (error) {
        log.warn({ error }, 'OpenAI generation failed');
      }
    }

    return this.getDefaultSpec(projectName, version);
  }

  private parseOpenAPIResponse(
    text: string,
    projectName: string,
    version: string
  ): OpenAPISpec {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          openapi: parsed.openapi ?? '3.0.0',
          info: {
            title: parsed.info?.title ?? projectName,
            version: parsed.info?.version ?? version,
            description: parsed.info?.description,
          },
          paths: parsed.paths ?? {},
          components: parsed.components,
        };
      }
    } catch (error) {
      log.warn({ error }, 'Failed to parse OpenAPI response');
    }

    return this.getDefaultSpec(projectName, version);
  }

  private getDefaultSpec(projectName: string, version: string): OpenAPISpec {
    return {
      openapi: '3.0.0',
      info: {
        title: projectName,
        version,
        description: 'API documentation (auto-generated)',
      },
      paths: {},
    };
  }

  formatAsYAML(spec: OpenAPISpec): string {
    return this.jsonToYaml(spec);
  }

  private jsonToYaml(obj: unknown, indent = 0): string {
    const spaces = '  '.repeat(indent);
    const lines: string[] = [];

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'object' && item !== null) {
          lines.push(`${spaces}-`);
          lines.push(this.jsonToYaml(item, indent + 1));
        } else {
          lines.push(`${spaces}- ${this.formatValue(item)}`);
        }
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;
        if (typeof value === 'object' && value !== null) {
          lines.push(`${spaces}${key}:`);
          lines.push(this.jsonToYaml(value, indent + 1));
        } else {
          lines.push(`${spaces}${key}: ${this.formatValue(value)}`);
        }
      }
    }

    return lines.join('\n');
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      if (value.includes('\n') || value.includes(':') || value.includes('#')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }
}

export const openAPIGeneratorService = new OpenAPIGeneratorService();
