/**
 * Extended Database Types
 * 
 * Provides a type-safe wrapper around the Prisma client.
 * After running `prisma generate`, all models are available in the base PrismaClient.
 * This file provides utility functions for type-safe access.
 */

import type { PrismaClient } from '@prisma/client';

// Re-export the full PrismaClient type as our extended client
// (all models are now included in the generated client)
export type ExtendedPrismaClient = PrismaClient;

/**
 * Get the Prisma client with extended type definitions.
 * Since `prisma generate` includes all models, this is now a passthrough.
 */
export function getExtendedPrisma(prisma: PrismaClient): ExtendedPrismaClient {
  return prisma;
}
