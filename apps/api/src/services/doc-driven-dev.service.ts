/**
 * Doc-Driven Development Mode Service
 *
 * Write documentation first, then generate code scaffolding, tests,
 * and API contracts from docs. Enables spec-first development.
 */

import { prisma } from '@docsynth/database';
import { getAnthropicClient } from '@docsynth/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export type ArtifactType =
  | 'code_scaffold'
  | 'api_contract'
  | 'test_suite'
  | 'db_schema'
  | 'openapi_spec';

export interface DocSpecEndpoint {
  method: string;
  path: string;
  summary: string;
  parameters: Array<{ name: string; type: string; required: boolean }>;
  responseType: string;
}

export interface DocSpecModel {
  name: string;
  fields: Array<{ name: string; type: string; required: boolean; description: string }>;
}

export interface DocSpec {
  title: string;
  endpoints: DocSpecEndpoint[];
  dataModels: DocSpecModel[];
  constraints: string[];
}

export interface GeneratedArtifact {
  type: ArtifactType;
  language: string;
  content: string;
  path: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse a document to extract specifications
 */
export async function parseDocSpec(documentId: string, repositoryId: string): Promise<DocSpec> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { content: true, title: true },
  });

  if (!doc?.content) {
    throw new Error('Document not found or empty');
  }

  const anthropic = getAnthropicClient();
  let spec: DocSpec;

  if (anthropic) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `You are a specification parser. Extract API endpoints, data models, and constraints from documentation. Return ONLY valid JSON.`,
        messages: [
          {
            role: 'user',
            content: `Parse this documentation into a specification:\n\n${doc.content.substring(0, 6000)}\n\nReturn: {"title":"...","endpoints":[{"method":"GET","path":"/api/users","summary":"Get users","parameters":[],"responseType":"User[]"}],"dataModels":[{"name":"User","fields":[{"name":"id","type":"string","required":true,"description":"User ID"}]}],"constraints":["Authentication required"]}`,
          },
        ],
      });

      const text = response.content[0];
      if (text && text.type === 'text') {
        const match = (text as { type: 'text'; text: string }).text.match(/\{[\s\S]*\}/);
        if (match) {
          spec = JSON.parse(match[0]);
        } else {
          spec = heuristicParse(doc.content, doc.title);
        }
      } else {
        spec = heuristicParse(doc.content, doc.title);
      }
    } catch {
      spec = heuristicParse(doc.content, doc.title);
    }
  } else {
    spec = heuristicParse(doc.content, doc.title);
  }

  // Persist spec
  await db.docSpec.upsert({
    where: { id: `${repositoryId}-${documentId}` },
    create: {
      id: `${repositoryId}-${documentId}`,
      repositoryId,
      documentId,
      title: spec.title,
      endpoints: spec.endpoints,
      dataModels: spec.dataModels,
      constraints: spec.constraints,
      status: 'validated',
    },
    update: {
      title: spec.title,
      endpoints: spec.endpoints,
      dataModels: spec.dataModels,
      constraints: spec.constraints,
      status: 'validated',
    },
  });

  return spec;
}

/**
 * Generate code artifacts from a spec
 */
export async function generateArtifacts(
  specId: string,
  targetLanguage: string,
  generateTests: boolean
): Promise<GeneratedArtifact[]> {
  const spec = await db.docSpec.findUnique({ where: { id: specId } });
  if (!spec) throw new Error('Spec not found');

  const parsedSpec: DocSpec = {
    title: spec.title as string,
    endpoints: spec.endpoints as DocSpecEndpoint[],
    dataModels: spec.dataModels as DocSpecModel[],
    constraints: spec.constraints as string[],
  };

  // Update status
  await db.docSpec.update({ where: { id: specId }, data: { status: 'generating' } });

  const artifacts: GeneratedArtifact[] = [];

  try {
    // Generate API contract (OpenAPI)
    artifacts.push(generateOpenAPISpec(parsedSpec));

    // Generate code scaffold
    artifacts.push(...generateCodeScaffold(parsedSpec, targetLanguage));

    // Generate database schema
    if (parsedSpec.dataModels.length > 0) {
      artifacts.push(generateDBSchema(parsedSpec, targetLanguage));
    }

    // Generate test suite
    if (generateTests) {
      artifacts.push(generateTestSuite(parsedSpec, targetLanguage));
    }

    // Persist artifacts
    for (const artifact of artifacts) {
      await db.generatedArtifact.create({
        data: {
          specId,
          artifactType: artifact.type,
          language: artifact.language,
          content: artifact.content,
          path: artifact.path,
        },
      });
    }

    await db.docSpec.update({ where: { id: specId }, data: { status: 'generated' } });
  } catch (error) {
    await db.docSpec.update({ where: { id: specId }, data: { status: 'failed' } });
    throw error;
  }

  return artifacts;
}

