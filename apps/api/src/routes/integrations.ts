import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import type { User } from '@docsynth/types';

const integrations = new Hono<{ Variables: { user: User; organizationId: string } }>();

// Helper to get user's organizationId
async function getOrgId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId },
  });
  return membership?.organizationId ?? null;
}

// Get all integrations for the organization
integrations.get('/', async (c) => {
  try {
    const user = c.get('user');
    const organizationId = await getOrgId(user.id);

    if (!organizationId) {
      return c.json({ integrations: [] });
    }

    const orgIntegrations = await prisma.integration.findMany({
      where: { organizationId },
      select: {
        id: true,
        type: true,
        status: true,
        connectedAt: true,
        config: true,
      },
    });

    const integrationsData = orgIntegrations.map((i) => ({
      id: i.type.toLowerCase(),
      name: getIntegrationName(i.type),
      description: getIntegrationDescription(i.type),
      icon: getIntegrationIcon(i.type),
      status: i.status === 'ACTIVE' ? 'connected' : 'disconnected',
      connectedAt: i.connectedAt?.toISOString(),
      config: maskSensitiveConfig(i.config as Record<string, string>),
    }));

    return c.json({ integrations: integrationsData });
  } catch (error) {
    console.error('Failed to fetch integrations:', error);
    return c.json({ integrations: [] });
  }
});

// Update/connect an integration
integrations.put('/:integrationId', async (c) => {
  try {
    const user = c.get('user');
    const integrationId = c.req.param('integrationId');
    const { config } = await c.req.json();

    const organizationId = await getOrgId(user.id);
    if (!organizationId) {
      return c.json({ error: 'No organization found' }, 400);
    }

    const integrationType = integrationId.toUpperCase();

    const validation = validateIntegrationConfig(integrationType, config);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    await prisma.integration.upsert({
      where: {
        organizationId_type: {
          organizationId,
          type: integrationType,
        },
      },
      create: {
        organizationId,
        type: integrationType,
        status: 'ACTIVE',
        config,
        connectedAt: new Date(),
      },
      update: {
        config,
        status: 'ACTIVE',
        connectedAt: new Date(),
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to save integration:', error);
    return c.json({ error: 'Failed to save integration' }, 500);
  }
});

// Disconnect an integration
integrations.delete('/:integrationId', async (c) => {
  try {
    const user = c.get('user');
    const integrationId = c.req.param('integrationId');

    const organizationId = await getOrgId(user.id);
    if (!organizationId) {
      return c.json({ error: 'No organization found' }, 400);
    }

    const integrationType = integrationId.toUpperCase();

    await prisma.integration.updateMany({
      where: {
        organizationId,
        type: integrationType,
      },
      data: {
        status: 'INACTIVE',
        config: {},
      },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to disconnect integration:', error);
    return c.json({ error: 'Failed to disconnect integration' }, 500);
  }
});

// Test an integration connection
integrations.post('/:integrationId/test', async (c) => {
  try {
    const user = c.get('user');
    const integrationId = c.req.param('integrationId');

    const organizationId = await getOrgId(user.id);
    if (!organizationId) {
      return c.json({ success: false, error: 'No organization found' }, 400);
    }

    const integrationType = integrationId.toUpperCase();

    const integration = await prisma.integration.findUnique({
      where: {
        organizationId_type: {
          organizationId,
          type: integrationType,
        },
      },
    });

    if (!integration || integration.status !== 'ACTIVE') {
      return c.json({ success: false, error: 'Integration not connected' }, 400);
    }

    const testResult = await testIntegrationConnection(
      integrationType,
      integration.config as Record<string, string>
    );

    return c.json(testResult);
  } catch (error) {
    console.error('Failed to test integration:', error);
    return c.json({ success: false, error: 'Connection test failed' }, 500);
  }
});

// Helper functions
function getIntegrationName(type: string): string {
  const names: Record<string, string> = {
    JIRA: 'Jira',
    SLACK: 'Slack',
    CONFLUENCE: 'Confluence',
    NOTION: 'Notion',
    LINEAR: 'Linear',
  };
  return names[type] || type;
}

function getIntegrationDescription(type: string): string {
  const descriptions: Record<string, string> = {
    JIRA: 'Import ticket context for better documentation',
    SLACK: 'Gather context from team discussions',
    CONFLUENCE: 'Publish documentation to Confluence',
    NOTION: 'Sync documentation to Notion pages',
    LINEAR: 'Import issue context from Linear',
  };
  return descriptions[type] || '';
}

function getIntegrationIcon(type: string): string {
  const icons: Record<string, string> = {
    JIRA: '🎫',
    SLACK: '💬',
    CONFLUENCE: '📄',
    NOTION: '📝',
    LINEAR: '📊',
  };
  return icons[type] || '🔌';
}

function maskSensitiveConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  const sensitiveKeys = ['apiToken', 'apiKey', 'botToken', 'secret'];

  for (const [key, value] of Object.entries(config || {})) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      masked[key] = value ? '••••••••' : '';
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

function validateIntegrationConfig(
  type: string,
  config: Record<string, string>
): { valid: boolean; error?: string } {
  const requiredFields: Record<string, string[]> = {
    JIRA: ['baseUrl', 'email', 'apiToken'],
    SLACK: ['botToken'],
    CONFLUENCE: ['baseUrl', 'email', 'apiToken', 'spaceKey'],
    NOTION: ['apiKey'],
    LINEAR: ['apiKey'],
  };

  const required = requiredFields[type] || [];
  for (const field of required) {
    if (!config[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  return { valid: true };
}

interface SlackAuthResponse {
  ok: boolean;
  error?: string;
}

interface LinearGraphQLResponse {
  errors?: Array<{ message: string }>;
}

async function testIntegrationConnection(
  type: string,
  config: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (type) {
      case 'JIRA': {
        const response = await fetch(`${config.baseUrl}/rest/api/3/myself`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
            Accept: 'application/json',
          },
        });
        if (!response.ok) throw new Error('Failed to authenticate');
        return { success: true };
      }

      case 'SLACK': {
        const response = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.botToken}`,
            'Content-Type': 'application/json',
          },
        });
        const data = (await response.json()) as SlackAuthResponse;
        if (!data.ok) throw new Error(data.error || 'Auth failed');
        return { success: true };
      }

      case 'CONFLUENCE': {
        const response = await fetch(`${config.baseUrl}/rest/api/space/${config.spaceKey}`, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`,
            Accept: 'application/json',
          },
        });
        if (!response.ok) throw new Error('Failed to access space');
        return { success: true };
      }

      case 'NOTION': {
        const response = await fetch('https://api.notion.com/v1/users/me', {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (!response.ok) throw new Error('Failed to authenticate');
        return { success: true };
      }

      case 'LINEAR': {
        const response = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: config.apiKey ?? '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: '{ viewer { id } }' }),
        });
        const data = (await response.json()) as LinearGraphQLResponse;
        if (data.errors) throw new Error('Auth failed');
        return { success: true };
      }

      default:
        return { success: false, error: 'Unknown integration type' };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

export default integrations;
