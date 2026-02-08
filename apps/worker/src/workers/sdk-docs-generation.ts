/**
 * SDK Documentation Generation Worker
 *
 * Parses API specs and generates language-specific SDK documentation
 * with idiomatic code examples for requested target languages.
 */

import { createWorker } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('sdk-docs-generation-worker');

// Job data interface - will be moved to @docsynth/queue types as SDKDocsGenerationJobData
interface SDKDocsGenerationJobData {
  repositoryId: string;
  installationId: number;
  owner: string;
  repo: string;
  specPath: string;
  specFormat: 'openapi' | 'graphql' | 'protobuf';
  targetLanguages: string[];
  outputDir: string;
  includeExamples: boolean;
  apiVersion: string;
}

export function startSDKDocsGenerationWorker() {
  // TODO: Add 'sdk-docs-generation' to QUEUE_NAMES constant in @docsynth/queue
  const worker = createWorker(
    'sdk-docs-generation' as any,
    async (job) => {
      const data = job.data as SDKDocsGenerationJobData;
      const startTime = Date.now();

      log.info(
        {
          jobId: job.id,
          repo: `${data.owner}/${data.repo}`,
          languages: data.targetLanguages,
          specFormat: data.specFormat,
        },
        'Starting SDK documentation generation'
      );

      await job.updateProgress(10);

      try {
        // Validate repository
        const repository = await prisma.repository.findUnique({
          where: { id: data.repositoryId },
        });

        if (!repository) {
          throw new Error(`Repository not found: ${data.repositoryId}`);
        }

        await job.updateProgress(30);

        // Parse the API spec
        // In production, this would fetch the spec file and parse it based on format
        const apiEndpoints = await parseAPISpec(
          data.owner,
          data.repo,
          data.specPath,
          data.specFormat,
          data.installationId
        );

        await job.updateProgress(50);

        // Generate SDK docs for each target language
        const generatedDocs: Array<{
          language: string;
          files: Array<{ path: string; content: string }>;
          exampleCount: number;
        }> = [];

        const languageProgress = 40 / data.targetLanguages.length; // Distribute 40% across languages (50% to 90%)

        for (let i = 0; i < data.targetLanguages.length; i++) {
          const language = data.targetLanguages[i]!;

          log.info(
            { language, endpointCount: apiEndpoints.length },
            'Generating SDK docs for language'
          );

          const docs = generateLanguageDocs(
            apiEndpoints,
            language,
            data.includeExamples,
            data.apiVersion
          );

          generatedDocs.push(docs);

          await job.updateProgress(50 + Math.round((i + 1) * languageProgress));
        }

        await job.updateProgress(90);

        // Store generated documentation metadata
        const totalFiles = generatedDocs.reduce((sum, d) => sum + d.files.length, 0);
        const totalExamples = generatedDocs.reduce((sum, d) => sum + d.exampleCount, 0);
        const buildDurationMs = Date.now() - startTime;

        await job.updateProgress(100);

        log.info(
          {
            jobId: job.id,
            repo: `${data.owner}/${data.repo}`,
            languages: data.targetLanguages.length,
            totalFiles,
            totalExamples,
            buildDurationMs,
          },
          'SDK documentation generation completed'
        );

      } catch (error) {
        log.error(
          { error, jobId: job.id, repo: `${data.owner}/${data.repo}` },
          'SDK documentation generation failed'
        );
        throw error;
      }
    },
    { concurrency: 2 }
  );

  log.info('SDK documentation generation worker started');
  return worker;
}

interface APIEndpoint {
  path: string;
  method: string;
  operationId: string;
  summary: string;
  description: string;
  parameters: Array<{
    name: string;
    in: 'query' | 'path' | 'header' | 'body';
    type: string;
    required: boolean;
    description: string;
  }>;
  requestBody?: {
    contentType: string;
    schema: Record<string, unknown>;
  };
  responses: Array<{
    statusCode: number;
    description: string;
    schema?: Record<string, unknown>;
  }>;
}

async function parseAPISpec(
  _owner: string,
  _repo: string,
  _specPath: string,
  _format: 'openapi' | 'graphql' | 'protobuf',
  _installationId: number
): Promise<APIEndpoint[]> {
  // Placeholder: In production, this would:
  // 1. Fetch the spec file using GitHubClient
  // 2. Parse based on format (OpenAPI YAML/JSON, GraphQL SDL, Protobuf)
  // 3. Extract endpoint/operation definitions
  return [];
}

function generateLanguageDocs(
  endpoints: APIEndpoint[],
  language: string,
  includeExamples: boolean,
  apiVersion: string
): {
  language: string;
  files: Array<{ path: string; content: string }>;
  exampleCount: number;
} {
  const files: Array<{ path: string; content: string }> = [];
  let exampleCount = 0;

  // Generate index/overview file
  files.push({
    path: `${language}/README.md`,
    content: generateOverview(language, endpoints.length, apiVersion),
  });

  // Generate per-endpoint documentation
  for (const endpoint of endpoints) {
    const fileName = sanitizeFileName(endpoint.operationId || `${endpoint.method}-${endpoint.path}`);
    const ext = getDocExtension(language);

    let content = generateEndpointDoc(endpoint, language);

    if (includeExamples) {
      const example = generateIdiomaticExample(endpoint, language);
      content += `\n\n## Example\n\n\`\`\`${language}\n${example}\n\`\`\`\n`;
      exampleCount++;
    }

    files.push({
      path: `${language}/${fileName}${ext}`,
      content,
    });
  }

  return { language, files, exampleCount };
}

