/**
 * DocQL Query Language Service
 *
 * Provides a SQL-like query language for querying documentation metadata.
 * Supports filtering, ordering, aggregation, validation, and scheduled alerts.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-ql-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface WhereClause {
  field: string;
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not';
  value: string | number | boolean;
}

export interface OrderClause {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ParsedQuery {
  select: string[];
  where: WhereClause[];
  orderBy?: OrderClause;
  limit?: number;
  aggregation?: string;
}

export interface DocQLQuery {
  raw: string;
  parsed: ParsedQuery;
}

export interface QueryResult {
  query: string;
  results: Record<string, unknown>[];
  totalCount: number;
  executionTimeMs: number;
  metadata: Record<string, unknown>;
}

export interface ScheduledAlert {
  id: string;
  query: string;
  channel: string;
  threshold: number;
  repositoryId: string;
  active: boolean;
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Parse and execute a DocQL query against organization documentation.
 */
export async function executeQuery(
  organizationId: string,
  query: string,
  repositoryId?: string
): Promise<QueryResult> {
  log.info({ organizationId, query, repositoryId }, 'Executing DocQL query');
  const startTime = Date.now();
  const parsed = parseDocQL(query);

  if (!parsed) {
    return {
      query,
      results: [],
      totalCount: 0,
      executionTimeMs: Date.now() - startTime,
      metadata: { error: 'Failed to parse query' },
    };
  }

  const prismaFilter = buildPrismaFilter(parsed.where);
  const scopeFilter: Record<string, unknown> = {
    ...prismaFilter,
    repository: { organizationId, ...(repositoryId ? { id: repositoryId } : {}) },
  };

  try {
    const documents = await db.document.findMany({
      where: scopeFilter,
      orderBy: parsed.orderBy
        ? { [parsed.orderBy.field]: parsed.orderBy.direction }
        : { updatedAt: 'desc' },
      take: parsed.limit ?? 100,
      include: { repository: { select: { name: true } } },
    });

    let results = documents.map((doc: Record<string, unknown>) =>
      projectFields(doc, parsed.select)
    );
    if (parsed.aggregation) results = applyAggregation(results, parsed.aggregation);

    const executionTimeMs = Date.now() - startTime;
    try {
      await db.queryLog.create({
        data: {
          organizationId,
          query,
          resultCount: results.length,
          executionTimeMs,
          executedAt: new Date(),
        },
      });
    } catch {
      /* non-critical */
    }

    log.info({ organizationId, resultCount: results.length, executionTimeMs }, 'Query executed');
    return {
      query,
      results,
      totalCount: results.length,
      executionTimeMs,
      metadata: { parsed, scoped: !!repositoryId },
    };
  } catch (error) {
    log.error({ error, query }, 'Query execution failed');
    return {
      query,
      results: [],
      totalCount: 0,
      executionTimeMs: Date.now() - startTime,
      metadata: { error: 'Query execution failed' },
    };
  }
}

/**
 * Validate a DocQL query without executing it.
 */
export async function validateQuery(
  query: string
): Promise<{ valid: boolean; errors: string[]; parsed?: ParsedQuery }> {
  log.info({ query }, 'Validating DocQL query');
  const errors: string[] = [];

  if (!query?.trim()) {
    errors.push('Query cannot be empty');
    return { valid: false, errors };
  }
  const upper = query.trim().toUpperCase();
  if (!upper.startsWith('SELECT') && !upper.startsWith('FIND') && !upper.startsWith('COUNT')) {
    errors.push('Query must start with SELECT, FIND, or COUNT');
  }

  const parsed = parseDocQL(query);
  if (!parsed) {
    errors.push('Failed to parse query syntax');
    return { valid: false, errors };
  }

  const allowed = [
    'title',
    'path',
    'filePath',
    'type',
    'status',
    'quality',
    'coverage',
    'staleness',
    'lastUpdated',
    'createdAt',
    'updatedAt',
    'wordCount',
    'linkCount',
    'author',
    'repository',
    'tags',
  ];
  for (const f of parsed.select) {
    if (f !== '*' && !allowed.includes(f)) errors.push(`Unknown field: "${f}"`);
  }
  for (const c of parsed.where) {
    if (!allowed.includes(c.field)) errors.push(`Unknown filter field: "${c.field}"`);
  }

  const validAggs = ['count', 'avg', 'sum', 'min', 'max', 'group_by'];
  if (parsed.aggregation && !validAggs.includes(parsed.aggregation))
    errors.push(`Unknown aggregation: "${parsed.aggregation}"`);

  return { valid: errors.length === 0, errors, parsed: errors.length === 0 ? parsed : undefined };
}

