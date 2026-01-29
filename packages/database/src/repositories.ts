/**
 * Repository Pattern Implementation
 * 
 * Provides an abstraction layer over Prisma for data access.
 * Benefits:
 * - Easier to test (mock repositories instead of Prisma)
 * - Decouples business logic from ORM
 * - Centralizes data access patterns
 */

import { prisma, type PrismaTransactionClient } from './index.js';
import type {
  Repository,
  Document,
  User,
  Organization,
  GenerationJob,
  Prisma,
  JobStatus,
  DocumentType,
} from '@prisma/client';

// ============================================================================
// Base Repository
// ============================================================================

/**
 * Base repository interface with common CRUD operations.
 */
export interface IBaseRepository<T, CreateInput, UpdateInput> {
  findById(id: string): Promise<T | null>;
  findMany(options?: { skip?: number; take?: number }): Promise<T[]>;
  create(data: CreateInput): Promise<T>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<T>;
  count(): Promise<number>;
}

// ============================================================================
// Repository Repository
// ============================================================================

export interface IRepositoryRepository extends IBaseRepository<
  Repository,
  Prisma.RepositoryCreateInput,
  Prisma.RepositoryUpdateInput
> {
  findByGithubRepoId(githubRepoId: number): Promise<Repository | null>;
  findByFullName(fullName: string): Promise<Repository | null>;
  findByOrganization(organizationId: string): Promise<Repository[]>;
  findWithDocuments(id: string): Promise<(Repository & { documents: Document[] }) | null>;
}

export class RepositoryRepository implements IRepositoryRepository {
  constructor(private db: PrismaTransactionClient | typeof prisma = prisma) {}

  async findById(id: string): Promise<Repository | null> {
    return this.db.repository.findUnique({ where: { id } });
  }

  async findByGithubRepoId(githubRepoId: number): Promise<Repository | null> {
    return this.db.repository.findUnique({ where: { githubRepoId } });
  }

  async findByFullName(fullName: string): Promise<Repository | null> {
    return this.db.repository.findFirst({
      where: { fullName },
    });
  }

  async findByOrganization(organizationId: string): Promise<Repository[]> {
    return this.db.repository.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findWithDocuments(id: string): Promise<(Repository & { documents: Document[] }) | null> {
    return this.db.repository.findUnique({
      where: { id },
      include: { documents: true },
    });
  }

  async findMany(options?: { skip?: number; take?: number }): Promise<Repository[]> {
    return this.db.repository.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(data: Prisma.RepositoryCreateInput): Promise<Repository> {
    return this.db.repository.create({ data });
  }

  async update(id: string, data: Prisma.RepositoryUpdateInput): Promise<Repository> {
    return this.db.repository.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Repository> {
    return this.db.repository.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.db.repository.count();
  }
}

// ============================================================================
// Document Repository
// ============================================================================

export interface IDocumentRepository extends IBaseRepository<
  Document,
  Prisma.DocumentCreateInput,
  Prisma.DocumentUpdateInput
> {
  findByRepository(repositoryId: string): Promise<Document[]>;
  findByPath(repositoryId: string, path: string): Promise<Document | null>;
  findByType(repositoryId: string, type: DocumentType): Promise<Document[]>;
}

export class DocumentRepository implements IDocumentRepository {
  constructor(private db: PrismaTransactionClient | typeof prisma = prisma) {}

  async findById(id: string): Promise<Document | null> {
    return this.db.document.findUnique({ where: { id } });
  }

  async findByRepository(repositoryId: string): Promise<Document[]> {
    return this.db.document.findMany({
      where: { repositoryId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findByPath(repositoryId: string, path: string): Promise<Document | null> {
    return this.db.document.findFirst({
      where: { repositoryId, path },
    });
  }

  async findByType(repositoryId: string, type: DocumentType): Promise<Document[]> {
    return this.db.document.findMany({
      where: { repositoryId, type },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findMany(options?: { skip?: number; take?: number }): Promise<Document[]> {
    return this.db.document.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(data: Prisma.DocumentCreateInput): Promise<Document> {
    return this.db.document.create({ data });
  }

  async update(id: string, data: Prisma.DocumentUpdateInput): Promise<Document> {
    return this.db.document.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Document> {
    return this.db.document.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.db.document.count();
  }
}

// ============================================================================
// User Repository
// ============================================================================

export interface IUserRepository extends IBaseRepository<
  User,
  Prisma.UserCreateInput,
  Prisma.UserUpdateInput
> {
  findByGithubUserId(githubUserId: number): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export class UserRepository implements IUserRepository {
  constructor(private db: PrismaTransactionClient | typeof prisma = prisma) {}

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async findByGithubUserId(githubUserId: number): Promise<User | null> {
    return this.db.user.findUnique({ where: { githubUserId } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { email } });
  }

  async findMany(options?: { skip?: number; take?: number }): Promise<User[]> {
    return this.db.user.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.db.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.db.user.update({ where: { id }, data });
  }

  async delete(id: string): Promise<User> {
    return this.db.user.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.db.user.count();
  }
}

// ============================================================================
// GenerationJob Repository
// ============================================================================

export interface IGenerationJobRepository extends IBaseRepository<
  GenerationJob,
  Prisma.GenerationJobCreateInput,
  Prisma.GenerationJobUpdateInput
> {
  findByRepository(repositoryId: string): Promise<GenerationJob[]>;
  findByStatus(status: JobStatus): Promise<GenerationJob[]>;
  findPending(): Promise<GenerationJob[]>;
}

export class GenerationJobRepository implements IGenerationJobRepository {
  constructor(private db: PrismaTransactionClient | typeof prisma = prisma) {}

  async findById(id: string): Promise<GenerationJob | null> {
    return this.db.generationJob.findUnique({ where: { id } });
  }

  async findByRepository(repositoryId: string): Promise<GenerationJob[]> {
    return this.db.generationJob.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByStatus(status: JobStatus): Promise<GenerationJob[]> {
    return this.db.generationJob.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending(): Promise<GenerationJob[]> {
    return this.db.generationJob.findMany({
      where: { status: 'PENDING' as JobStatus },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMany(options?: { skip?: number; take?: number }): Promise<GenerationJob[]> {
    return this.db.generationJob.findMany({
      skip: options?.skip,
      take: options?.take,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: Prisma.GenerationJobCreateInput): Promise<GenerationJob> {
    return this.db.generationJob.create({ data });
  }

  async update(id: string, data: Prisma.GenerationJobUpdateInput): Promise<GenerationJob> {
    return this.db.generationJob.update({ where: { id }, data });
  }

  async delete(id: string): Promise<GenerationJob> {
    return this.db.generationJob.delete({ where: { id } });
  }

  async count(): Promise<number> {
    return this.db.generationJob.count();
  }
}

// ============================================================================
// Repository Factory
// ============================================================================

/**
 * Creates repository instances, optionally with a transaction client.
 * Use this to ensure all repositories share the same transaction context.
 */
export function createRepositories(tx?: PrismaTransactionClient) {
  const db = tx ?? prisma;
  return {
    repository: new RepositoryRepository(db),
    document: new DocumentRepository(db),
    user: new UserRepository(db),
    generationJob: new GenerationJobRepository(db),
  };
}

// Default singleton instances
export const repositories = createRepositories();