function generateOverview(language: string, endpointCount: number, apiVersion: string): string {
  const langNames: Record<string, string> = {
    typescript: 'TypeScript',
    python: 'Python',
    go: 'Go',
    java: 'Java',
    ruby: 'Ruby',
    csharp: 'C#',
    rust: 'Rust',
    php: 'PHP',
  };

  const displayName = langNames[language] || language;

  return [
    `# ${displayName} SDK Documentation`,
    '',
    `API Version: ${apiVersion}`,
    '',
    `This documentation covers ${endpointCount} API endpoints with idiomatic ${displayName} examples.`,
    '',
    '## Installation',
    '',
    getInstallInstructions(language),
    '',
    '## Quick Start',
    '',
    getQuickStartExample(language),
    '',
  ].join('\n');
}

function generateEndpointDoc(endpoint: APIEndpoint, _language: string): string {
  const lines: string[] = [];

  lines.push(`# ${endpoint.summary || endpoint.operationId}`);
  lines.push('');
  lines.push(`\`${endpoint.method.toUpperCase()} ${endpoint.path}\``);
  lines.push('');

  if (endpoint.description) {
    lines.push(endpoint.description);
    lines.push('');
  }

  if (endpoint.parameters.length > 0) {
    lines.push('## Parameters');
    lines.push('');
    lines.push('| Name | In | Type | Required | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const param of endpoint.parameters) {
      lines.push(
        `| ${param.name} | ${param.in} | ${param.type} | ${param.required ? 'Yes' : 'No'} | ${param.description} |`
      );
    }
    lines.push('');
  }

  if (endpoint.responses.length > 0) {
    lines.push('## Responses');
    lines.push('');
    for (const response of endpoint.responses) {
      lines.push(`### ${response.statusCode}`);
      lines.push('');
      lines.push(response.description);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateIdiomaticExample(endpoint: APIEndpoint, language: string): string {
  // Generate language-idiomatic code examples
  switch (language) {
    case 'typescript':
      return `const response = await client.${toCamelCase(endpoint.operationId)}({\n  // parameters\n});\nconsole.log(response.data);`;
    case 'python':
      return `response = client.${toSnakeCase(endpoint.operationId)}(\n    # parameters\n)\nprint(response.data)`;
    case 'go':
      return `resp, err := client.${toPascalCase(endpoint.operationId)}(ctx, &${toPascalCase(endpoint.operationId)}Request{\n\t// parameters\n})\nif err != nil {\n\tlog.Fatal(err)\n}\nfmt.Println(resp)`;
    case 'java':
      return `var response = client.${toCamelCase(endpoint.operationId)}(\n    // parameters\n);\nSystem.out.println(response.getData());`;
    case 'ruby':
      return `response = client.${toSnakeCase(endpoint.operationId)}(\n  # parameters\n)\nputs response.data`;
    case 'rust':
      return `let response = client.${toSnakeCase(endpoint.operationId)}()\n    // .parameters()\n    .send()\n    .await?;\nprintln!("{:?}", response);`;
    default:
      return `// ${endpoint.method.toUpperCase()} ${endpoint.path}`;
  }
}

function getInstallInstructions(language: string): string {
  switch (language) {
    case 'typescript':
      return '```bash\nnpm install @example/sdk\n```';
    case 'python':
      return '```bash\npip install example-sdk\n```';
    case 'go':
      return '```bash\ngo get github.com/example/sdk-go\n```';
    case 'java':
      return '```xml\n<dependency>\n  <groupId>com.example</groupId>\n  <artifactId>sdk</artifactId>\n</dependency>\n```';
    case 'ruby':
      return '```bash\ngem install example-sdk\n```';
    case 'rust':
      return '```toml\n[dependencies]\nexample-sdk = "0.1"\n```';
    default:
      return 'See installation guide for your language.';
  }
}

function getQuickStartExample(language: string): string {
  switch (language) {
    case 'typescript':
      return "```typescript\nimport { Client } from '@example/sdk';\n\nconst client = new Client({ apiKey: 'your-key' });\n```";
    case 'python':
      return "```python\nfrom example_sdk import Client\n\nclient = Client(api_key='your-key')\n```";
    case 'go':
      return '```go\nimport "github.com/example/sdk-go"\n\nclient := sdk.NewClient("your-key")\n```';
    default:
      return 'See quick start guide for your language.';
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function getDocExtension(_language: string): string {
  return '.md';
}

function toCamelCase(str: string): string {
  return str.replace(/[-_](.)/g, (_, c: string) => c.toUpperCase());
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '');
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
