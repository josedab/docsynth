/**
 * Multi-Framework Doc Templates Service
 *
 * Framework-specific documentation templates with auto-detection,
 * variable interpolation, and custom template support.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('framework-templates-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocTemplate {
  id: string;
  name: string;
  framework: string;
  sections: TemplateSection[];
  variables: TemplateVariable[];
  outputFormat: 'markdown' | 'mdx' | 'rst';
  builtIn: boolean;
}

export interface TemplateSection {
  title: string;
  content: string;
  required: boolean;
  conditionalOn?: string;
}

export interface TemplateVariable {
  name: string;
  description: string;
  type: 'string' | 'boolean' | 'array';
  defaultValue?: string;
  required: boolean;
}

export interface FrameworkDetectionResult {
  repositoryId: string;
  detectedFrameworks: Array<{ framework: string; confidence: number; evidence: string }>;
  recommendedTemplates: string[];
}

export interface TemplateRenderResult {
  content: string;
  template: string;
  variables: Record<string, unknown>;
  warnings: string[];
}

// ============================================================================
// Built-in Templates
// ============================================================================

const BUILT_IN_TEMPLATES: DocTemplate[] = [
  {
    id: 'react-component',
    name: 'React Component',
    framework: 'react',
    outputFormat: 'mdx',
    builtIn: true,
    sections: [
      { title: 'Overview', content: '# {{componentName}}\n\n{{description}}', required: true },
      {
        title: 'Props',
        content:
          '## Props\n\n| Prop | Type | Default | Description |\n|------|------|---------|-------------|\n{{#each props}}\n| `{{name}}` | `{{type}}` | `{{default}}` | {{description}} |\n{{/each}}',
        required: true,
      },
      {
        title: 'Usage',
        content:
          "## Usage\n\n```tsx\nimport { {{componentName}} } from '{{packageName}}';\n\n<{{componentName}} />\n```",
        required: true,
      },
      { title: 'Examples', content: '## Examples\n\n{{examples}}', required: false },
    ],
    variables: [
      { name: 'componentName', description: 'Component name', type: 'string', required: true },
      { name: 'description', description: 'Component description', type: 'string', required: true },
      {
        name: 'packageName',
        description: 'Package import path',
        type: 'string',
        required: true,
        defaultValue: './components',
      },
      { name: 'props', description: 'Component props', type: 'array', required: false },
    ],
  },
  {
    id: 'rest-api',
    name: 'REST API Endpoint',
    framework: 'rest-api',
    outputFormat: 'markdown',
    builtIn: true,
    sections: [
      { title: 'Endpoint', content: '# {{method}} {{path}}\n\n{{description}}', required: true },
      { title: 'Parameters', content: '## Parameters\n\n{{parameters}}', required: false },
      {
        title: 'Request Body',
        content: '## Request Body\n\n```json\n{{requestBody}}\n```',
        required: false,
      },
      {
        title: 'Response',
        content: '## Response\n\n```json\n{{responseBody}}\n```',
        required: true,
      },
      { title: 'Errors', content: '## Error Codes\n\n{{errors}}', required: false },
    ],
    variables: [
      { name: 'method', description: 'HTTP method', type: 'string', required: true },
      { name: 'path', description: 'Endpoint path', type: 'string', required: true },
      { name: 'description', description: 'Endpoint description', type: 'string', required: true },
    ],
  },
  {
    id: 'cli-command',
    name: 'CLI Command',
    framework: 'cli',
    outputFormat: 'markdown',
    builtIn: true,
    sections: [
      { title: 'Command', content: '# `{{commandName}}`\n\n{{description}}', required: true },
      { title: 'Usage', content: '## Usage\n\n```bash\n{{usage}}\n```', required: true },
      { title: 'Options', content: '## Options\n\n{{options}}', required: false },
      { title: 'Examples', content: '## Examples\n\n{{examples}}', required: true },
    ],
    variables: [
      { name: 'commandName', description: 'Command name', type: 'string', required: true },
      { name: 'description', description: 'Command description', type: 'string', required: true },
      { name: 'usage', description: 'Usage string', type: 'string', required: true },
    ],
  },
];

// ============================================================================
// Core Functions
// ============================================================================

export async function detectFrameworks(repositoryId: string): Promise<FrameworkDetectionResult> {
  const docs = await prisma.document.findMany({
    where: { repositoryId },
    select: { path: true, content: true },
    take: 50,
  });

  const detections: Array<{ framework: string; confidence: number; evidence: string }> = [];
  const allContent = docs.map((d) => d.content ?? '').join('\n');
  const allPaths = docs.map((d) => d.path).join('\n');

  const frameworkSignals: Array<{ framework: string; signals: RegExp[]; pathSignals: RegExp[] }> = [
    { framework: 'react', signals: [/from\s+['"]react['"]/], pathSignals: [/\.tsx$/, /\.jsx$/] },
    { framework: 'next', signals: [/from\s+['"]next/], pathSignals: [/app\/page\.tsx/, /pages\//] },
    { framework: 'express', signals: [/from\s+['"]express['"]/], pathSignals: [/routes?\.ts/] },
    { framework: 'hono', signals: [/from\s+['"]hono['"]/], pathSignals: [/routes?\.ts/] },
    { framework: 'prisma', signals: [/from\s+['"]@prisma/], pathSignals: [/schema\.prisma/] },
    {
      framework: 'python',
      signals: [/import\s+\w+/, /from\s+\w+\s+import/],
      pathSignals: [/\.py$/],
    },
    { framework: 'go', signals: [/^package\s+\w+/m], pathSignals: [/\.go$/, /go\.mod/] },
  ];

  for (const fw of frameworkSignals) {
    const contentMatches = fw.signals.filter((s) => s.test(allContent)).length;
    const pathMatches = fw.pathSignals.filter((s) => s.test(allPaths)).length;
    const confidence = Math.min(0.95, contentMatches * 0.3 + pathMatches * 0.2);
    if (confidence > 0.1) {
      detections.push({
        framework: fw.framework,
        confidence,
        evidence: `${contentMatches} content + ${pathMatches} path signal(s)`,
      });
    }
  }

  detections.sort((a, b) => b.confidence - a.confidence);
  const recommended = detections.slice(0, 3).map((d) => {
    const template = BUILT_IN_TEMPLATES.find((t) => t.framework === d.framework);
    return template?.id ?? `${d.framework}-default`;
  });

  log.info({ repositoryId, detected: detections.length }, 'Frameworks detected');
  return { repositoryId, detectedFrameworks: detections, recommendedTemplates: recommended };
}

export async function getTemplate(templateId: string): Promise<DocTemplate | null> {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (builtIn) return builtIn;

  const custom = await db.docTemplate.findUnique({ where: { id: templateId } });
  if (!custom) return null;
  return {
    id: custom.id,
    name: custom.name,
    framework: custom.framework,
    sections: custom.sections as unknown as TemplateSection[],
    variables: custom.variables as unknown as TemplateVariable[],
    outputFormat: custom.outputFormat,
    builtIn: false,
  };
}

export function listTemplates(): DocTemplate[] {
  return BUILT_IN_TEMPLATES;
}

export async function renderTemplate(
  templateId: string,
  variables: Record<string, unknown>
): Promise<TemplateRenderResult> {
  const template = await getTemplate(templateId);
  if (!template) throw new Error(`Template not found: ${templateId}`);

  const warnings: string[] = [];
  for (const v of template.variables) {
    if (v.required && !(v.name in variables)) {
      if (v.defaultValue) {
        variables[v.name] = v.defaultValue;
        warnings.push(`Using default for ${v.name}: ${v.defaultValue}`);
      } else {
        warnings.push(`Missing required variable: ${v.name}`);
      }
    }
  }

  const content = template.sections
    .filter((s) => s.required || (s.conditionalOn ? variables[s.conditionalOn] : true))
    .map((s) => interpolate(s.content, variables))
    .join('\n\n');

  log.info({ templateId, variableCount: Object.keys(variables).length }, 'Template rendered');
  return { content, template: templateId, variables, warnings };
}

export async function createCustomTemplate(
  repositoryId: string,
  template: Omit<DocTemplate, 'id' | 'builtIn'>
): Promise<DocTemplate> {
  const id = `custom-${repositoryId}-${Date.now()}`;
  await db.docTemplate.create({
    data: {
      id,
      repositoryId,
      name: template.name,
      framework: template.framework,
      sections: JSON.parse(JSON.stringify(template.sections)),
      variables: JSON.parse(JSON.stringify(template.variables)),
      outputFormat: template.outputFormat,
      createdAt: new Date(),
    },
  });
  return { ...template, id, builtIn: false };
}

function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}
