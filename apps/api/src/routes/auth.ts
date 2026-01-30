import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { exchangeCodeForToken, getUserFromToken } from '@docsynth/github';
import { createToken } from '../middleware/auth.js';
import { createLogger, ValidationError } from '@docsynth/utils';

const log = createLogger('auth');

const app = new Hono();

// GitHub OAuth callback
app.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code) {
    throw new ValidationError('Missing authorization code');
  }

  log.info({ state }, 'Processing OAuth callback');

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);

  // Get user info from GitHub
  const githubUser = await getUserFromToken(tokenResponse.accessToken);

  // Create or update user
  const user = await prisma.user.upsert({
    where: { githubUserId: githubUser.id },
    create: {
      githubUserId: githubUser.id,
      githubUsername: githubUser.login,
      email: githubUser.email,
      avatarUrl: githubUser.avatarUrl,
    },
    update: {
      githubUsername: githubUser.login,
      email: githubUser.email,
      avatarUrl: githubUser.avatarUrl,
    },
  });

  // Create JWT
  const token = await createToken({
    id: user.id,
    githubUserId: user.githubUserId,
    role: user.role.toLowerCase() as 'owner' | 'admin' | 'member' | 'viewer',
  });

  log.info({ userId: user.id, username: user.githubUsername }, 'User authenticated');

  // Redirect to frontend with token
  const redirectUrl = new URL(process.env.APP_URL ?? 'http://localhost:3000');
  redirectUrl.pathname = '/auth/callback';
  redirectUrl.searchParams.set('token', token);

  return c.redirect(redirectUrl.toString());
});

// Get OAuth URL
app.get('/github/url', (c) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = `${process.env.API_URL ?? 'http://localhost:3001'}/auth/github/callback`;
  const scope = 'user:email read:org';
  const state = crypto.randomUUID();

  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);

  return c.json({ url: url.toString(), state });
});

// Get current user
app.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ user: null });
  }

  try {
    const token = authHeader.slice(7);
    const { verifyToken } = await import('../middleware/auth.js');
    const payload = await verifyToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        githubUsername: true,
        email: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return c.json({ user: null });
    }

    // Get user's organizations
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            subscriptionTier: true,
          },
        },
      },
    });

    return c.json({
      user: {
        ...user,
        organizations: memberships.map((m) => ({
          ...m.organization,
          role: m.role,
        })),
      },
    });
  } catch {
    return c.json({ user: null });
  }
});

// Logout (client-side, just acknowledge)
app.post('/logout', (c) => {
  return c.json({ success: true });
});

export { app as authRoutes };
