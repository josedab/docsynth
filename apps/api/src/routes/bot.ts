import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError, createLogger } from '@docsynth/utils';
import { addJob, QUEUE_NAMES } from '@docsynth/queue';

const app = new Hono();
const log = createLogger('bot-routes');

// ============================================================================
// Bot Integrations
// ============================================================================

// List bot integrations for organization
app.get('/integrations', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const integrations = await prisma.integration.findMany({
    where: { 
      organizationId: orgId, 
      type: { in: ['SLACK', 'TEAMS'] } 
    },
  });

  return c.json({
    success: true,
    data: integrations,
  });
});

// Configure bot for Slack workspace
app.post('/slack/configure', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    workspaceId: string;
    botToken: string;
    signingSecret: string;
    channels: string[];
  }>();

  if (!body.workspaceId || !body.botToken) {
    throw new ValidationError('workspaceId and botToken are required');
  }

  // Create or update Slack integration
  const integration = await prisma.integration.upsert({
    where: {
      organizationId_type: {
        organizationId: orgId,
        type: 'SLACK',
      },
    },
    create: {
      organizationId: orgId,
      type: 'SLACK',
      status: 'ACTIVE',
      config: {
        workspaceId: body.workspaceId,
        botToken: body.botToken,
        signingSecret: body.signingSecret,
        channels: body.channels,
      },
      connectedAt: new Date(),
    },
    update: {
      status: 'ACTIVE',
      config: {
        workspaceId: body.workspaceId,
        botToken: body.botToken,
        signingSecret: body.signingSecret,
        channels: body.channels,
      },
      connectedAt: new Date(),
    },
  });

  log.info({ orgId, workspaceId: body.workspaceId }, 'Slack bot configured');

  return c.json({
    success: true,
    data: {
      integrationId: integration.id,
      message: 'Slack bot configured',
    },
  });
});

// Configure bot for MS Teams
app.post('/teams/configure', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    tenantId: string;
    clientId: string;
    clientSecret: string;
    teamIds: string[];
  }>();

  if (!body.tenantId || !body.clientId) {
    throw new ValidationError('tenantId and clientId are required');
  }

  // Create or update Teams integration
  const integration = await prisma.integration.upsert({
    where: {
      organizationId_type: {
        organizationId: orgId,
        type: 'TEAMS',
      },
    },
    create: {
      organizationId: orgId,
      type: 'TEAMS',
      status: 'ACTIVE',
      config: {
        tenantId: body.tenantId,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        teamIds: body.teamIds,
      },
      connectedAt: new Date(),
    },
    update: {
      status: 'ACTIVE',
      config: {
        tenantId: body.tenantId,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        teamIds: body.teamIds,
      },
      connectedAt: new Date(),
    },
  });

  log.info({ orgId, tenantId: body.tenantId }, 'Teams bot configured');

  return c.json({
    success: true,
    data: {
      integrationId: integration.id,
      message: 'Teams bot configured',
    },
  });
});

// ============================================================================
// Bot Conversations
// ============================================================================

// List conversations
app.get('/conversations', requireAuth, requireOrgAccess, async (c) => {
  const { platform, limit, offset } = c.req.query();

  const whereClause: Record<string, unknown> = {};
  if (platform) whereClause.platform = platform;

  const [conversations, total] = await Promise.all([
    prisma.botConversation.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.botConversation.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { conversations, total },
  });
});

// Get conversation
app.get('/conversations/:conversationId', requireAuth, requireOrgAccess, async (c) => {
  const conversationId = c.req.param('conversationId');

  const conversation = await prisma.botConversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    throw new NotFoundError('Conversation', conversationId);
  }

  return c.json({
    success: true,
    data: conversation,
  });
});

// ============================================================================
// Doc Alerts
// ============================================================================

