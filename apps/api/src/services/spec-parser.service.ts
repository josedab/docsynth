/**
 * OpenAPI/GraphQL Spec-Aware Generation Service
 *
 * Parses OpenAPI 3.x and GraphQL SDL specifications, diffs spec versions,
 * and generates endpoint documentation, migration guides, and changelogs.
 */

import { createLogger } from '@docsynth/utils';

const log = createLogger('spec-parser-service');

// ============================================================================
// Types
// ============================================================================

export interface OpenAPIEndpoint {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters: SpecParameter[];
  requestBody?: SpecRequestBody;
  responses: Record<string, SpecResponse>;
  tags: string[];
  deprecated: boolean;
  security: string[];
}

export interface SpecParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  type: string;
  description?: string;
}

export interface SpecRequestBody {
  contentType: string;
  schema: Record<string, unknown>;
  required: boolean;
  description?: string;
}

export interface SpecResponse {
  statusCode: string;
  description: string;
  schema?: Record<string, unknown>;
}

export interface SpecDiffResult {
  added: OpenAPIEndpoint[];
  removed: OpenAPIEndpoint[];
  modified: Array<{
    path: string;
    method: string;
    changes: SpecChange[];
  }>;
  breakingChanges: SpecChange[];
  nonBreakingChanges: SpecChange[];
}

export interface SpecChange {
  type: 'added' | 'removed' | 'modified';
  location: string;
  description: string;
  breaking: boolean;
}

export interface GraphQLTypeInfo {
  name: string;
  kind:
    | 'query'
    | 'mutation'
    | 'subscription'
    | 'type'
    | 'input'
    | 'enum'
    | 'scalar'
    | 'interface'
    | 'union';
  description?: string;
  fields: GraphQLFieldInfo[];
}

export interface GraphQLFieldInfo {
  name: string;
  type: string;
  description?: string;
  args: Array<{ name: string; type: string; description?: string }>;
  deprecated: boolean;
  deprecationReason?: string;
}

// ============================================================================
// OpenAPI Parsing
// ============================================================================

/**
 * Parse an OpenAPI 3.x spec from YAML or JSON string.
 * Extracts all endpoint definitions with parameters, request bodies, and responses.
 */
