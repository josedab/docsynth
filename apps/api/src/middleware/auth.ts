import type { Context, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';
import { prisma } from '@docsynth/database';
import { UnauthorizedError, ForbiddenError } from '@docsynth/utils';
import type { User, UserRole } from '@docsynth/types';

declare module 'hono' {
  interface ContextVariableMap {
    user: User;
    userId: string;
    organizationId: string;
  }
}

/**
 * Get JWT secret with proper validation.
 * In production, JWT_SECRET must be set. In development, a default is allowed.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  if (!secret) {
    if (isDevelopment) {
      console.warn('⚠️  JWT_SECRET not set. Using development-only default. DO NOT use in production!');
      return new TextEncoder().encode('dev-secret-do-not-use-in-production');
    }
    throw new Error('JWT_SECRET environment variable is required in production');
  }

  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  return new TextEncoder().encode(secret);
}

const JWT_SECRET = getJwtSecret();

export interface JWTPayload {
  sub: string;
  githubUserId: number;
  role: UserRole;
  exp: number;
}

export async function createToken(user: { id: string; githubUserId: number; role: UserRole }) {
  return new jose.SignJWT({
    sub: user.id,
    githubUserId: user.githubUserId,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export const requireAuth = createMiddleware(async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing authorization header');
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  c.set('user', {
    id: user.id,
    githubUserId: user.githubUserId,
    githubUsername: user.githubUsername,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role.toLowerCase() as UserRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
  c.set('userId', user.id);

  await next();
});

export function requireRole(...roles: UserRole[]) {
  return createMiddleware(async (c: Context, next: Next) => {
    const user = c.get('user');

    if (!user) {
      throw new UnauthorizedError();
    }

    if (!roles.includes(user.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    await next();
  });
}

export const requireOrgAccess = createMiddleware(async (c: Context, next: Next) => {
  const user = c.get('user');
  const orgId = c.req.param('orgId') ?? c.req.query('organizationId');

  if (!orgId) {
    throw new ForbiddenError('Organization ID required');
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: orgId,
      },
    },
  });

  if (!membership) {
    throw new ForbiddenError('Not a member of this organization');
  }

  c.set('organizationId', orgId);
  await next();
});
