/**
 * Breaking Change Detection Service
 *
 * Provides sophisticated static analysis for detecting API breaking changes
 * by comparing function signatures, interfaces, types, and exports.
 */

import { createLogger, getAnthropicClient } from '@docsynth/utils';

const log = createLogger('breaking-change-service');

// ============================================================================
// Types
// ============================================================================

export interface FunctionSignature {
  name: string;
  params: Array<{ name: string; type: string; optional: boolean }>;
  returnType: string;
  exported: boolean;
  async: boolean;
  lineNumber: number;
}

export interface InterfaceDefinition {
  name: string;
  properties: Array<{ name: string; type: string; optional: boolean }>;
  methods: FunctionSignature[];
  extends: string[];
  exported: boolean;
  lineNumber: number;
}

export interface TypeDefinition {
  name: string;
  definition: string;
  exported: boolean;
  lineNumber: number;
}

export interface ApiSurface {
  functions: FunctionSignature[];
  interfaces: InterfaceDefinition[];
  types: TypeDefinition[];
  exports: string[];
  filePath: string;
}

export type BreakingChangeType =
  | 'function_removed'
  | 'function_signature_changed'
  | 'parameter_added_required'
  | 'parameter_removed'
  | 'parameter_type_changed'
  | 'return_type_changed'
  | 'interface_removed'
  | 'interface_property_removed'
  | 'interface_property_type_changed'
  | 'interface_property_required'
  | 'type_removed'
  | 'type_changed'
  | 'export_removed';

export interface BreakingChange {
  type: BreakingChangeType;
  name: string;
  description: string;
  filePath: string;
  lineNumber: number;
  severity: 'critical' | 'major' | 'minor';
  previousValue?: string;
  currentValue?: string;
  migrationHint?: string;
  affectedDocumentation?: string[];
}

export interface BreakingChangeReport {
  hasBreakingChanges: boolean;
  breakingChanges: BreakingChange[];
  nonBreakingChanges: Array<{
    type: string;
    name: string;
    description: string;
    filePath: string;
    lineNumber: number;
  }>;
  suggestedVersionBump: 'major' | 'minor' | 'patch' | 'none';
  affectedDocumentation: string[];
  migrationGuide?: string;
}

// ============================================================================
// Parsing Functions (Regex-based for simplicity, could use TypeScript compiler API)
// ============================================================================