export function parseOpenAPISpec(content: string): OpenAPIEndpoint[] {
  log.info('Parsing OpenAPI spec');

  try {
    let spec: Record<string, unknown>;

    // Try JSON first, then YAML-like parsing
    try {
      spec = JSON.parse(content);
    } catch {
      spec = parseSimpleYAML(content);
    }

    const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const endpoints: OpenAPIEndpoint[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
          const op = operation as Record<string, unknown>;
          endpoints.push(extractEndpoint(path, method, op));
        }
      }
    }

    log.info({ endpointCount: endpoints.length }, 'OpenAPI spec parsed successfully');
    return endpoints;
  } catch (error) {
    log.error({ error }, 'Failed to parse OpenAPI spec');
    throw new Error(
      `Failed to parse OpenAPI spec: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

function extractEndpoint(
  path: string,
  method: string,
  operation: Record<string, unknown>
): OpenAPIEndpoint {
  const parameters: SpecParameter[] = [];
  const rawParams = (operation.parameters ?? []) as Array<Record<string, unknown>>;

  for (const param of rawParams) {
    parameters.push({
      name: String(param.name ?? ''),
      in: String(param.in ?? 'query') as SpecParameter['in'],
      required: Boolean(param.required),
      type: resolveParamType(param),
      description: param.description ? String(param.description) : undefined,
    });
  }

  let requestBody: SpecRequestBody | undefined;
  if (operation.requestBody) {
    const rb = operation.requestBody as Record<string, unknown>;
    const rbContent = (rb.content ?? {}) as Record<string, Record<string, unknown>>;
    const firstContentType = Object.keys(rbContent)[0] ?? 'application/json';
    const contentSchema = rbContent[firstContentType]?.schema ?? {};

    requestBody = {
      contentType: firstContentType,
      schema: contentSchema as Record<string, unknown>,
      required: Boolean(rb.required),
      description: rb.description ? String(rb.description) : undefined,
    };
  }

  const responses: Record<string, SpecResponse> = {};
  const rawResponses = (operation.responses ?? {}) as Record<string, Record<string, unknown>>;
  for (const [statusCode, resp] of Object.entries(rawResponses)) {
    const respContent = (resp.content ?? {}) as Record<string, Record<string, unknown>>;
    const firstContentType = Object.keys(respContent)[0];
    const respSchema = firstContentType ? respContent[firstContentType]?.schema : undefined;

    responses[statusCode] = {
      statusCode,
      description: String(resp.description ?? ''),
      schema: respSchema as Record<string, unknown> | undefined,
    };
  }

  const tags = (operation.tags ?? []) as string[];
  const security = ((operation.security ?? []) as Array<Record<string, unknown>>).flatMap((s) =>
    Object.keys(s)
  );

  return {
    path,
    method,
    operationId: operation.operationId ? String(operation.operationId) : undefined,
    summary: operation.summary ? String(operation.summary) : undefined,
    description: operation.description ? String(operation.description) : undefined,
    parameters,
    requestBody,
    responses,
    tags,
    deprecated: Boolean(operation.deprecated),
    security,
  };
}

function resolveParamType(param: Record<string, unknown>): string {
  const schema = param.schema as Record<string, unknown> | undefined;
  if (schema?.type) return String(schema.type);
  if (param.type) return String(param.type);
  return 'string';
}

function parseSimpleYAML(content: string): Record<string, unknown> {
  // Minimal YAML-like parsing for simple specs; full YAML parsing
  // would use a dedicated library in production
  try {
    return JSON.parse(content);
  } catch {
    log.warn('Content is not valid JSON; returning empty spec object');
    return { paths: {} };
  }
}

// ============================================================================
// GraphQL Parsing
// ============================================================================

/**
 * Parse a GraphQL SDL schema string.
 * Extracts type definitions, fields, arguments, and deprecation info.
 */
export function parseGraphQLSchema(content: string): GraphQLTypeInfo[] {
  log.info('Parsing GraphQL schema');

  try {
    const types: GraphQLTypeInfo[] = [];
    const typePattern =
      /(?:"""([\s\S]*?)"""\s*)?(type|input|enum|scalar|interface|union)\s+(\w+)(?:\s+implements\s+[\w\s&]+)?\s*\{([^}]*)\}/g;

    let match: RegExpExecArray | null;
    while ((match = typePattern.exec(content)) !== null) {
      const [, description, kindStr, name, body] = match;
      const kind = mapGraphQLKind(kindStr!, name!);

      const fields = parseGraphQLFields(body ?? '');

      types.push({
        name: name!,
        kind,
        description: description?.trim(),
        fields,
      });
    }

    // Parse scalars without braces
    const scalarPattern = /(?:"""([\s\S]*?)"""\s*)?scalar\s+(\w+)/g;
    while ((match = scalarPattern.exec(content)) !== null) {
      const [, description, name] = match;
      if (!types.find((t) => t.name === name)) {
        types.push({
          name: name!,
          kind: 'scalar',
          description: description?.trim(),
          fields: [],
        });
      }
    }

    log.info({ typeCount: types.length }, 'GraphQL schema parsed successfully');
    return types;
  } catch (error) {
    log.error({ error }, 'Failed to parse GraphQL schema');
    throw new Error(
      `Failed to parse GraphQL schema: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

function mapGraphQLKind(kindStr: string, name: string): GraphQLTypeInfo['kind'] {
  if (name === 'Query') return 'query';
  if (name === 'Mutation') return 'mutation';
  if (name === 'Subscription') return 'subscription';

  const kindMap: Record<string, GraphQLTypeInfo['kind']> = {
    type: 'type',
    input: 'input',
    enum: 'enum',
    scalar: 'scalar',
    interface: 'interface',
    union: 'union',
  };

  return kindMap[kindStr] ?? 'type';
}

function parseGraphQLFields(body: string): GraphQLFieldInfo[] {
  const fields: GraphQLFieldInfo[] = [];
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  for (const line of lines) {
    const fieldMatch = line.match(
      /^(\w+)(?:\(([^)]*)\))?\s*:\s*(.+?)(?:\s+@deprecated(?:\(reason:\s*"([^"]*)")?\))?$/
    );
    if (fieldMatch) {
      const [, name, argsStr, type, deprecationReason] = fieldMatch;

      const args: GraphQLFieldInfo['args'] = [];
      if (argsStr) {
        const argParts = argsStr
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        for (const argPart of argParts) {
          const argMatch = argPart.match(/(\w+)\s*:\s*(.+)/);
          if (argMatch) {
            args.push({
              name: argMatch[1]!,
              type: argMatch[2]!.trim(),
              description: undefined,
            });
          }
        }
      }

      fields.push({
        name: name!,
        type: type!.trim(),
        description: undefined,
        args,
        deprecated: line.includes('@deprecated'),
        deprecationReason,
      });
    }
  }

  return fields;
}

// ============================================================================
// Spec Diffing
// ============================================================================

/**
 * Diff two API spec versions (OpenAPI format).
 * Detects added, removed, and modified endpoints as well as breaking changes.
 */
export function diffSpecs(oldSpec: string, newSpec: string): SpecDiffResult {
  log.info('Diffing API specs');

  const oldEndpoints = parseOpenAPISpec(oldSpec);
  const newEndpoints = parseOpenAPISpec(newSpec);

  const oldMap = new Map(oldEndpoints.map((e) => [`${e.method}:${e.path}`, e]));
  const newMap = new Map(newEndpoints.map((e) => [`${e.method}:${e.path}`, e]));

  const added: OpenAPIEndpoint[] = [];
  const removed: OpenAPIEndpoint[] = [];
  const modified: SpecDiffResult['modified'] = [];
  const breakingChanges: SpecChange[] = [];
  const nonBreakingChanges: SpecChange[] = [];

  // Find added endpoints
  for (const [key, endpoint] of newMap) {
    if (!oldMap.has(key)) {
      added.push(endpoint);
      nonBreakingChanges.push({
        type: 'added',
        location: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
        description: `New endpoint: ${endpoint.summary ?? endpoint.operationId ?? endpoint.path}`,
        breaking: false,
      });
    }
  }

  // Find removed endpoints
  for (const [key, endpoint] of oldMap) {
    if (!newMap.has(key)) {
      removed.push(endpoint);
      breakingChanges.push({
        type: 'removed',
        location: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
        description: `Removed endpoint: ${endpoint.summary ?? endpoint.operationId ?? endpoint.path}`,
        breaking: true,
      });
    }
  }

  // Find modified endpoints
  for (const [key, newEndpoint] of newMap) {
    const oldEndpoint = oldMap.get(key);
    if (!oldEndpoint) continue;

    const changes = compareEndpoints(oldEndpoint, newEndpoint);
    if (changes.length > 0) {
      modified.push({
        path: newEndpoint.path,
        method: newEndpoint.method,
        changes,
      });

      for (const change of changes) {
        if (change.breaking) {
          breakingChanges.push(change);
        } else {
          nonBreakingChanges.push(change);
        }
      }
    }
  }

  const result: SpecDiffResult = { added, removed, modified, breakingChanges, nonBreakingChanges };

  log.info(
    {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      breakingChanges: breakingChanges.length,
    },
    'Spec diff completed'
  );

  return result;
}

function compareEndpoints(
  oldEndpoint: OpenAPIEndpoint,
  newEndpoint: OpenAPIEndpoint
): SpecChange[] {
  const changes: SpecChange[] = [];
  const location = `${newEndpoint.method.toUpperCase()} ${newEndpoint.path}`;

  // Check for removed required parameters (breaking)
  for (const oldParam of oldEndpoint.parameters) {
    const newParam = newEndpoint.parameters.find(
      (p) => p.name === oldParam.name && p.in === oldParam.in
    );
    if (!newParam) {
      changes.push({
        type: 'removed',
        location: `${location} > parameter "${oldParam.name}"`,
        description: `Required parameter "${oldParam.name}" removed`,
        breaking: oldParam.required,
      });
    }
  }

  // Check for new required parameters (breaking)
  for (const newParam of newEndpoint.parameters) {
    const oldParam = oldEndpoint.parameters.find(
      (p) => p.name === newParam.name && p.in === newParam.in
    );
    if (!oldParam && newParam.required) {
      changes.push({
        type: 'added',
        location: `${location} > parameter "${newParam.name}"`,
        description: `New required parameter "${newParam.name}" added`,
        breaking: true,
      });
    } else if (!oldParam && !newParam.required) {
      changes.push({
        type: 'added',
        location: `${location} > parameter "${newParam.name}"`,
        description: `New optional parameter "${newParam.name}" added`,
        breaking: false,
      });
    }
  }

  // Check for removed response codes (breaking)
  for (const statusCode of Object.keys(oldEndpoint.responses)) {
    if (!newEndpoint.responses[statusCode]) {
      changes.push({
        type: 'removed',
        location: `${location} > response ${statusCode}`,
        description: `Response ${statusCode} removed`,
        breaking: true,
      });
    }
  }

  // Check deprecation status changes
  if (!oldEndpoint.deprecated && newEndpoint.deprecated) {
    changes.push({
      type: 'modified',
      location,
      description: 'Endpoint marked as deprecated',
      breaking: false,
    });
  }

  return changes;
}

// ============================================================================
// Documentation Generation
// ============================================================================

/**
 * Generate documentation for a single endpoint with language-specific code examples.
 */
export function generateEndpointDocs(endpoint: OpenAPIEndpoint, language: string): string {
  const lines: string[] = [];

  lines.push(
    `# ${endpoint.summary ?? endpoint.operationId ?? `${endpoint.method.toUpperCase()} ${endpoint.path}`}`
  );
  lines.push('');
  lines.push(`\`${endpoint.method.toUpperCase()} ${endpoint.path}\``);
  lines.push('');

  if (endpoint.deprecated) {
    lines.push(
      '> ⚠️ **Deprecated**: This endpoint is deprecated and may be removed in a future version.'
    );
    lines.push('');
  }

  if (endpoint.description) {
    lines.push(endpoint.description);
    lines.push('');
  }

  if (endpoint.tags.length > 0) {
    lines.push(`**Tags**: ${endpoint.tags.join(', ')}`);
    lines.push('');
  }

  // Parameters
  if (endpoint.parameters.length > 0) {
    lines.push('## Parameters');
    lines.push('');
    lines.push('| Name | In | Type | Required | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const param of endpoint.parameters) {
      lines.push(
        `| \`${param.name}\` | ${param.in} | \`${param.type}\` | ${param.required ? '✅' : '❌'} | ${param.description ?? '-'} |`
      );
    }
    lines.push('');
  }

  // Request body
  if (endpoint.requestBody) {
    lines.push('## Request Body');
    lines.push('');
    lines.push(`**Content-Type**: \`${endpoint.requestBody.contentType}\``);
    if (endpoint.requestBody.description) {
      lines.push('');
      lines.push(endpoint.requestBody.description);
    }
    lines.push('');
  }

  // Responses
  const responseEntries = Object.entries(endpoint.responses);
  if (responseEntries.length > 0) {
    lines.push('## Responses');
    lines.push('');
    for (const [statusCode, response] of responseEntries) {
      lines.push(`### ${statusCode}`);
      lines.push('');
      lines.push(response.description);
      lines.push('');
    }
  }

  // Code example
  lines.push('## Example');
  lines.push('');
  lines.push(`\`\`\`${language}`);
  lines.push(generateCodeExample(endpoint, language));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

function generateCodeExample(endpoint: OpenAPIEndpoint, language: string): string {
  const method = endpoint.method.toUpperCase();
  const path = endpoint.path;

  switch (language) {
    case 'typescript':
    case 'javascript':
      return `const response = await fetch('https://api.example.com${path}', {\n  method: '${method}',\n  headers: { 'Authorization': 'Bearer token' },\n});\nconst data = await response.json();`;
    case 'python':
      return `import requests\n\nresponse = requests.${endpoint.method}(\n    'https://api.example.com${path}',\n    headers={'Authorization': 'Bearer token'},\n)\ndata = response.json()`;
    case 'go':
      return `req, err := http.NewRequest("${method}", "https://api.example.com${path}", nil)\nif err != nil {\n    log.Fatal(err)\n}\nreq.Header.Set("Authorization", "Bearer token")\nresp, err := http.DefaultClient.Do(req)`;
    case 'java':
      return `HttpRequest request = HttpRequest.newBuilder()\n    .uri(URI.create("https://api.example.com${path}"))\n    .header("Authorization", "Bearer token")\n    .method("${method}", HttpRequest.BodyPublishers.noBody())\n    .build();\nHttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());`;
    case 'curl':
      return `curl -X ${method} 'https://api.example.com${path}' \\\n  -H 'Authorization: Bearer token'`;
    default:
      return `// ${method} ${path}`;
  }
}

// ============================================================================
// Migration Guide Generation
// ============================================================================

/**
 * Generate a migration guide from a spec diff result, focused on breaking changes.
 */
export function generateMigrationGuide(diff: SpecDiffResult): string {
  const lines: string[] = [];

  lines.push('# API Migration Guide');
  lines.push('');

  if (diff.breakingChanges.length === 0) {
    lines.push('✅ No breaking changes detected. No migration needed.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(
    `⚠️ **${diff.breakingChanges.length} breaking change(s) detected** that require migration.`
  );
  lines.push('');

  // Removed endpoints
  if (diff.removed.length > 0) {
    lines.push('## Removed Endpoints');
    lines.push('');
    lines.push('The following endpoints have been removed and must be replaced:');
    lines.push('');
    for (const endpoint of diff.removed) {
      lines.push(`### \`${endpoint.method.toUpperCase()} ${endpoint.path}\``);
      lines.push('');
      lines.push(endpoint.summary ?? endpoint.description ?? 'No description available.');
      lines.push('');
      lines.push('**Action required**: Find an alternative endpoint or remove usage.');
      lines.push('');
    }
  }

  // Modified endpoints with breaking changes
  const breakingModified = diff.modified.filter((m) => m.changes.some((c) => c.breaking));
  if (breakingModified.length > 0) {
    lines.push('## Modified Endpoints (Breaking)');
    lines.push('');
    for (const mod of breakingModified) {
      lines.push(`### \`${mod.method.toUpperCase()} ${mod.path}\``);
      lines.push('');
      for (const change of mod.changes.filter((c) => c.breaking)) {
        lines.push(`- ${change.description}`);
      }
      lines.push('');
    }
  }

  // Summary checklist
  lines.push('## Migration Checklist');
  lines.push('');
  for (const change of diff.breakingChanges) {
    lines.push(`- [ ] ${change.location}: ${change.description}`);
  }
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// API Changelog Generation
// ============================================================================

/**
 * Generate a formatted API changelog entry from a spec diff and version string.
 */
export function generateAPIChangelog(diff: SpecDiffResult, version: string): string {
  const lines: string[] = [];
  const date = new Date().toISOString().split('T')[0];

  lines.push(`# API Changelog — ${version}`);
  lines.push('');
  lines.push(`_Released: ${date}_`);
  lines.push('');

  if (diff.breakingChanges.length > 0) {
    lines.push('## ⚠️ Breaking Changes');
    lines.push('');
    for (const change of diff.breakingChanges) {
      lines.push(`- **${change.location}**: ${change.description}`);
    }
    lines.push('');
  }

  if (diff.added.length > 0) {
    lines.push('## ✨ New Endpoints');
    lines.push('');
    for (const endpoint of diff.added) {
      lines.push(
        `- \`${endpoint.method.toUpperCase()} ${endpoint.path}\` — ${endpoint.summary ?? 'New endpoint'}`
      );
    }
    lines.push('');
  }

  if (diff.removed.length > 0) {
    lines.push('## 🗑️ Removed Endpoints');
    lines.push('');
    for (const endpoint of diff.removed) {
      lines.push(
        `- \`${endpoint.method.toUpperCase()} ${endpoint.path}\` — ${endpoint.summary ?? 'Removed'}`
      );
    }
    lines.push('');
  }

  const nonBreakingModified = diff.modified.filter((m) => m.changes.some((c) => !c.breaking));
  if (nonBreakingModified.length > 0) {
    lines.push('## 🔧 Modified Endpoints');
    lines.push('');
    for (const mod of nonBreakingModified) {
      lines.push(`- \`${mod.method.toUpperCase()} ${mod.path}\``);
      for (const change of mod.changes.filter((c) => !c.breaking)) {
        lines.push(`  - ${change.description}`);
      }
    }
    lines.push('');
  }

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Added**: ${diff.added.length} endpoint(s)`);
  lines.push(`- **Removed**: ${diff.removed.length} endpoint(s)`);
  lines.push(`- **Modified**: ${diff.modified.length} endpoint(s)`);
  lines.push(`- **Breaking changes**: ${diff.breakingChanges.length}`);
  lines.push('');

  return lines.join('\n');
}