/**
 * Get spec and its artifacts
 */
export async function getSpecWithArtifacts(specId: string) {
  const spec = await db.docSpec.findUnique({ where: { id: specId } });
  if (!spec) return null;

  const artifacts = await db.generatedArtifact.findMany({
    where: { specId },
    orderBy: { createdAt: 'asc' },
  });

  return { spec, artifacts };
}

/**
 * List specs for a repository
 */
export async function listSpecs(repositoryId: string) {
  return db.docSpec.findMany({
    where: { repositoryId },
    orderBy: { updatedAt: 'desc' },
  });
}

// ============================================================================
// Generation Functions
// ============================================================================

function generateOpenAPISpec(spec: DocSpec): GeneratedArtifact {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of spec.endpoints) {
    const method = ep.method.toLowerCase();
    if (!paths[ep.path]) paths[ep.path] = {};

    paths[ep.path]![method] = {
      summary: ep.summary,
      parameters: ep.parameters
        .filter((p) => !['body', 'requestBody'].includes(p.name))
        .map((p) => ({
          name: p.name,
          in: 'query',
          required: p.required,
          schema: { type: mapType(p.type) },
        })),
      responses: {
        '200': {
          description: 'Success',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    };
  }

  const schemas: Record<string, unknown> = {};
  for (const model of spec.dataModels) {
    schemas[model.name] = {
      type: 'object',
      required: model.fields.filter((f) => f.required).map((f) => f.name),
      properties: Object.fromEntries(
        model.fields.map((f) => [f.name, { type: mapType(f.type), description: f.description }])
      ),
    };
  }

  const openapi = {
    openapi: '3.0.3',
    info: { title: spec.title, version: '1.0.0' },
    paths,
    components: { schemas },
  };

  return {
    type: 'openapi_spec',
    language: 'yaml',
    content: JSON.stringify(openapi, null, 2),
    path: 'openapi.json',
  };
}

function generateCodeScaffold(spec: DocSpec, language: string): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];

  if (language === 'typescript' || language === 'javascript') {
    // Generate types
    let typesContent = `// Auto-generated types from ${spec.title}\n\n`;
    for (const model of spec.dataModels) {
      typesContent += `export interface ${model.name} {\n`;
      for (const field of model.fields) {
        const optional = field.required ? '' : '?';
        typesContent += `  ${field.name}${optional}: ${mapTSType(field.type)}; // ${field.description}\n`;
      }
      typesContent += `}\n\n`;
    }
    artifacts.push({
      type: 'code_scaffold',
      language,
      content: typesContent,
      path: 'src/types.ts',
    });

    // Generate route handlers
    let routesContent = `// Auto-generated routes from ${spec.title}\nimport { Hono } from 'hono';\n\nconst app = new Hono();\n\n`;
    for (const ep of spec.endpoints) {
      const method = ep.method.toLowerCase();
      routesContent += `app.${method}('${ep.path}', async (c) => {\n  // TODO: Implement ${ep.summary}\n  return c.json({ success: true });\n});\n\n`;
    }
    routesContent += `export default app;\n`;
    artifacts.push({
      type: 'code_scaffold',
      language,
      content: routesContent,
      path: 'src/routes.ts',
    });
  }

  if (language === 'python') {
    let content = `# Auto-generated from ${spec.title}\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI(title="${spec.title}")\n\n`;
    for (const model of spec.dataModels) {
      content += `class ${model.name}(BaseModel):\n`;
      for (const field of model.fields) {
        content += `    ${field.name}: ${mapPyType(field.type)}  # ${field.description}\n`;
      }
      content += `\n`;
    }
    for (const ep of spec.endpoints) {
      const decorator = ep.method.toLowerCase();
      content += `@app.${decorator}("${ep.path}")\nasync def ${snakeCase(ep.summary)}():\n    # TODO: Implement\n    return {"success": True}\n\n`;
    }
    artifacts.push({ type: 'code_scaffold', language: 'python', content, path: 'main.py' });
  }

  return artifacts;
}