function extractFunctionSignatures(code: string, _filePath: string): FunctionSignature[] {
  const functions: FunctionSignature[] = [];

  // Match exported functions - simpler pattern
  const funcPattern = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{/g;

  let match;
  while ((match = funcPattern.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length;
    const isAsync = !!match[1];
    const name = match[2] || 'unknown';
    const paramsStr = match[3] || '';
    const returnType = (match[4] || 'void').trim();

    const params = parseParameters(paramsStr);

    functions.push({
      name,
      params,
      returnType,
      exported: true,
      async: isAsync,
      lineNumber,
    });
  }

  // Match arrow functions
  const arrowPattern = /export\s+const\s+(\w+)\s*=\s*(async\s*)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/g;

  while ((match = arrowPattern.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length;
    const name = match[1] || 'unknown';
    const isAsync = !!match[2];
    const paramsStr = match[3] || '';
    const returnType = (match[4] || 'void').trim();

    const params = parseParameters(paramsStr);

    functions.push({
      name,
      params,
      returnType,
      exported: true,
      async: isAsync,
      lineNumber,
    });
  }

  return functions;
}

function parseParameters(paramsStr: string): Array<{ name: string; type: string; optional: boolean }> {
  if (!paramsStr.trim()) return [];

  const params: Array<{ name: string; type: string; optional: boolean }> = [];

  // Split by comma, handling nested types
  let depth = 0;
  let current = '';
  for (const char of paramsStr) {
    if (char === '<' || char === '(' || char === '{' || char === '[') depth++;
    else if (char === '>' || char === ')' || char === '}' || char === ']') depth--;
    else if (char === ',' && depth === 0) {
      if (current.trim()) params.push(parseParam(current.trim()));
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) params.push(parseParam(current.trim()));

  return params;
}

function parseParam(param: string): { name: string; type: string; optional: boolean } {
  const optional = param.includes('?');
  const parts = param.split(':');
  const name = (parts[0] || 'param').replace('?', '').trim();
  const type = (parts[1] || 'unknown').trim();

  return { name, type, optional };
}

function extractInterfaces(code: string, _filePath: string): InterfaceDefinition[] {
  const interfaces: InterfaceDefinition[] = [];

  // Match exported interfaces
  const interfacePattern = /export\s+interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;

  let match;
  while ((match = interfacePattern.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length;
    const name = match[1] || 'unknown';
    const extendsStr = match[2] || '';
    const bodyStr = match[3] || '';

    const extends_ = extendsStr.split(',').map(e => e.trim()).filter(Boolean);
    const { properties, methods } = parseInterfaceBody(bodyStr);

    interfaces.push({
      name,
      properties,
      methods,
      extends: extends_,
      exported: true,
      lineNumber,
    });
  }

  return interfaces;
}

function parseInterfaceBody(body: string): {
  properties: Array<{ name: string; type: string; optional: boolean }>;
  methods: FunctionSignature[];
} {
  const properties: Array<{ name: string; type: string; optional: boolean }> = [];
  const methods: FunctionSignature[] = [];

  // Simple property matching
  const propertyPattern = /(\w+)(\?)?:\s*([^;]+);/g;

  let match;
  while ((match = propertyPattern.exec(body)) !== null) {
    // Skip if it's a method
    const typeValue = match[3] || '';
    if (typeValue.includes('=>')) continue;

    properties.push({
      name: match[1] || 'prop',
      type: typeValue.trim(),
      optional: !!match[2],
    });
  }

  return { properties, methods };
}

function extractTypes(code: string, _filePath: string): TypeDefinition[] {
  const types: TypeDefinition[] = [];

  // Match exported type aliases
  const typePattern = /export\s+type\s+(\w+)(?:<[^>]+>)?\s*=\s*([^;]+);/g;

  let match;
  while ((match = typePattern.exec(code)) !== null) {
    const lineNumber = code.substring(0, match.index).split('\n').length;

    types.push({
      name: match[1] || 'unknown',
      definition: (match[2] || '').trim(),
      exported: true,
      lineNumber,
    });
  }

  return types;
}

function extractExports(code: string): string[] {
  const exports: string[] = [];

  // Match re-exports
  const reexportPattern = /export\s+\{\s*([^}]+)\s*\}/g;
  let match;
  while ((match = reexportPattern.exec(code)) !== null) {
    const content = match[1] || '';
    const names = content.split(',').map(e => e.split(' as ')[0]?.trim() || '').filter(Boolean);
    exports.push(...names);
  }

  return exports;
}

// ============================================================================
// API Surface Analysis
// ============================================================================

export function parseApiSurface(code: string, filePath: string): ApiSurface {
  return {
    functions: extractFunctionSignatures(code, filePath),
    interfaces: extractInterfaces(code, filePath),
    types: extractTypes(code, filePath),
    exports: extractExports(code),
    filePath,
  };
}

// ============================================================================
// Breaking Change Detection
// ============================================================================

export function detectBreakingChanges(
  oldSurface: ApiSurface,
  newSurface: ApiSurface
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Check removed functions
  for (const oldFunc of oldSurface.functions) {
    const newFunc = newSurface.functions.find(f => f.name === oldFunc.name);

    if (!newFunc) {
      changes.push({
        type: 'function_removed',
        name: oldFunc.name,
        description: `Exported function '${oldFunc.name}' was removed`,
        filePath: oldSurface.filePath,
        lineNumber: oldFunc.lineNumber,
        severity: 'critical',
        previousValue: formatFunctionSignature(oldFunc),
        migrationHint: `Remove usage of '${oldFunc.name}' or find a replacement`,
      });
      continue;
    }

    // Check parameter changes
    const paramChanges = detectParameterChanges(oldFunc, newFunc, oldSurface.filePath);
    changes.push(...paramChanges);

    // Check return type changes
    if (normalizeType(oldFunc.returnType) !== normalizeType(newFunc.returnType)) {
      changes.push({
        type: 'return_type_changed',
        name: oldFunc.name,
        description: `Return type of '${oldFunc.name}' changed from '${oldFunc.returnType}' to '${newFunc.returnType}'`,
        filePath: oldSurface.filePath,
        lineNumber: newFunc.lineNumber,
        severity: 'major',
        previousValue: oldFunc.returnType,
        currentValue: newFunc.returnType,
        migrationHint: `Update code that depends on '${oldFunc.name}' return value`,
      });
    }
  }

  // Check removed interfaces
  for (const oldIface of oldSurface.interfaces) {
    const newIface = newSurface.interfaces.find(i => i.name === oldIface.name);

    if (!newIface) {
      changes.push({
        type: 'interface_removed',
        name: oldIface.name,
        description: `Exported interface '${oldIface.name}' was removed`,
        filePath: oldSurface.filePath,
        lineNumber: oldIface.lineNumber,
        severity: 'critical',
        migrationHint: `Remove usage of '${oldIface.name}' interface or find a replacement`,
      });
      continue;
    }

    // Check property changes
    const propChanges = detectInterfacePropertyChanges(oldIface, newIface, oldSurface.filePath);
    changes.push(...propChanges);
  }

  // Check removed types
  for (const oldType of oldSurface.types) {
    const newType = newSurface.types.find(t => t.name === oldType.name);

    if (!newType) {
      changes.push({
        type: 'type_removed',
        name: oldType.name,
        description: `Exported type '${oldType.name}' was removed`,
        filePath: oldSurface.filePath,
        lineNumber: oldType.lineNumber,
        severity: 'critical',
        previousValue: oldType.definition,
        migrationHint: `Remove usage of '${oldType.name}' type or find a replacement`,
      });
    } else if (normalizeType(oldType.definition) !== normalizeType(newType.definition)) {
      changes.push({
        type: 'type_changed',
        name: oldType.name,
        description: `Definition of type '${oldType.name}' changed`,
        filePath: oldSurface.filePath,
        lineNumber: newType.lineNumber,
        severity: 'major',
        previousValue: oldType.definition,
        currentValue: newType.definition,
        migrationHint: `Review usage of '${oldType.name}' for compatibility`,
      });
    }
  }

  return changes;
}

function detectParameterChanges(
  oldFunc: FunctionSignature,
  newFunc: FunctionSignature,
  filePath: string
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Check removed parameters
  for (const oldParam of oldFunc.params) {
    const newParam = newFunc.params.find(p => p.name === oldParam.name);

    if (!newParam) {
      changes.push({
        type: 'parameter_removed',
        name: `${oldFunc.name}.${oldParam.name}`,
        description: `Parameter '${oldParam.name}' was removed from '${oldFunc.name}'`,
        filePath,
        lineNumber: newFunc.lineNumber,
        severity: 'major',
        previousValue: `${oldParam.name}: ${oldParam.type}`,
        migrationHint: `Remove '${oldParam.name}' argument when calling '${oldFunc.name}'`,
      });
    } else if (normalizeType(oldParam.type) !== normalizeType(newParam.type)) {
      changes.push({
        type: 'parameter_type_changed',
        name: `${oldFunc.name}.${oldParam.name}`,
        description: `Type of parameter '${oldParam.name}' in '${oldFunc.name}' changed from '${oldParam.type}' to '${newParam.type}'`,
        filePath,
        lineNumber: newFunc.lineNumber,
        severity: 'major',
        previousValue: oldParam.type,
        currentValue: newParam.type,
        migrationHint: `Update '${oldParam.name}' argument type when calling '${oldFunc.name}'`,
      });
    }
  }

  // Check for new required parameters
  for (const newParam of newFunc.params) {
    const oldParam = oldFunc.params.find(p => p.name === newParam.name);

    if (!oldParam && !newParam.optional) {
      changes.push({
        type: 'parameter_added_required',
        name: `${oldFunc.name}.${newParam.name}`,
        description: `New required parameter '${newParam.name}' added to '${oldFunc.name}'`,
        filePath,
        lineNumber: newFunc.lineNumber,
        severity: 'major',
        currentValue: `${newParam.name}: ${newParam.type}`,
        migrationHint: `Add '${newParam.name}' argument when calling '${oldFunc.name}'`,
      });
    }
  }

  return changes;
}

function detectInterfacePropertyChanges(
  oldIface: InterfaceDefinition,
  newIface: InterfaceDefinition,
  filePath: string
): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Check removed properties
  for (const oldProp of oldIface.properties) {
    const newProp = newIface.properties.find(p => p.name === oldProp.name);

    if (!newProp) {
      changes.push({
        type: 'interface_property_removed',
        name: `${oldIface.name}.${oldProp.name}`,
        description: `Property '${oldProp.name}' was removed from interface '${oldIface.name}'`,
        filePath,
        lineNumber: newIface.lineNumber,
        severity: 'major',
        previousValue: `${oldProp.name}: ${oldProp.type}`,
        migrationHint: `Remove '${oldProp.name}' from objects implementing '${oldIface.name}'`,
      });
    } else if (normalizeType(oldProp.type) !== normalizeType(newProp.type)) {
      changes.push({
        type: 'interface_property_type_changed',
        name: `${oldIface.name}.${oldProp.name}`,
        description: `Type of property '${oldProp.name}' in '${oldIface.name}' changed from '${oldProp.type}' to '${newProp.type}'`,
        filePath,
        lineNumber: newIface.lineNumber,
        severity: 'major',
        previousValue: oldProp.type,
        currentValue: newProp.type,
        migrationHint: `Update type of '${oldProp.name}' in objects implementing '${oldIface.name}'`,
      });
    } else if (oldProp.optional && !newProp.optional) {
      changes.push({
        type: 'interface_property_required',
        name: `${oldIface.name}.${oldProp.name}`,
        description: `Property '${oldProp.name}' in '${oldIface.name}' changed from optional to required`,
        filePath,
        lineNumber: newIface.lineNumber,
        severity: 'major',
        previousValue: `${oldProp.name}?: ${oldProp.type}`,
        currentValue: `${oldProp.name}: ${newProp.type}`,
        migrationHint: `Ensure '${oldProp.name}' is provided in all objects implementing '${oldIface.name}'`,
      });
    }
  }

  return changes;
}

function normalizeType(type: string): string {
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function formatFunctionSignature(func: FunctionSignature): string {
  const params = func.params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');
  return `${func.async ? 'async ' : ''}function ${func.name}(${params}): ${func.returnType}`;
}

// ============================================================================
// Documentation Impact Analysis
// ============================================================================

export async function analyzeDocumentationImpact(
  changes: BreakingChange[],
  existingDocs: Array<{ path: string; content: string; type: string }>
): Promise<string[]> {
  const affectedDocs: string[] = [];

  for (const change of changes) {
    // Search for mentions in documentation
    for (const doc of existingDocs) {
      const nameParts = change.name.split('.');
      const searchTerms = [change.name, ...nameParts];

      for (const term of searchTerms) {
        if (doc.content.includes(term)) {
          if (!affectedDocs.includes(doc.path)) {
            affectedDocs.push(doc.path);
          }
          break;
        }
      }
    }
  }

  return affectedDocs;
}

// ============================================================================
// AI-Enhanced Breaking Change Analysis
// ============================================================================

export async function analyzeBreakingChangesWithAI(
  oldCode: string,
  newCode: string,
  filePath: string,
  context?: { prTitle?: string; prBody?: string }
): Promise<BreakingChangeReport> {
  const anthropic = getAnthropicClient();

  // First do static analysis
  const oldSurface = parseApiSurface(oldCode, filePath);
  const newSurface = parseApiSurface(newCode, filePath);
  const staticChanges = detectBreakingChanges(oldSurface, newSurface);

  // If no AI available, return static analysis only
  if (!anthropic) {
    const hasBreaking = staticChanges.length > 0;
    return {
      hasBreakingChanges: hasBreaking,
      breakingChanges: staticChanges,
      nonBreakingChanges: [],
      suggestedVersionBump: hasBreaking ? 'major' : 'patch',
      affectedDocumentation: [],
    };
  }

  // Use AI to enhance analysis
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Analyze these code changes for breaking API changes and behavioral changes that static analysis might miss.

File: ${filePath}
${context?.prTitle ? `PR Title: ${context.prTitle}` : ''}
${context?.prBody ? `PR Description: ${context.prBody}` : ''}

OLD CODE:
\`\`\`
${oldCode.slice(0, 3000)}
\`\`\`

NEW CODE:
\`\`\`
${newCode.slice(0, 3000)}
\`\`\`

STATIC ANALYSIS FOUND:
${staticChanges.length > 0 ? staticChanges.map(c => `- ${c.type}: ${c.description}`).join('\n') : 'No breaking changes detected by static analysis'}

Identify any additional breaking changes the static analysis missed, especially:
1. Behavioral changes (same signature, different behavior)
2. Error handling changes
3. Default value changes
4. Side effect changes

Also identify non-breaking changes (new features, improvements).

Return JSON:
{
  "additionalBreaking": [{ "type": "behavior_change|default_changed|error_changed", "name": "...", "description": "...", "severity": "critical|major|minor", "migrationHint": "..." }],
  "nonBreaking": [{ "type": "new_feature|improvement|refactor", "name": "...", "description": "..." }],
  "migrationGuide": "Markdown migration guide if there are breaking changes"
}`,
        },
      ],
    });

    const content = response.content[0];
    if (content?.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const aiResult = JSON.parse(jsonMatch[0]);

        // Merge AI findings with static analysis
        const additionalChanges: BreakingChange[] = (aiResult.additionalBreaking || []).map((c: { type: string; name: string; description: string; severity: 'critical' | 'major' | 'minor'; migrationHint?: string }) => ({
          type: c.type as BreakingChangeType,
          name: c.name,
          description: c.description,
          filePath,
          lineNumber: 0,
          severity: c.severity,
          migrationHint: c.migrationHint,
        }));

        const allBreaking = [...staticChanges, ...additionalChanges];
        const hasBreaking = allBreaking.length > 0;

        return {
          hasBreakingChanges: hasBreaking,
          breakingChanges: allBreaking,
          nonBreakingChanges: (aiResult.nonBreaking || []).map((c: { type: string; name: string; description: string }) => ({
            type: c.type,
            name: c.name,
            description: c.description,
            filePath,
            lineNumber: 0,
          })),
          suggestedVersionBump: hasBreaking ? 'major' :
            (aiResult.nonBreaking?.length > 0 ? 'minor' : 'patch'),
          affectedDocumentation: [],
          migrationGuide: aiResult.migrationGuide,
        };
      }
    }
  } catch (error) {
    log.error({ error }, 'AI breaking change analysis failed, using static analysis only');
  }

  // Fallback to static analysis only
  const hasBreaking = staticChanges.length > 0;
  return {
    hasBreakingChanges: hasBreaking,
    breakingChanges: staticChanges,
    nonBreakingChanges: [],
    suggestedVersionBump: hasBreaking ? 'major' : 'patch',
    affectedDocumentation: [],
  };
}

// ============================================================================
// Exports
// ============================================================================

export function getBreakingChangeService() {
  return {
    parseApiSurface,
    detectBreakingChanges,
    analyzeDocumentationImpact,
    analyzeBreakingChangesWithAI,
  };
}
