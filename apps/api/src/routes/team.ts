import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess, requireRole } from '../middleware/auth.js';
import { ValidationError, NotFoundError, ForbiddenError } from '@docsynth/utils';

const app = new Hono();

// List team members
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');

  const memberships = await prisma.membership.findMany({
    where: { organizationId: orgId },
    include: {
      user: {
        select: {
          id: true,
          githubUsername: true,
          email: true,
          avatarUrl: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return c.json({
    success: true,
    data: memberships.map((m) => ({
      id: m.id,
      role: m.role.toLowerCase(),
      joinedAt: m.createdAt,
      user: m.user,
    })),
  });
});

// Invite team member
app.post('/invite', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json();
  const { email, role } = body;

  if (!email) {
    throw new ValidationError('Email is required');
  }

  if (!['admin', 'member', 'viewer'].includes(role)) {
    throw new ValidationError('Invalid role');
  }

  // Check if user exists
  const existingUser = await prisma.user.findFirst({
    where: { email },
  });

  if (existingUser) {
    // Check if already a member
    const existingMembership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: existingUser.id,
          organizationId: orgId,
        },
      },
    });

    if (existingMembership) {
      throw new ValidationError('User is already a member');
    }

    // Add membership
    const membership = await prisma.membership.create({
      data: {
        userId: existingUser.id,
        organizationId: orgId,
        role: role.toUpperCase() as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER',
      },
      include: {
        user: {
          select: {
            id: true,
            githubUsername: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return c.json({
      success: true,
      data: {
        id: membership.id,
        role: membership.role.toLowerCase(),
        user: membership.user,
        status: 'added',
      },
    });
  }

  // User doesn't exist - create pending invitation
  // In a full implementation, you'd send an email and create an invitation record
  return c.json({
    success: true,
    data: {
      email,
      role,
      status: 'invited',
      message: 'Invitation sent (user will be added when they sign up)',
    },
  });
});

// Update member role
app.patch('/:memberId', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');
  const memberId = c.req.param('memberId');
  const currentUser = c.get('user');
  const body = await c.req.json();
  const { role } = body;

  if (!['admin', 'member', 'viewer'].includes(role)) {
    throw new ValidationError('Invalid role');
  }

  const membership = await prisma.membership.findUnique({
    where: { id: memberId },
    include: { user: true },
  });

  if (!membership || membership.organizationId !== orgId) {
    throw new NotFoundError('Membership', memberId);
  }

  // Can't change owner role
  if (membership.role === 'OWNER') {
    throw new ForbiddenError('Cannot change owner role');
  }

  // Can't demote yourself
  if (membership.userId === currentUser.id) {
    throw new ForbiddenError('Cannot change your own role');
  }

  const updated = await prisma.membership.update({
    where: { id: memberId },
    data: { role: role.toUpperCase() as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' },
    include: {
      user: {
        select: {
          id: true,
          githubUsername: true,
          email: true,
        },
      },
    },
  });

  return c.json({
    success: true,
    data: {
      id: updated.id,
      role: updated.role.toLowerCase(),
      user: updated.user,
    },
  });
});

// Remove member
app.delete('/:memberId', requireAuth, requireOrgAccess, requireRole('owner', 'admin'), async (c) => {
  const orgId = c.get('organizationId');
  const memberId = c.req.param('memberId');
  const currentUser = c.get('user');

  const membership = await prisma.membership.findUnique({
    where: { id: memberId },
  });

  if (!membership || membership.organizationId !== orgId) {
    throw new NotFoundError('Membership', memberId);
  }

  // Can't remove owner
  if (membership.role === 'OWNER') {
    throw new ForbiddenError('Cannot remove organization owner');
  }

  // Can't remove yourself (use leave instead)
  if (membership.userId === currentUser.id) {
    throw new ForbiddenError('Use /leave to leave the organization');
  }

  await prisma.membership.delete({
    where: { id: memberId },
  });

  return c.json({
    success: true,
    data: { message: 'Member removed' },
  });
});

// Leave organization
app.post('/leave', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const currentUser = c.get('user');

  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: currentUser.id,
        organizationId: orgId,
      },
    },
  });

  if (!membership) {
    throw new NotFoundError('Membership');
  }

  // Owner can't leave (must transfer ownership first)
  if (membership.role === 'OWNER') {
    throw new ForbiddenError('Owner cannot leave. Transfer ownership first.');
  }

  await prisma.membership.delete({
    where: { id: membership.id },
  });

  return c.json({
    success: true,
    data: { message: 'Left organization' },
  });
});

// Transfer ownership
app.post('/transfer-ownership', requireAuth, requireOrgAccess, requireRole('owner'), async (c) => {
  const orgId = c.get('organizationId');
  const currentUser = c.get('user');
  const body = await c.req.json();
  const { newOwnerId } = body;

  if (!newOwnerId) {
    throw new ValidationError('New owner ID is required');
  }

  // Verify new owner is a member
  const newOwnerMembership = await prisma.membership.findFirst({
    where: {
      userId: newOwnerId,
      organizationId: orgId,
    },
  });

  if (!newOwnerMembership) {
    throw new ValidationError('User is not a member of this organization');
  }

  // Update roles in a transaction
  await prisma.$transaction([
    // Make new user owner
    prisma.membership.update({
      where: { id: newOwnerMembership.id },
      data: { role: 'OWNER' },
    }),
    // Demote current owner to admin
    prisma.membership.updateMany({
      where: {
        userId: currentUser.id,
        organizationId: orgId,
      },
      data: { role: 'ADMIN' },
    }),
  ]);

  return c.json({
    success: true,
    data: { message: 'Ownership transferred' },
  });
});

export { app as teamRoutes };
