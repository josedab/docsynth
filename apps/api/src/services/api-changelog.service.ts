/**
 * API Changelog & Breaking Change Alerts Service
 *
 * Provides automated API changelog generation, breaking change detection,
 * and subscriber notification for API evolution tracking.
 */

import { prisma } from '@docsynth/database';
import { createLogger, generateId } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const log = createLogger('api-changelog-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface EndpointChange {
  method: string;
  path: string;
  description: string;
  oldSpec?: Record<string, unknown>;
  newSpec?: Record<string, unknown>;
  breaking: boolean;
}

export interface SchemaChange {
  schemaName: string;
  changeType: 'added' | 'modified' | 'removed';
  details: string;
  breaking: boolean;
}

export interface BreakingChange {
  type: 'endpoint_removed' | 'field_removed' | 'type_changed' | 'auth_changed' | 'response_changed';
  path: string;
  description: string;
  migrationHint: string;
}

export interface APIChangeAnalysis {
  repositoryId: string;
  baseRef: string;
  headRef: string;
  timestamp: Date;
  addedEndpoints: EndpointChange[];
  modifiedEndpoints: EndpointChange[];
  deprecatedEndpoints: EndpointChange[];
  removedEndpoints: EndpointChange[];
  schemaChanges: SchemaChange[];
  breakingChanges: BreakingChange[];
  summary: string;
}

export interface ChangelogEntry {
  id: string;
  repositoryId: string;
  version: string;
  content: string;
  analysis: APIChangeAnalysis;
  publishedTo: string[];
  createdAt: Date;
}

export interface AlertSubscriber {
  id: string;
  repositoryId: string;
  webhook?: string;
  email?: string;
  slackChannel?: string;
  createdAt: Date;
}

// ============================================================================
// Service
// ============================================================================

class APIChangelogService {
  /**
   * Compare API specs between two refs to produce a detailed change analysis.
   */
  async analyzeAPIChanges(
    repositoryId: string,
    baseRef: string,
    headRef: string,
    specPath?: string
  ): Promise<APIChangeAnalysis> {
    log.info({ repositoryId, baseRef, headRef, specPath }, 'Analyzing API changes');

    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    // Resolve the spec path or use the repository default
    const resolvedSpecPath = specPath || 'openapi.yaml';

    // Fetch specs at each ref from stored snapshots
    const baseSnapshot = await db.apiSpecSnapshot.findFirst({
      where: { repositoryId, ref: baseRef, specPath: resolvedSpecPath },
      orderBy: { createdAt: 'desc' },
    });

    const headSnapshot = await db.apiSpecSnapshot.findFirst({
      where: { repositoryId, ref: headRef, specPath: resolvedSpecPath },
      orderBy: { createdAt: 'desc' },
    });

    const oldSpec = baseSnapshot?.spec ?? {};
    const newSpec = headSnapshot?.spec ?? {};

    // Perform diff analysis
    const addedEndpoints = this.findAddedEndpoints(oldSpec, newSpec);
    const removedEndpoints = this.findRemovedEndpoints(oldSpec, newSpec);
    const modifiedEndpoints = this.findModifiedEndpoints(oldSpec, newSpec);
    const deprecatedEndpoints = this.findDeprecatedEndpoints(oldSpec, newSpec);
    const schemaChanges = this.diffSchemas(oldSpec, newSpec);
    const breakingChanges = this.detectBreakingChanges(oldSpec, newSpec);

    const totalChanges =
      addedEndpoints.length +
      modifiedEndpoints.length +
      deprecatedEndpoints.length +
      removedEndpoints.length;

    const summary =
      `Compared ${baseRef}...${headRef}: ` +
      `${addedEndpoints.length} added, ` +
      `${modifiedEndpoints.length} modified, ` +
      `${deprecatedEndpoints.length} deprecated, ` +
      `${removedEndpoints.length} removed endpoint(s). ` +
      `${schemaChanges.length} schema change(s), ` +
      `${breakingChanges.length} breaking change(s).`;

    const analysis: APIChangeAnalysis = {
      repositoryId,
      baseRef,
      headRef,
      timestamp: new Date(),
      addedEndpoints,
      modifiedEndpoints,
      deprecatedEndpoints,
      removedEndpoints,
      schemaChanges,
      breakingChanges,
      summary,
    };

    // Persist the analysis
    await db.apiChangeAnalysis.create({
      data: {
        id: generateId('aca'),
        repositoryId,
        baseRef,
        headRef,
        timestamp: analysis.timestamp,
        addedEndpoints: addedEndpoints as unknown as Record<string, unknown>[],
        modifiedEndpoints: modifiedEndpoints as unknown as Record<string, unknown>[],
        deprecatedEndpoints: deprecatedEndpoints as unknown as Record<string, unknown>[],
        removedEndpoints: removedEndpoints as unknown as Record<string, unknown>[],
        schemaChanges: schemaChanges as unknown as Record<string, unknown>[],
        breakingChanges: breakingChanges as unknown as Record<string, unknown>[],
        summary,
      },
    });

    log.info(
      { repositoryId, totalChanges, breakingCount: breakingChanges.length },
      'API change analysis completed'
    );

    // Auto-notify subscribers if there are breaking changes
    if (breakingChanges.length > 0) {
      await this.notifySubscribers(repositoryId, breakingChanges);
    }

    return analysis;
  }

