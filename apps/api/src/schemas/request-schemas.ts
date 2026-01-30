import { z } from 'zod';

// ============================================================================
// Chat Route Schemas
// ============================================================================

export const createChatSessionSchema = z.object({
  repositoryId: z.string().min(1, 'repositoryId is required'),
});

export const sendChatMessageSchema = z.object({
  message: z.string().min(1, 'Message content cannot be empty').max(10000, 'Message too long'),
  context: z.object({
    documentIds: z.array(z.string()).optional(),
    filePaths: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
  }).optional(),
});

export const chatFeedbackSchema = z.object({
  helpful: z.boolean(),
  comment: z.string().max(1000).optional(),
});

// ============================================================================
// Document Route Schemas
// ============================================================================

export const createDocumentSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  type: z.enum(['readme', 'api', 'guide', 'tutorial', 'reference', 'changelog', 'contributing', 'architecture', 'adr', 'other']),
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string(),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  path: z.string().min(1).optional(),
});

// ============================================================================
// Diagram Route Schemas
// ============================================================================

export const generateDiagramSchema = z.object({
  diagramType: z.enum(['architecture', 'dependency', 'sequence', 'component', 'flowchart', 'er', 'class']),
  scope: z.enum(['full', 'directory', 'file']).optional().default('full'),
  targetPath: z.string().optional(),
  style: z.object({
    direction: z.enum(['TB', 'LR', 'BT', 'RL']).optional(),
    theme: z.enum(['default', 'dark', 'forest', 'neutral']).optional(),
  }).optional(),
});

// ============================================================================
// Repository Route Schemas
// ============================================================================

export const enableRepositorySchema = z.object({
  repositoryId: z.string().min(1, 'repositoryId is required'),
  settings: z.object({
    generateReadme: z.boolean().optional().default(true),
    generateChangelog: z.boolean().optional().default(true),
    generateApiDocs: z.boolean().optional().default(true),
    autoSync: z.boolean().optional().default(true),
    webhookEvents: z.array(z.string()).optional(),
  }).optional(),
});

// ============================================================================
// Translation Route Schemas
// ============================================================================

export const translateDocumentSchema = z.object({
  documentId: z.string().min(1),
  targetLanguage: z.string().min(2).max(10),
  preserveFormatting: z.boolean().optional().default(true),
});

// ============================================================================
// Pagination Query Schemas
// ============================================================================

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().min(1).optional(),
  type: z.string().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'title']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// Type exports for use in route handlers
export type CreateChatSessionInput = z.infer<typeof createChatSessionSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type ChatFeedbackInput = z.infer<typeof chatFeedbackSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type GenerateDiagramInput = z.infer<typeof generateDiagramSchema>;
export type EnableRepositoryInput = z.infer<typeof enableRepositorySchema>;
export type TranslateDocumentInput = z.infer<typeof translateDocumentSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