/**
 * Create a scheduled alert that runs a query periodically.
 */
export async function createAlert(
  organizationId: string,
  query: string,
  channel: string,
  threshold: number
): Promise<ScheduledAlert> {
  log.info({ organizationId, channel, threshold }, 'Creating DocQL alert');
  const validation = await validateQuery(query);
  if (!validation.valid) throw new Error(`Invalid query: ${validation.errors.join('; ')}`);

  const alert = await db.docQLAlert.create({
    data: { organizationId, query, channel, threshold, active: true, createdAt: new Date() },
  });
  log.info({ alertId: alert.id }, 'DocQL alert created');
  return { id: alert.id, query, channel, threshold, repositoryId: organizationId, active: true };
}

/**
 * List all active alerts for an organization.
 */
export async function listAlerts(organizationId: string): Promise<ScheduledAlert[]> {
  log.info({ organizationId }, 'Listing DocQL alerts');
  const alerts = await db.docQLAlert.findMany({
    where: { organizationId, active: true },
    orderBy: { createdAt: 'desc' },
  });
  return alerts.map(
    (a: {
      id: string;
      query: string;
      channel: string;
      threshold: number;
      organizationId: string;
      active: boolean;
    }) => ({
      id: a.id,
      query: a.query,
      channel: a.channel,
      threshold: a.threshold,
      repositoryId: a.organizationId,
      active: a.active,
    })
  );
}

/**
 * Delete a scheduled alert by ID.
 */
export async function deleteAlert(alertId: string): Promise<void> {
  log.info({ alertId }, 'Deleting DocQL alert');
  await db.docQLAlert.update({
    where: { id: alertId },
    data: { active: false, deletedAt: new Date() },
  });
  log.info({ alertId }, 'DocQL alert deleted');
}

/**
 * Return a list of suggested/template DocQL queries.
 */
export function getSuggestedQueries(): string[] {
  return [
    'SELECT title, path, staleness WHERE staleness gt 30 ORDER BY staleness desc',
    'SELECT path, coverage WHERE coverage lt 50 ORDER BY coverage asc',
    'COUNT * WHERE status eq "draft"',
    'SELECT title, path WHERE type eq "api" AND quality lt 70',
    'SELECT path, lastUpdated WHERE lastUpdated lt "2024-01-01" LIMIT 20',
    'SELECT repository, COUNT(*) GROUP BY repository ORDER BY count desc',
    'FIND * WHERE tags contains "deprecated" AND status not "archived"',
    'SELECT title, wordCount WHERE wordCount gt 5000 ORDER BY wordCount desc LIMIT 10',
  ];
}

// ============================================================================
// Helpers
// ============================================================================

function parseDocQL(raw: string): ParsedQuery | null {
  try {
    const trimmed = raw.trim();
    const parsed: ParsedQuery = { select: [], where: [] };

    if (trimmed.toUpperCase().startsWith('COUNT')) parsed.aggregation = 'count';

    const selMatch = trimmed.match(
      /^(?:SELECT|FIND|COUNT)\s+(.+?)(?:\s+WHERE\s+|\s+ORDER\s+|\s+GROUP\s+|\s+LIMIT\s+|$)/i
    );
    if (selMatch) {
      const f = selMatch[1]!.trim();
      parsed.select =
        f === '*'
          ? ['*']
          : f
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
    } else {
      parsed.select = ['*'];
    }

    const whereMatch = trimmed.match(/WHERE\s+(.+?)(?:\s+ORDER\s+|\s+GROUP\s+|\s+LIMIT\s+|$)/i);
    if (whereMatch) {
      for (const cond of whereMatch[1]!.split(/\s+AND\s+/i)) {
        const c = parseWhereCondition(cond.trim());
        if (c) parsed.where.push(c);
      }
    }

    const orderMatch = trimmed.match(/ORDER\s+BY\s+(\w+)\s*(asc|desc)?/i);
    if (orderMatch)
      parsed.orderBy = {
        field: orderMatch[1]!,
        direction: (orderMatch[2]?.toLowerCase() as 'asc' | 'desc') ?? 'asc',
      };

    const limitMatch = trimmed.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) parsed.limit = parseInt(limitMatch[1]!, 10);

    if (/GROUP\s+BY/i.test(trimmed)) parsed.aggregation = 'group_by';
    return parsed;
  } catch (error) {
    log.warn({ error, raw }, 'Failed to parse DocQL query');
    return null;
  }
}