function generateDBSchema(spec: DocSpec, _language: string): GeneratedArtifact {
  let content = `-- Auto-generated database schema from ${spec.title}\n\n`;
  for (const model of spec.dataModels) {
    const tableName = snakeCase(model.name) + 's';
    content += `CREATE TABLE ${tableName} (\n`;
    content += `  id TEXT PRIMARY KEY,\n`;
    for (const field of model.fields) {
      if (field.name === 'id') continue;
      const nullable = field.required ? ' NOT NULL' : '';
      content += `  ${snakeCase(field.name)} ${mapSQLType(field.type)}${nullable},\n`;
    }
    content += `  created_at TIMESTAMP DEFAULT NOW(),\n`;
    content += `  updated_at TIMESTAMP DEFAULT NOW()\n`;
    content += `);\n\n`;
  }
  return { type: 'db_schema', language: 'sql', content, path: 'schema.sql' };
}

function generateTestSuite(spec: DocSpec, language: string): GeneratedArtifact {
  let content: string;

  if (language === 'typescript' || language === 'javascript') {
    content = `// Auto-generated test suite from ${spec.title}\nimport { describe, it, expect } from 'vitest';\n\n`;
    for (const ep of spec.endpoints) {
      content += `describe('${ep.method} ${ep.path}', () => {\n`;
      content += `  it('should ${ep.summary.toLowerCase()}', async () => {\n`;
      content += `    // TODO: Implement test\n`;
      content += `    expect(true).toBe(true);\n`;
      content += `  });\n`;
      content += `});\n\n`;
    }
  } else {
    content = `# Auto-generated test suite from ${spec.title}\nimport pytest\n\n`;
    for (const ep of spec.endpoints) {
      content += `def test_${snakeCase(ep.summary)}():\n    # TODO: Implement test\n    assert True\n\n`;
    }
  }

  const ext = language === 'python' ? 'py' : 'ts';
  return { type: 'test_suite', language, content, path: `tests/test_api.${ext}` };
}

// ============================================================================
// Utility Functions
// ============================================================================

function heuristicParse(content: string, title: string): DocSpec {
  const endpoints: DocSpecEndpoint[] = [];
  const regex = /(GET|POST|PUT|PATCH|DELETE)\s+(\/[a-zA-Z0-9/_{}:-]+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match[1] && match[2]) {
      endpoints.push({
        method: match[1],
        path: match[2],
        summary: `${match[1]} ${match[2]}`,
        parameters: [],
        responseType: 'object',
      });
    }
  }

  return { title, endpoints, dataModels: [], constraints: [] };
}

function mapType(type: string): string {
  const map: Record<string, string> = {
    string: 'string',
    number: 'number',
    integer: 'integer',
    boolean: 'boolean',
    array: 'array',
  };
  return map[type.toLowerCase()] || 'string';
}

function mapTSType(type: string): string {
  const map: Record<string, string> = {
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
    array: 'unknown[]',
    date: 'Date',
  };
  return map[type.toLowerCase()] || 'unknown';
}

function mapPyType(type: string): string {
  const map: Record<string, string> = {
    string: 'str',
    number: 'float',
    integer: 'int',
    boolean: 'bool',
    array: 'list',
    date: 'datetime',
  };
  return map[type.toLowerCase()] || 'str';
}

function mapSQLType(type: string): string {
  const map: Record<string, string> = {
    string: 'TEXT',
    number: 'NUMERIC',
    integer: 'INTEGER',
    boolean: 'BOOLEAN',
    date: 'TIMESTAMP',
    array: 'JSONB',
  };
  return map[type.toLowerCase()] || 'TEXT';
}

function snakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