// List alerts for organization
app.get('/alerts', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { platform, acknowledged, limit, offset } = c.req.query();

  const whereClause: Record<string, unknown> = { organizationId: orgId };
  if (platform) whereClause.platform = platform;
  if (acknowledged !== undefined) whereClause.acknowledged = acknowledged === 'true';

  const [alerts, total] = await Promise.all([
    prisma.docAlert.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit, 10) : 20,
      skip: offset ? parseInt(offset, 10) : 0,
    }),
    prisma.docAlert.count({ where: whereClause }),
  ]);

  return c.json({
    success: true,
    data: { alerts, total },
  });
});

// Create alert
app.post('/alerts', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<{
    channelId: string;
    platform: 'slack' | 'teams';
    alertType: 'drift' | 'health' | 'review';
    repositoryId?: string;
    documentId?: string;
    message: string;
  }>();

  if (!body.channelId || !body.platform || !body.alertType || !body.message) {
    throw new ValidationError('channelId, platform, alertType, and message are required');
  }

  const alert = await prisma.docAlert.create({
    data: {
      organizationId: orgId,
      channelId: body.channelId,
      platform: body.platform,
      alertType: body.alertType,
      repositoryId: body.repositoryId,
      documentId: body.documentId,
      message: body.message,
    },
  });

  log.info({ alertId: alert.id, alertType: body.alertType }, 'Doc alert created');

  return c.json({
    success: true,
    data: alert,
  });
});

// Acknowledge alert
app.post('/alerts/:alertId/acknowledge', requireAuth, requireOrgAccess, async (c) => {
  const alertId = c.req.param('alertId');
  const orgId = c.get('organizationId');

  const alert = await prisma.docAlert.findFirst({
    where: { id: alertId, organizationId: orgId },
  });

  if (!alert) {
    throw new NotFoundError('Alert', alertId);
  }

  await prisma.docAlert.update({
    where: { id: alertId },
    data: { acknowledged: true },
  });

  return c.json({ success: true });
});

// ============================================================================
// Webhook endpoints (for Slack/Teams to call)
// ============================================================================

// Slack events webhook
app.post('/webhooks/slack', async (c) => {
  const body = await c.req.json<{
    type: string;
    challenge?: string;
    event?: {
      type: string;
      channel: string;
      user: string;
      text: string;
      ts: string;
    };
    team_id?: string;
  }>();

  // Handle URL verification
  if (body.type === 'url_verification' && body.challenge) {
    return c.json({ challenge: body.challenge });
  }

  // Handle events
  if (body.type === 'event_callback' && body.event) {
    const event = body.event;

    // Only handle direct messages or mentions
    if (event.type === 'message' || event.type === 'app_mention') {
      // Find integration
      const integration = await prisma.integration.findFirst({
        where: {
          type: 'SLACK',
          status: 'ACTIVE',
          config: { path: ['workspaceId'], equals: body.team_id },
        },
      });

      if (integration) {
        // Queue message processing
        await addJob(QUEUE_NAMES.BOT_MESSAGE, {
          platform: 'slack',
          organizationId: integration.organizationId,
          channelId: event.channel,
          userId: event.user,
          query: event.text,
        });
      }
    }
  }

  return c.json({ ok: true });
});

// Teams events webhook
app.post('/webhooks/teams', async (c) => {
  const body = await c.req.json<{
    type: string;
    channelId?: string;
    from?: { id: string; name: string };
    text?: string;
    id?: string;
    channelData?: { tenant?: { id: string } };
  }>();

  if (body.type === 'message' && body.text) {
    const tenantId = body.channelData?.tenant?.id;

    // Find integration
    const integration = await prisma.integration.findFirst({
      where: {
        type: 'TEAMS',
        status: 'ACTIVE',
        config: { path: ['tenantId'], equals: tenantId },
      },
    });

    if (integration) {
      // Queue message processing
      await addJob(QUEUE_NAMES.BOT_MESSAGE, {
        platform: 'teams',
        organizationId: integration.organizationId,
        channelId: body.channelId || '',
        userId: body.from?.id || '',
        query: body.text,
      });
    }
  }

  return c.json({ ok: true });
});

export const botRoutes = app;