function parseWhereCondition(condition: string): WhereClause | null {
  const ops: Array<{ kw: string; op: WhereClause['operator'] }> = [
    { kw: 'gte', op: 'gte' },
    { kw: 'lte', op: 'lte' },
    { kw: 'gt', op: 'gt' },
    { kw: 'lt', op: 'lt' },
    { kw: 'contains', op: 'contains' },
    { kw: 'not', op: 'not' },
    { kw: 'eq', op: 'eq' },
  ];
  for (const { kw, op } of ops) {
    const m = condition.match(new RegExp(`^(\\w+)\\s+${kw}\\s+(.+)$`, 'i'));
    if (m) {
      const raw = m[2]!.trim().replace(/^["']|["']$/g, '');
      let value: string | number | boolean = raw;
      if (raw === 'true') value = true;
      else if (raw === 'false') value = false;
      else if (/^\d+(\.\d+)?$/.test(raw)) value = parseFloat(raw);
      return { field: m[1]!, operator: op, value };
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _evaluateWhereClause(doc: Record<string, unknown>, clause: WhereClause): boolean {
  const v = doc[clause.field];
  switch (clause.operator) {
    case 'eq':
      return v === clause.value;
    case 'not':
      return v !== clause.value;
    case 'gt':
      return typeof v === 'number' && v > (clause.value as number);
    case 'lt':
      return typeof v === 'number' && v < (clause.value as number);
    case 'gte':
      return typeof v === 'number' && v >= (clause.value as number);
    case 'lte':
      return typeof v === 'number' && v <= (clause.value as number);
    case 'contains':
      return typeof v === 'string' && v.includes(String(clause.value));
    default:
      return false;
  }
}

function applyAggregation(
  results: Record<string, unknown>[],
  agg: string
): Record<string, unknown>[] {
  if (agg === 'count') return [{ count: results.length }];
  if (agg === 'group_by') {
    const groups = new Map<string, number>();
    for (const r of results) {
      const k = String(r[Object.keys(r)[0]!] ?? 'unknown');
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    return [...groups.entries()].map(([group, count]) => ({ group, count }));
  }
  if (agg === 'avg' || agg === 'sum' || agg === 'min' || agg === 'max') {
    const numField = Object.keys(results[0] ?? {}).find((k) => typeof results[0]![k] === 'number');
    if (!numField) return [{ [agg]: 0 }];
    const vals = results.map((r) => Number(r[numField]) || 0);
    if (agg === 'sum') return [{ field: numField, sum: vals.reduce((a, b) => a + b, 0) }];
    if (agg === 'avg')
      return [
        { field: numField, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 },
      ];
    if (agg === 'min') return [{ field: numField, min: Math.min(...vals) }];
    return [{ field: numField, max: Math.max(...vals) }];
  }
  return results;
}

function buildPrismaFilter(clauses: WhereClause[]): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const c of clauses) {
    switch (c.operator) {
      case 'eq':
        filter[c.field] = c.value;
        break;
      case 'not':
        filter[c.field] = { not: c.value };
        break;
      case 'gt':
        filter[c.field] = { gt: c.value };
        break;
      case 'lt':
        filter[c.field] = { lt: c.value };
        break;
      case 'gte':
        filter[c.field] = { gte: c.value };
        break;
      case 'lte':
        filter[c.field] = { lte: c.value };
        break;
      case 'contains':
        filter[c.field] = { contains: String(c.value) };
        break;
    }
  }
  return filter;
}

function projectFields(doc: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  if (fields.length === 1 && fields[0] === '*') return doc;
  const projected: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in doc) projected[f] = doc[f];
  }
  return projected;
}