  /**
   * Generate a markdown changelog from an analysis result, categorized by
   * Added, Changed, Deprecated, Removed, Breaking Changes, and Migration Notes.
   */
  generateChangelog(analysis: APIChangeAnalysis): string {
    const lines: string[] = [];

    lines.push(`# API Changelog`);
    lines.push('');
    lines.push(`**${analysis.baseRef}** → **${analysis.headRef}**`);
    lines.push(`Generated: ${analysis.timestamp.toISOString()}`);
    lines.push('');

    // Added
    if (analysis.addedEndpoints.length > 0) {
      lines.push('## Added');
      lines.push('');
      for (const ep of analysis.addedEndpoints) {
        lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.description}`);
      }
      lines.push('');
    }

    // Changed
    if (analysis.modifiedEndpoints.length > 0) {
      lines.push('## Changed');
      lines.push('');
      for (const ep of analysis.modifiedEndpoints) {
        const breakingTag = ep.breaking ? ' **[BREAKING]**' : '';
        lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.description}${breakingTag}`);
      }
      lines.push('');
    }

    // Deprecated
    if (analysis.deprecatedEndpoints.length > 0) {
      lines.push('## Deprecated');
      lines.push('');
      for (const ep of analysis.deprecatedEndpoints) {
        lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.description}`);
      }
      lines.push('');
    }

    // Removed
    if (analysis.removedEndpoints.length > 0) {
      lines.push('## Removed');
      lines.push('');
      for (const ep of analysis.removedEndpoints) {
        lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.description}`);
      }
      lines.push('');
    }

    // Breaking Changes
    if (analysis.breakingChanges.length > 0) {
      lines.push('## Breaking Changes');
      lines.push('');
      for (const bc of analysis.breakingChanges) {
        lines.push(`- **${bc.type}** at \`${bc.path}\` — ${bc.description}`);
      }
      lines.push('');
    }

    // Migration Notes
    const migrationHints = analysis.breakingChanges.filter((bc) => bc.migrationHint);
    if (migrationHints.length > 0) {
      lines.push('## Migration Notes');
      lines.push('');
      for (const bc of migrationHints) {
        lines.push(`- \`${bc.path}\`: ${bc.migrationHint}`);
      }
      lines.push('');
    }

    // Schema Changes
    if (analysis.schemaChanges.length > 0) {
      lines.push('## Schema Changes');
      lines.push('');
      for (const sc of analysis.schemaChanges) {
        const breakingTag = sc.breaking ? ' **[BREAKING]**' : '';
        lines.push(`- **${sc.schemaName}** (${sc.changeType}) — ${sc.details}${breakingTag}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Deep comparison of two API specs to detect breaking changes:
   * removed endpoints, changed response types, removed fields, and changed auth requirements.
   */
  detectBreakingChanges(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): BreakingChange[] {
    const changes: BreakingChange[] = [];

    const oldPaths = (oldSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const newPaths = (newSpec.paths ?? {}) as Record<string, Record<string, unknown>>;

    // Detect removed endpoints
    for (const [path, methods] of Object.entries(oldPaths)) {
      if (!newPaths[path]) {
        for (const method of Object.keys(methods)) {
          if (method.startsWith('x-')) continue;
          changes.push({
            type: 'endpoint_removed',
            path: `${method.toUpperCase()} ${path}`,
            description: `Endpoint ${method.toUpperCase()} ${path} has been removed`,
            migrationHint: `Find a replacement endpoint or update consumers to no longer call ${method.toUpperCase()} ${path}`,
          });
        }
        continue;
      }

      // Detect removed methods on existing path
      for (const method of Object.keys(methods)) {
        if (method.startsWith('x-')) continue;
        if (!newPaths[path]?.[method]) {
          changes.push({
            type: 'endpoint_removed',
            path: `${method.toUpperCase()} ${path}`,
            description: `Method ${method.toUpperCase()} removed from ${path}`,
            migrationHint: `Remove calls to ${method.toUpperCase()} ${path} or use an alternative method`,
          });
          continue;
        }

        const oldOperation = methods[method] as Record<string, unknown>;
        const newOperation = newPaths[path]![method] as Record<string, unknown>;

        // Detect auth changes
        const oldSecurity = oldOperation.security as unknown[] | undefined;
        const newSecurity = newOperation.security as unknown[] | undefined;
        if (
          JSON.stringify(oldSecurity) !== JSON.stringify(newSecurity) &&
          oldSecurity !== undefined
        ) {
          changes.push({
            type: 'auth_changed',
            path: `${method.toUpperCase()} ${path}`,
            description: `Authentication requirements changed for ${method.toUpperCase()} ${path}`,
            migrationHint: `Update authentication to match new security requirements for ${method.toUpperCase()} ${path}`,
          });
        }

        // Detect response type changes
        const oldResponses = (oldOperation.responses ?? {}) as Record<string, Record<string, unknown>>;
        const newResponses = (newOperation.responses ?? {}) as Record<string, Record<string, unknown>>;

        for (const [statusCode, oldResponse] of Object.entries(oldResponses)) {
          const newResponse = newResponses[statusCode];
          if (!newResponse) continue;

          const oldContent = oldResponse.content as Record<string, unknown> | undefined;
          const newContent = newResponse.content as Record<string, unknown> | undefined;

          if (oldContent && newContent) {
            for (const [mediaType, oldMedia] of Object.entries(oldContent)) {
              const newMedia = newContent[mediaType] as Record<string, unknown> | undefined;
              if (!newMedia) {
                changes.push({
                  type: 'response_changed',
                  path: `${method.toUpperCase()} ${path}`,
                  description: `Response media type '${mediaType}' removed from ${statusCode} response`,
                  migrationHint: `Update consumers to handle the new response format for ${method.toUpperCase()} ${path}`,
                });
                continue;
              }

              // Compare schemas for removed fields
              const oldSchema = (oldMedia as Record<string, unknown>).schema as Record<string, unknown> | undefined;
              const newSchema = (newMedia as Record<string, unknown>).schema as Record<string, unknown> | undefined;

              if (oldSchema && newSchema) {
                const removedFields = this.findRemovedFields(oldSchema, newSchema);
                for (const field of removedFields) {
                  changes.push({
                    type: 'field_removed',
                    path: `${method.toUpperCase()} ${path} → ${statusCode} → ${field}`,
                    description: `Field '${field}' removed from ${statusCode} response of ${method.toUpperCase()} ${path}`,
                    migrationHint: `Remove references to '${field}' in consumers of ${method.toUpperCase()} ${path}`,
                  });
                }

                // Detect type changes on existing fields
                const typeChanges = this.findTypeChanges(oldSchema, newSchema);
                for (const change of typeChanges) {
                  changes.push({
                    type: 'type_changed',
                    path: `${method.toUpperCase()} ${path} → ${statusCode} → ${change.field}`,
                    description: `Type of field '${change.field}' changed from '${change.oldType}' to '${change.newType}' in ${statusCode} response`,
                    migrationHint: `Update consumers to handle the new type '${change.newType}' for field '${change.field}'`,
                  });
                }
              }
            }
          }
        }
      }
    }

    return changes;
  }

  /**
   * Publish a changelog entry to the specified target: github_release, slack, or email.
   */
  async publishChangelog(
    changelogId: string,
    target: 'github_release' | 'slack' | 'email'
  ): Promise<void> {
    log.info({ changelogId, target }, 'Publishing changelog');

    const changelog = await db.apiChangelog.findUnique({
      where: { id: changelogId },
    });

    if (!changelog) {
      throw new Error(`Changelog not found: ${changelogId}`);
    }

    const notificationType = target === 'github_release' ? 'webhook' : target;

    try {
      await addJob(
        QUEUE_NAMES.NOTIFICATIONS,
        {
          type: notificationType as 'email' | 'slack' | 'webhook',
          recipient: target,
          subject: `API Changelog: ${changelog.version}`,
          body: changelog.content,
          metadata: { changelogId, target, repositoryId: changelog.repositoryId },
        },
        {
          jobId: `publish-changelog-${changelogId}-${target}`,
        }
      );

      // Track publication target
      const publishedTo = (changelog.publishedTo as string[]) || [];
      if (!publishedTo.includes(target)) {
        publishedTo.push(target);
        await db.apiChangelog.update({
          where: { id: changelogId },
          data: { publishedTo },
        });
      }

      log.info({ changelogId, target }, 'Changelog published');
    } catch (error) {
      log.error({ error, changelogId, target }, 'Failed to publish changelog');
      throw error;
    }
  }

  /**
   * Create a subscriber for breaking change alerts on a repository.
   */
  async subscribeToAlerts(
    repositoryId: string,
    params: { webhook?: string; email?: string; slackChannel?: string }
  ): Promise<AlertSubscriber> {
    log.info({ repositoryId, ...params }, 'Creating alert subscription');

    if (!params.webhook && !params.email && !params.slackChannel) {
      throw new Error('At least one notification channel (webhook, email, or slackChannel) is required');
    }

    const id = generateId('sub');

    const subscriber = await db.apiChangeAlertSubscriber.create({
      data: {
        id,
        repositoryId,
        webhook: params.webhook || null,
        email: params.email || null,
        slackChannel: params.slackChannel || null,
      },
    });

    log.info({ subscriberId: id, repositoryId }, 'Alert subscription created');

    return {
      id: subscriber.id,
      repositoryId: subscriber.repositoryId,
      webhook: subscriber.webhook || undefined,
      email: subscriber.email || undefined,
      slackChannel: subscriber.slackChannel || undefined,
      createdAt: subscriber.createdAt,
    };
  }

  /**
   * Send notifications to all subscribers of a repository about breaking changes.
   */
  async notifySubscribers(
    repositoryId: string,
    breakingChanges: BreakingChange[]
  ): Promise<void> {
    log.info(
      { repositoryId, breakingChangeCount: breakingChanges.length },
      'Notifying subscribers of breaking changes'
    );

    const subscribers = await db.apiChangeAlertSubscriber.findMany({
      where: { repositoryId },
    });

    if (subscribers.length === 0) {
      log.info({ repositoryId }, 'No subscribers to notify');
      return;
    }

    const subject = `Breaking API Changes Detected (${breakingChanges.length})`;
    const body = breakingChanges
      .map((bc) => `- [${bc.type}] ${bc.path}: ${bc.description}\n  Migration: ${bc.migrationHint}`)
      .join('\n');

    for (const subscriber of subscribers) {
      try {
        if (subscriber.email) {
          await addJob(
            QUEUE_NAMES.NOTIFICATIONS,
            {
              type: 'email' as const,
              recipient: subscriber.email,
              subject,
              body,
              metadata: { repositoryId, subscriberId: subscriber.id },
            },
            { jobId: `breaking-alert-email-${subscriber.id}-${Date.now()}` }
          );
        }

        if (subscriber.slackChannel) {
          await addJob(
            QUEUE_NAMES.NOTIFICATIONS,
            {
              type: 'slack' as const,
              recipient: subscriber.slackChannel,
              subject,
              body,
              metadata: { repositoryId, subscriberId: subscriber.id },
            },
            { jobId: `breaking-alert-slack-${subscriber.id}-${Date.now()}` }
          );
        }

        if (subscriber.webhook) {
          await addJob(
            QUEUE_NAMES.NOTIFICATIONS,
            {
              type: 'webhook' as const,
              recipient: subscriber.webhook,
              subject,
              body,
              metadata: { repositoryId, subscriberId: subscriber.id },
            },
            { jobId: `breaking-alert-webhook-${subscriber.id}-${Date.now()}` }
          );
        }
      } catch (error) {
        log.warn(
          { error, subscriberId: subscriber.id },
          'Failed to queue notification for subscriber'
        );
      }
    }

    log.info(
      { repositoryId, subscriberCount: subscribers.length },
      'Breaking change notifications queued'
    );
  }

  /**
   * Get a chronological timeline of API evolution for a repository.
   */
  async getAPITimeline(repositoryId: string): Promise<{
    entries: Array<{
      id: string;
      baseRef: string;
      headRef: string;
      timestamp: Date;
      summary: string;
      breakingChangeCount: number;
      totalChanges: number;
    }>;
  }> {
    log.info({ repositoryId }, 'Fetching API timeline');

    const analyses = await db.apiChangeAnalysis.findMany({
      where: { repositoryId },
      orderBy: { timestamp: 'asc' },
    });

    const entries = analyses.map(
      (a: {
        id: string;
        baseRef: string;
        headRef: string;
        timestamp: Date;
        summary: string;
        breakingChanges: unknown[];
        addedEndpoints: unknown[];
        modifiedEndpoints: unknown[];
        deprecatedEndpoints: unknown[];
        removedEndpoints: unknown[];
      }) => {
        const breakingChanges = (a.breakingChanges as unknown[]) || [];
        const added = (a.addedEndpoints as unknown[]) || [];
        const modified = (a.modifiedEndpoints as unknown[]) || [];
        const deprecated = (a.deprecatedEndpoints as unknown[]) || [];
        const removed = (a.removedEndpoints as unknown[]) || [];

        return {
          id: a.id,
          baseRef: a.baseRef,
          headRef: a.headRef,
          timestamp: a.timestamp,
          summary: a.summary,
          breakingChangeCount: breakingChanges.length,
          totalChanges: added.length + modified.length + deprecated.length + removed.length,
        };
      }
    );

    return { entries };
  }

  /**
   * Compare two API specs directly. Supports openapi and graphql formats.
   */
  compareSpecs(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>,
    format: 'openapi' | 'graphql'
  ): APIChangeAnalysis {
    log.info({ format }, 'Comparing specs directly');

    if (format === 'graphql') {
      return this.compareGraphQLSpecs(oldSpec, newSpec);
    }

    // Default to OpenAPI comparison
    const addedEndpoints = this.findAddedEndpoints(oldSpec, newSpec);
    const removedEndpoints = this.findRemovedEndpoints(oldSpec, newSpec);
    const modifiedEndpoints = this.findModifiedEndpoints(oldSpec, newSpec);
    const deprecatedEndpoints = this.findDeprecatedEndpoints(oldSpec, newSpec);
    const schemaChanges = this.diffSchemas(oldSpec, newSpec);
    const breakingChanges = this.detectBreakingChanges(oldSpec, newSpec);

    const summary =
      `${addedEndpoints.length} added, ` +
      `${modifiedEndpoints.length} modified, ` +
      `${deprecatedEndpoints.length} deprecated, ` +
      `${removedEndpoints.length} removed endpoint(s). ` +
      `${schemaChanges.length} schema change(s), ` +
      `${breakingChanges.length} breaking change(s).`;

    return {
      repositoryId: '',
      baseRef: 'old',
      headRef: 'new',
      timestamp: new Date(),
      addedEndpoints,
      modifiedEndpoints,
      deprecatedEndpoints,
      removedEndpoints,
      schemaChanges,
      breakingChanges,
      summary,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private findAddedEndpoints(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): EndpointChange[] {
    const added: EndpointChange[] = [];
    const oldPaths = (oldSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const newPaths = (newSpec.paths ?? {}) as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(newPaths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (method.startsWith('x-')) continue;
        if (!oldPaths[path]?.[method]) {
          const op = operation as Record<string, unknown>;
          added.push({
            method,
            path,
            description: (op.summary as string) || (op.description as string) || 'New endpoint',
            newSpec: op,
            breaking: false,
          });
        }
      }
    }

    return added;
  }

  private findRemovedEndpoints(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): EndpointChange[] {
    const removed: EndpointChange[] = [];
    const oldPaths = (oldSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const newPaths = (newSpec.paths ?? {}) as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(oldPaths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (method.startsWith('x-')) continue;
        if (!newPaths[path]?.[method]) {
          const op = operation as Record<string, unknown>;
          removed.push({
            method,
            path,
            description: (op.summary as string) || (op.description as string) || 'Endpoint removed',
            oldSpec: op,
            breaking: true,
          });
        }
      }
    }

    return removed;
  }

  private findModifiedEndpoints(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): EndpointChange[] {
    const modified: EndpointChange[] = [];
    const oldPaths = (oldSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const newPaths = (newSpec.paths ?? {}) as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(newPaths)) {
      for (const [method, newOperation] of Object.entries(methods)) {
        if (method.startsWith('x-')) continue;
        const oldOperation = oldPaths[path]?.[method];
        if (!oldOperation) continue;

        const oldOp = oldOperation as Record<string, unknown>;
        const newOp = newOperation as Record<string, unknown>;

        // Compare serialized operations to detect changes
        if (JSON.stringify(oldOp) !== JSON.stringify(newOp)) {
          // Determine if the change is breaking
          const isBreaking = this.isEndpointChangeBreaking(oldOp, newOp);

          modified.push({
            method,
            path,
            description: (newOp.summary as string) || (newOp.description as string) || 'Endpoint modified',
            oldSpec: oldOp,
            newSpec: newOp,
            breaking: isBreaking,
          });
        }
      }
    }

    return modified;
  }

  private findDeprecatedEndpoints(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): EndpointChange[] {
    const deprecated: EndpointChange[] = [];
    const oldPaths = (oldSpec.paths ?? {}) as Record<string, Record<string, unknown>>;
    const newPaths = (newSpec.paths ?? {}) as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(newPaths)) {
      for (const [method, newOperation] of Object.entries(methods)) {
        if (method.startsWith('x-')) continue;
        const oldOperation = oldPaths[path]?.[method] as Record<string, unknown> | undefined;
        const newOp = newOperation as Record<string, unknown>;

        // Newly deprecated: not deprecated before but deprecated now
        if (newOp.deprecated === true && oldOperation?.deprecated !== true) {
          deprecated.push({
            method,
            path,
            description: (newOp.summary as string) || (newOp.description as string) || 'Endpoint deprecated',
            oldSpec: oldOperation,
            newSpec: newOp,
            breaking: false,
          });
        }
      }
    }

    return deprecated;
  }

  private diffSchemas(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): SchemaChange[] {
    const changes: SchemaChange[] = [];

    const oldComponents = (oldSpec.components ?? {}) as Record<string, unknown>;
    const newComponents = (newSpec.components ?? {}) as Record<string, unknown>;

    const oldSchemas = (oldComponents.schemas ?? {}) as Record<string, unknown>;
    const newSchemas = (newComponents.schemas ?? {}) as Record<string, unknown>;

    // Added schemas
    for (const name of Object.keys(newSchemas)) {
      if (!oldSchemas[name]) {
        changes.push({
          schemaName: name,
          changeType: 'added',
          details: `Schema '${name}' was added`,
          breaking: false,
        });
      }
    }

    // Removed schemas
    for (const name of Object.keys(oldSchemas)) {
      if (!newSchemas[name]) {
        changes.push({
          schemaName: name,
          changeType: 'removed',
          details: `Schema '${name}' was removed`,
          breaking: true,
        });
      }
    }

    // Modified schemas
    for (const name of Object.keys(newSchemas)) {
      if (oldSchemas[name] && JSON.stringify(oldSchemas[name]) !== JSON.stringify(newSchemas[name])) {
        const hasRemovedFields = this.findRemovedFields(
          oldSchemas[name] as Record<string, unknown>,
          newSchemas[name] as Record<string, unknown>
        );

        changes.push({
          schemaName: name,
          changeType: 'modified',
          details: `Schema '${name}' was modified`,
          breaking: hasRemovedFields.length > 0,
        });
      }
    }

    return changes;
  }

  private findRemovedFields(
    oldSchema: Record<string, unknown>,
    newSchema: Record<string, unknown>
  ): string[] {
    const removed: string[] = [];
    const oldProperties = (oldSchema.properties ?? {}) as Record<string, unknown>;
    const newProperties = (newSchema.properties ?? {}) as Record<string, unknown>;

    for (const field of Object.keys(oldProperties)) {
      if (!newProperties[field]) {
        removed.push(field);
      }
    }

    return removed;
  }

  private findTypeChanges(
    oldSchema: Record<string, unknown>,
    newSchema: Record<string, unknown>
  ): Array<{ field: string; oldType: string; newType: string }> {
    const typeChanges: Array<{ field: string; oldType: string; newType: string }> = [];
    const oldProperties = (oldSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const newProperties = (newSchema.properties ?? {}) as Record<string, Record<string, unknown>>;

    for (const [field, oldProp] of Object.entries(oldProperties)) {
      const newProp = newProperties[field];
      if (!newProp) continue;

      const oldType = (oldProp.type as string) || 'unknown';
      const newType = (newProp.type as string) || 'unknown';

      if (oldType !== newType) {
        typeChanges.push({ field, oldType, newType });
      }
    }

    return typeChanges;
  }

  private isEndpointChangeBreaking(
    oldOp: Record<string, unknown>,
    newOp: Record<string, unknown>
  ): boolean {
    // Check for removed required parameters
    const oldParams = (oldOp.parameters ?? []) as Array<Record<string, unknown>>;
    const newParams = (newOp.parameters ?? []) as Array<Record<string, unknown>>;

    // New required parameters are breaking
    for (const newParam of newParams) {
      if (newParam.required !== true) continue;
      const exists = oldParams.some(
        (op) => op.name === newParam.name && op.in === newParam.in
      );
      if (!exists) return true;
    }

    // Changed response schema on 200 is breaking
    const oldResponses = (oldOp.responses ?? {}) as Record<string, Record<string, unknown>>;
    const newResponses = (newOp.responses ?? {}) as Record<string, Record<string, unknown>>;

    for (const code of ['200', '201']) {
      const oldResp = oldResponses[code];
      const newResp = newResponses[code];
      if (oldResp && newResp) {
        if (JSON.stringify(oldResp) !== JSON.stringify(newResp)) {
          return true;
        }
      }
    }

    // Auth changes are breaking
    if (JSON.stringify(oldOp.security) !== JSON.stringify(newOp.security)) {
      if (oldOp.security !== undefined) return true;
    }

    return false;
  }

  private compareGraphQLSpecs(
    oldSpec: Record<string, unknown>,
    newSpec: Record<string, unknown>
  ): APIChangeAnalysis {
    const addedEndpoints: EndpointChange[] = [];
    const removedEndpoints: EndpointChange[] = [];
    const modifiedEndpoints: EndpointChange[] = [];
    const schemaChanges: SchemaChange[] = [];
    const breakingChanges: BreakingChange[] = [];

    const oldTypes = (oldSpec.types ?? {}) as Record<string, Record<string, unknown>>;
    const newTypes = (newSpec.types ?? {}) as Record<string, Record<string, unknown>>;

    // Compare Query/Mutation fields as endpoints
    for (const rootType of ['Query', 'Mutation', 'Subscription']) {
      const oldRoot = oldTypes[rootType] as Record<string, unknown> | undefined;
      const newRoot = newTypes[rootType] as Record<string, unknown> | undefined;
      const oldFields = (oldRoot?.fields ?? {}) as Record<string, unknown>;
      const newFields = (newRoot?.fields ?? {}) as Record<string, unknown>;

      for (const field of Object.keys(newFields)) {
        if (!oldFields[field]) {
          addedEndpoints.push({
            method: rootType.toLowerCase(),
            path: field,
            description: `New ${rootType} field: ${field}`,
            breaking: false,
          });
        }
      }

      for (const field of Object.keys(oldFields)) {
        if (!newFields[field]) {
          removedEndpoints.push({
            method: rootType.toLowerCase(),
            path: field,
            description: `Removed ${rootType} field: ${field}`,
            breaking: true,
          });

          breakingChanges.push({
            type: 'endpoint_removed',
            path: `${rootType}.${field}`,
            description: `${rootType} field '${field}' was removed`,
            migrationHint: `Remove queries/mutations referencing '${field}'`,
          });
        }
      }
    }

    // Compare types
    for (const [name, typeDef] of Object.entries(newTypes)) {
      if (['Query', 'Mutation', 'Subscription'].includes(name)) continue;
      if (!oldTypes[name]) {
        schemaChanges.push({
          schemaName: name,
          changeType: 'added',
          details: `GraphQL type '${name}' was added`,
          breaking: false,
        });
      }
    }

    for (const [name, typeDef] of Object.entries(oldTypes)) {
      if (['Query', 'Mutation', 'Subscription'].includes(name)) continue;
      if (!newTypes[name]) {
        schemaChanges.push({
          schemaName: name,
          changeType: 'removed',
          details: `GraphQL type '${name}' was removed`,
          breaking: true,
        });

        breakingChanges.push({
          type: 'type_changed',
          path: name,
          description: `GraphQL type '${name}' was removed`,
          migrationHint: `Update queries that reference type '${name}'`,
        });
      }
    }

    const summary =
      `GraphQL comparison: ` +
      `${addedEndpoints.length} added, ` +
      `${modifiedEndpoints.length} modified, ` +
      `${removedEndpoints.length} removed field(s). ` +
      `${schemaChanges.length} type change(s), ` +
      `${breakingChanges.length} breaking change(s).`;

    return {
      repositoryId: '',
      baseRef: 'old',
      headRef: 'new',
      timestamp: new Date(),
      addedEndpoints,
      modifiedEndpoints,
      deprecatedEndpoints: [],
      removedEndpoints,
      schemaChanges,
      breakingChanges,
      summary,
    };
  }
}

export const apiChangelogService = new APIChangelogService();
