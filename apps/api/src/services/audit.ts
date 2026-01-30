import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import type { AuditAction } from '@docsynth/types';

const log = createLogger('audit-service');

export interface AuditEntry {
  organizationId: string;
  userId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          details: (entry.details ?? {}) as object,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (error) {
      // Don't throw - audit logging shouldn't break the main flow
      log.error({ error, entry }, 'Failed to create audit log');
    }
  }

  async query(
    organizationId: string,
    options: {
      userId?: string;
      action?: AuditAction;
      resourceType?: string;
      resourceId?: string;
      startDate?: Date;
      endDate?: Date;
      page?: number;
      perPage?: number;
    } = {}
  ): Promise<{
    logs: Array<{
      id: string;
      action: string;
      resourceType: string;
      resourceId: string;
      details: Record<string, unknown>;
      user: { id: string; githubUsername: string } | null;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const { page = 1, perPage = 50 } = options;

    const where = {
      organizationId,
      ...(options.userId && { userId: options.userId }),
      ...(options.action && { action: options.action }),
      ...(options.resourceType && { resourceType: options.resourceType }),
      ...(options.resourceId && { resourceId: options.resourceId }),
      ...(options.startDate &&
        options.endDate && {
          createdAt: {
            gte: options.startDate,
            lte: options.endDate,
          },
        }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              githubUsername: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        details: l.details as Record<string, unknown>,
        user: l.user,
        createdAt: l.createdAt,
      })),
      total,
    };
  }

  async exportLogs(
    organizationId: string,
    options: {
      startDate: Date;
      endDate: Date;
      format: 'json' | 'csv';
    }
  ): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: options.startDate,
          lte: options.endDate,
        },
      },
      include: {
        user: {
          select: {
            githubUsername: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (options.format === 'csv') {
      const headers = [
        'Timestamp',
        'User',
        'Action',
        'Resource Type',
        'Resource ID',
        'IP Address',
      ];
      const rows = logs.map((l) => [
        l.createdAt.toISOString(),
        l.user?.githubUsername ?? 'system',
        l.action,
        l.resourceType,
        l.resourceId,
        l.ipAddress ?? '',
      ]);

      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    return JSON.stringify(logs, null, 2);
  }

  // Helper methods for common audit events
  async logLogin(
    organizationId: string,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'login',
      resourceType: 'session',
      resourceId: userId,
      ipAddress,
      userAgent,
    });
  }

  async logRepositoryEnabled(
    organizationId: string,
    userId: string,
    repositoryId: string,
    repositoryName: string
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'enable',
      resourceType: 'repository',
      resourceId: repositoryId,
      details: { repositoryName },
    });
  }

  async logGenerationStarted(
    organizationId: string,
    repositoryId: string,
    jobId: string,
    prNumber: number
  ): Promise<void> {
    await this.log({
      organizationId,
      action: 'generate',
      resourceType: 'generation_job',
      resourceId: jobId,
      details: { repositoryId, prNumber },
    });
  }

  async logTeamMemberAdded(
    organizationId: string,
    userId: string,
    newMemberId: string,
    role: string
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'create',
      resourceType: 'membership',
      resourceId: newMemberId,
      details: { role },
    });
  }

  async logSubscriptionChanged(
    organizationId: string,
    userId: string,
    oldTier: string,
    newTier: string
  ): Promise<void> {
    await this.log({
      organizationId,
      userId,
      action: 'update',
      resourceType: 'subscription',
      resourceId: organizationId,
      details: { oldTier, newTier },
    });
  }
}

export const auditService = new AuditService();
