import { PrismaClient } from '@prisma/client';

// Singleton pattern for Prisma client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Re-export Prisma types for convenience
export * from '@prisma/client';

// Export repositories
export * from './repositories.js';

// Export extended types for newer models - use named exports to avoid conflicts
export { 
  getExtendedPrisma, 
  type ExtendedPrismaClient,
} from './extended-types.js';

// Utility type for transactions
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

// Helper for running transactions
export async function withTransaction<T>(
  fn: (tx: PrismaTransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn);
}

// Connection management
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

// Health check
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
