import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess, requireRole } from '../middleware/auth.js';
import { ValidationError, NotFoundError } from '@docsynth/utils';
import { auditService } from '../services/audit.js';
import type { AuditAction } from '@docsynth/types';

const app = new Hono();

const VALID_AUDIT_ACTIONS: AuditAction[] = ['create', 'update', 'delete', 'enable', 'disable', 'generate', 'approve', 'reject', 'login', 'logout'];

// Get audit logs
app.get('/audit-logs', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');
  const { userId, action, resourceType, startDate, endDate, page, perPage } = c.req.query();

  const validAction = action && VALID_AUDIT_ACTIONS.includes(action as AuditAction) ? (action as AuditAction) : undefined;

  const result = await auditService.query(orgId, {
    userId,
    action: validAction,
    resourceType,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    page: page ? parseInt(page, 10) : 1,
    perPage: perPage ? parseInt(perPage, 10) : 50,
  });

  return c.json({
    success: true,
    data: result.logs,
    pagination: {
      total: result.total,
      page: page ? parseInt(page, 10) : 1,
      perPage: perPage ? parseInt(perPage, 10) : 50,
    },
  });
});

// Export audit logs
app.get(
  '/audit-logs/export',
  requireAuth,
  requireOrgAccess,
  requireRole('owner', 'admin'),
  async (c) => {
    const orgId = c.get('organizationId');
    const { startDate, endDate, format } = c.req.query();

    if (!startDate || !endDate) {
      throw new ValidationError('startDate and endDate are required');
    }

    const exportFormat = (format || 'json') as 'json' | 'csv';
    const data = await auditService.exportLogs(orgId, {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      format: exportFormat,
    });

    const contentType = exportFormat === 'csv' ? 'text/csv' : 'application/json';
    const filename = `audit-logs-${startDate}-${endDate}.${exportFormat}`;

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }
);

// Get organization data export (GDPR compliance)
app.get('/data-export', requireAuth, requireOrgAccess, requireRole('owner'), async (c) => {
  const orgId = c.get('organizationId');

  // Get repository IDs for the organization first
  const orgRepos = await prisma.repository.findMany({
    where: { organizationId: orgId },
  });
  const repoIds = orgRepos.map((r) => r.id);

  // Gather all organization data
  const [organization, memberships, generationJobs] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
    }),
    prisma.membership.findMany({
      where: { organizationId: orgId },
      include: {
        user: {
          select: {
            id: true,
            githubUsername: true,
            email: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.generationJob.findMany({
      where: {
        repositoryId: { in: repoIds },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
  ]);

  const exportData = {
    exportedAt: new Date().toISOString(),
    organization: {
      id: organization?.id,
      name: organization?.name,
      githubOrgId: organization?.githubOrgId,
      createdAt: organization?.createdAt,
    },
    members: memberships.map((m) => ({
      role: m.role,
      joinedAt: m.createdAt,
      user: m.user,
    })),
    repositories: orgRepos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      enabled: r.enabled,
      createdAt: r.createdAt,
    })),
    generationJobs: generationJobs.map((j) => ({
      id: j.id,
      status: j.status,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="docsynth-export-${orgId}.json"`,
    },
  });
});

// SSO Configuration (placeholder for SAML/OIDC)
app.get('/sso', requireAuth, requireOrgAccess, requireRole('owner'), async (c) => {
  const orgId = c.get('organizationId');

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  const settings = ((org?.settings as Record<string, unknown>) || {}) as Record<string, unknown>;
  const ssoConfig = (settings.sso || {}) as Record<string, unknown>;

  return c.json({
    success: true,
    data: {
      enabled: ssoConfig.enabled || false,
      provider: ssoConfig.provider || null,
      domain: ssoConfig.domain || null,
    },
  });
});

app.put('/sso', requireAuth, requireOrgAccess, requireRole('owner'), async (c) => {
  const orgId = c.get('organizationId');
  const currentUser = c.get('user');
  const body = await c.req.json();
  const { enabled, provider, domain, entityId, ssoUrl, certificate } = body;

  if (enabled && !['saml', 'oidc'].includes(provider)) {
    throw new ValidationError('Invalid SSO provider');
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
  });

  const currentSettings = ((org?.settings as Record<string, unknown>) || {}) as Record<
    string,
    unknown
  >;

  await prisma.organization.update({
    where: { id: orgId },
    data: {
      settings: {
        ...currentSettings,
        sso: {
          enabled,
          provider,
          domain,
          entityId,
          ssoUrl,
          certificate,
        },
      },
    },
  });

  await auditService.log({
    organizationId: orgId,
    userId: currentUser.id,
    action: 'update',
    resourceType: 'sso_config',
    resourceId: orgId,
    details: { enabled, provider },
  });

  return c.json({
    success: true,
    data: { message: 'SSO configuration updated' },
  });
});

// API Key management
app.get('/api-keys', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');

  const apiKeys = await prisma.apiKey.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return c.json({
    success: true,
    data: apiKeys,
  });
});

app.post('/api-keys', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');
  const currentUser = c.get('user');
  const body = await c.req.json();
  const { name, expiresIn } = body;

  if (!name) {
    throw new ValidationError('Name is required');
  }

  // Generate API key
  const key = `ds_${generateRandomString(32)}`;
  const prefix = key.substring(0, 10);

  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: orgId,
      name,
      key: hashApiKey(key),
      prefix,
      expiresAt,
    },
  });

  await auditService.log({
    organizationId: orgId,
    userId: currentUser.id,
    action: 'create',
    resourceType: 'api_key',
    resourceId: apiKey.id,
    details: { name },
  });

  // Return the full key only once
  return c.json({
    success: true,
    data: {
      id: apiKey.id,
      name: apiKey.name,
      key, // Only returned on creation
      prefix: apiKey.prefix,
      expiresAt: apiKey.expiresAt,
    },
  });
});

app.delete(
  '/api-keys/:keyId',
  requireAuth,
  requireOrgAccess,
  requireRole('owner', 'admin'),
  async (c) => {
    const orgId = c.get('organizationId');
    const currentUser = c.get('user');
    const keyId = c.req.param('keyId');

    const apiKey = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKey || apiKey.organizationId !== orgId) {
      throw new NotFoundError('API key', keyId);
    }

    await prisma.apiKey.delete({
      where: { id: keyId },
    });

    await auditService.log({
      organizationId: orgId,
      userId: currentUser.id,
      action: 'delete',
      resourceType: 'api_key',
      resourceId: keyId,
    });

    return c.json({
      success: true,
      data: { message: 'API key deleted' },
    });
  }
);

// Helper functions
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function hashApiKey(key: string): string {
  // In production, use proper hashing (bcrypt, argon2)
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(key).digest('hex');
}

export { app as enterpriseRoutes };
